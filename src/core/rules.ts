/**
 * 核心模块 - 规则管理
 *
 * 负责转发规则的 CRUD 操作和匹配逻辑
 */

import type {
  StoredMail,
  ForwardRule,
  ForwardCondition,
  ForwardPreviewRequest,
  ForwardPreviewResponse,
  ForwardTarget,
  ForwardElement,
  ConditionLogic,
} from '../types'
import { DEFAULT_RENDER_CONFIG, DEFAULT_FORWARD_ELEMENTS } from '../render'
import { LogModule } from '../logger'
import {
  TABLE_RULES,
  RULES_CACHE_TTL_MS,
  rulesCache,
  invalidateRulesCache,
  getContext,
  getLogger,
  getMailRenderer,
} from './state'
import { getMail } from './mails'

// ============ 规则测试结果类型 ============

export interface RuleTestResult {
  matched: boolean
  matchedConditions: string[]
  unmatchedConditions: string[]
  previewContent?: ForwardPreviewResponse
}

// ============ 规则查询 ============

export async function getRules(): Promise<ForwardRule[]> {
  const ctx = getContext()
  const now = Date.now()

  if (rulesCache.data && (now - rulesCache.lastUpdate) < RULES_CACHE_TTL_MS) {
    return rulesCache.data
  }

  // 防止并发查询 - 如果已有进行中的查询，直接等待它
  if (rulesCache.queryPromise) {
    return rulesCache.queryPromise
  }

  // 创建查询 Promise，使用 async 函数确保正确的清理时机
  const queryPromise = (async () => {
    try {
      const rules = await ctx.database.get(TABLE_RULES, {})
      rulesCache.data = rules
      rulesCache.lastUpdate = Date.now()
      return rules
    } finally {
      // 只有当前 promise 仍是活跃的查询时才清理
      // 这确保在 promise 完全解析后再清理引用
      if (rulesCache.queryPromise === queryPromise) {
        rulesCache.queryPromise = null
      }
    }
  })()

  rulesCache.queryPromise = queryPromise
  return queryPromise
}

export async function getRule(id: number): Promise<ForwardRule | null> {
  const ctx = getContext()
  const [rule] = await ctx.database.get(TABLE_RULES, { id })
  return rule || null
}

// ============ 规则 CRUD ============

export async function createRule(data: Partial<ForwardRule>): Promise<ForwardRule> {
  const ctx = getContext()
  const logger = getLogger()
  const now = new Date()

  const rule = await ctx.database.create(TABLE_RULES, {
    name: data.name || '新规则',
    description: data.description,
    enabled: data.enabled ?? true,
    priority: data.priority ?? 100,
    accountId: data.accountId,
    conditionLogic: data.conditionLogic || 'and',
    conditions: data.conditions || [],
    targets: data.targets || [],
    forwardMode: data.forwardMode || 'text',
    elements: data.elements || [...DEFAULT_FORWARD_ELEMENTS],
    regexConfig: data.regexConfig,
    customCss: data.customCss,
    renderConfig: data.renderConfig || { ...DEFAULT_RENDER_CONFIG },
    failureStrategy: data.failureStrategy || 'mark-partial',
    delayMs: data.delayMs ?? 0,
    skipForwarded: data.skipForwarded ?? true,
    retryCount: data.retryCount ?? 0,
    retryIntervalMs: data.retryIntervalMs ?? 5000,
    createdAt: now,
    updatedAt: now,
  })

  logger.info(LogModule.RULE, `创建规则 "${rule.name}"`)
  invalidateRulesCache()
  broadcastRulesUpdate()

  return rule
}

export async function updateRule(id: number, data: Partial<ForwardRule>): Promise<ForwardRule> {
  const ctx = getContext()
  const [existing] = await ctx.database.get(TABLE_RULES, { id })
  if (!existing) throw new Error(`规则不存在: ${id}`)

  await ctx.database.set(TABLE_RULES, { id }, {
    ...data,
    updatedAt: new Date(),
  })

  invalidateRulesCache()
  broadcastRulesUpdate()

  return (await getRule(id))!
}

export async function deleteRule(id: number): Promise<void> {
  const ctx = getContext()
  const logger = getLogger()

  await ctx.database.remove(TABLE_RULES, { id })
  invalidateRulesCache()
  broadcastRulesUpdate()

  logger.info(LogModule.RULE, `删除规则 #${id}`)
}

// ============ 规则测试 ============

export async function testRule(ruleId: number, mailId: number): Promise<RuleTestResult> {
  const logger = getLogger()
  const mailRenderer = getMailRenderer()

  const rule = await getRule(ruleId)
  if (!rule) throw new Error('规则不存在')

  const mail = await getMail(mailId)
  if (!mail) throw new Error('邮件不存在')

  const matchedConditions: string[] = []
  const unmatchedConditions: string[] = []
  const conditionResults: boolean[] = []

  for (const condition of rule.conditions) {
    let matched = false
    try {
      matched = checkSingleCondition(mail, condition)
    } catch {
      matched = false
    }

    if (condition.negate) matched = !matched
    conditionResults.push(matched)

    const conditionDesc = `${condition.type}: "${condition.value}"${condition.negate ? ' (取反)' : ''}`
    if (matched) {
      matchedConditions.push(conditionDesc)
    } else {
      unmatchedConditions.push(conditionDesc)
    }
  }

  // 根据条件逻辑判断整体匹配结果
  const logic = rule.conditionLogic || 'and'
  let overallMatched: boolean
  if (rule.conditions.length === 0) {
    overallMatched = true
  } else if (logic === 'or') {
    overallMatched = conditionResults.some(r => r)
  } else {
    overallMatched = conditionResults.every(r => r)
  }

  let previewContent: ForwardPreviewResponse | undefined
  if (overallMatched) {
    try {
      previewContent = await mailRenderer.generatePreview(
        mail,
        rule.elements,
        rule.customCss,
        rule.renderConfig,
        rule.forwardMode
      )
    } catch (e) {
      logger.warn(LogModule.RULE, `生成预览失败: ${(e as Error).message}`)
    }
  }

  return {
    matched: overallMatched,
    matchedConditions,
    unmatchedConditions,
    previewContent,
  }
}

// ============ 条件匹配 ============

/**
 * 检查邮件是否匹配规则的所有条件
 * 支持 AND/OR 逻辑
 */
export function matchConditions(
  mail: StoredMail,
  conditions: ForwardCondition[],
  logic: ConditionLogic = 'and'
): boolean {
  if (conditions.length === 0) return true

  const results: boolean[] = []

  for (const condition of conditions) {
    let matched = false

    try {
      matched = checkSingleCondition(mail, condition)
    } catch {
      matched = false
    }

    if (condition.negate) matched = !matched
    results.push(matched)
  }

  // 根据逻辑类型返回结果
  if (logic === 'or') {
    return results.some(r => r) // 任一条件满足即可
  }
  return results.every(r => r) // 所有条件都必须满足（默认 AND）
}

/**
 * 检查邮件是否匹配规则（考虑账号和条件逻辑）
 */
export function matchRule(mail: StoredMail, rule: ForwardRule): boolean {
  // 检查账号匹配
  if (rule.accountId && rule.accountId !== mail.accountId) {
    return false
  }

  // 检查条件匹配（使用规则定义的条件逻辑）
  const logic = rule.conditionLogic || 'and'
  return matchConditions(mail, rule.conditions, logic)
}

/**
 * 获取所有匹配的规则（按优先级排序）
 */
export function getMatchingRules(mail: StoredMail, rules: ForwardRule[]): ForwardRule[] {
  return rules
    .filter(rule => matchRule(mail, rule))
    .sort((a, b) => (a.priority || 100) - (b.priority || 100)) // 优先级越小越靠前
}

export function checkSingleCondition(mail: StoredMail, condition: ForwardCondition): boolean {
  const value = condition.value.toLowerCase()

  switch (condition.type) {
    case 'all':
      return true
    case 'subject_contains':
      return mail.subject?.toLowerCase().includes(value) || false
    case 'subject_regex':
      return safeRegexTest(condition.value, mail.subject || '')
    case 'from_contains':
      return mail.from?.address?.toLowerCase().includes(value) || false
    case 'from_regex':
      return safeRegexTest(condition.value, mail.from?.address || '')
    case 'to_contains':
      return mail.to?.some(t => t.address?.toLowerCase().includes(value)) || false
    case 'body_contains':
      return mail.textContent?.toLowerCase().includes(value) || false
    case 'body_regex':
      return safeRegexTest(condition.value, mail.textContent || '')
    default:
      return false
  }
}

/**
 * 检测潜在的 ReDoS 危险模式
 * 常见的 ReDoS 模式：嵌套量词、重复的交替、回溯陷阱
 */
function hasReDoSRisk(pattern: string): boolean {
  // 检测嵌套量词模式，如 (a+)+ 或 (a*)*
  const nestedQuantifiers = /\([^)]*[+*][^)]*\)[+*]|\([^)]*\([^)]*[+*]/
  // 检测重复的交替模式，如 (a|a)+
  const overlappingAlternation = /\(([^|)]+)\|.*\1.*\)[+*]/
  // 检测危险的回溯模式
  const backtrackTrap = /\.\*[^?].*\.\*/

  return nestedQuantifiers.test(pattern) ||
         overlappingAlternation.test(pattern) ||
         backtrackTrap.test(pattern)
}

/**
 * 安全的正则表达式测试
 * 防止 ReDoS 攻击和语法错误
 */
export function safeRegexTest(pattern: string, input: string, maxLength: number = 200): boolean {
  const logger = getLogger()

  try {
    if (pattern.length > maxLength) {
      logger.warn(LogModule.RULE, `正则表达式过长 (${pattern.length} > ${maxLength})，已拒绝执行`)
      return false
    }

    // 检测潜在的 ReDoS 危险模式
    if (hasReDoSRisk(pattern)) {
      logger.warn(LogModule.RULE, `正则表达式包含潜在 ReDoS 风险模式: ${pattern.substring(0, 50)}...`)
      return false
    }

    const safeInput = input.length > 50000 ? input.substring(0, 50000) : input
    const regex = new RegExp(pattern, 'i')
    return regex.test(safeInput)
  } catch (e) {
    logger.warn(LogModule.RULE, `正则表达式语法错误: ${(e as Error).message}`)
    return false
  }
}

// ============ 预览功能 ============

export async function getForwardPreview(request: ForwardPreviewRequest): Promise<ForwardPreviewResponse> {
  const mailRenderer = getMailRenderer()

  const mail = await getMail(request.mailId)
  if (!mail) throw new Error('邮件不存在')

  const config = await resolvePreviewConfig(request)

  return await mailRenderer.generatePreview(
    mail,
    config.elements,
    config.customCss,
    config.renderConfig,
    config.forwardMode
  )
}

export async function getAvailableTargets(): Promise<ForwardTarget[]> {
  const ctx = getContext()
  const logger = getLogger()
  const targets: ForwardTarget[] = []

  for (const bot of ctx.bots) {
    if (!bot.isActive) continue

    try {
      const guilds = await bot.getGuildList()
      for (const guild of guilds.data) {
        const channels = await bot.getChannelList(guild.id)
        for (const channel of channels.data) {
          targets.push({
            platform: bot.platform,
            selfId: bot.selfId,
            channelId: channel.id,
            displayName: `${guild.name} - ${channel.name}`,
          })
        }
      }
    } catch (e) {
      logger.debug(LogModule.SYSTEM, `获取频道列表失败: ${(e as Error).message}`)
    }
  }

  return targets
}

async function resolvePreviewConfig(request: ForwardPreviewRequest) {
  let elements = request.elements
  let customCss = request.customCss
  let renderConfig = request.renderConfig
  let forwardMode = request.forwardMode

  if (request.ruleId) {
    const rule = await getRule(request.ruleId)
    if (rule) {
      elements = elements || rule.elements
      customCss = customCss ?? rule.customCss
      renderConfig = renderConfig || rule.renderConfig
      forwardMode = forwardMode || rule.forwardMode
    }
  }

  return {
    elements: elements || [...DEFAULT_FORWARD_ELEMENTS],
    customCss,
    renderConfig: { ...DEFAULT_RENDER_CONFIG, ...renderConfig },
    forwardMode,
  }
}

// ============ 辅助函数 ============

function broadcastRulesUpdate(): void {
  const ctx = getContext()
  const logger = getLogger()

  try {
    ctx.console?.broadcast('mail-manager/rules-updated', {
      timestamp: Date.now(),
    })
  } catch (e) {
    logger.debug(LogModule.SYSTEM, `广播规则更新事件失败: ${(e as Error).message}`)
  }
}

export function registerRulesCacheListener(): void {
  const ctx = getContext()
  const logger = getLogger()

  ctx.console?.addListener('mail-manager/rules-updated' as any, () => {
    invalidateRulesCache()
    logger.debug(LogModule.SYSTEM, '规则缓存已被远程实例更新，已失效本地缓存')
  })
}

export async function findMatchingRule(mail: StoredMail, ruleId?: number): Promise<ForwardRule | null> {
  if (ruleId) {
    const rule = await getRule(ruleId)
    if (!rule) throw new Error('规则不存在')
    return rule
  }

  const rules = await getRules()
  // 按优先级排序后返回第一个匹配的规则
  const sortedRules = [...rules].sort((a, b) => (a.priority || 100) - (b.priority || 100))
  return sortedRules.find(r => r.enabled && matchRule(mail, r)) || null
}
