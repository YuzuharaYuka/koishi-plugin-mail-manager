/**
 * 核心模块 - 转发逻辑
 *
 * 负责邮件转发、目标广播和自动转发处理
 */

import type { Bot, h } from 'koishi'
import type {
  StoredMail,
  ForwardRule,
  ForwardTarget,
  ForwardElement,
  RuleMatchStrategy,
} from '../types'
import { LogModule } from '../logger'
import {
  activeConnections,
  getContext,
  getConfig,
  getLogger,
  getMailRenderer,
} from './state'
import { connectAccount } from './accounts'
import { markAsForwarded, getMail, createMail } from './mails'
import { getRules, matchConditions, findMatchingRule, getMatchingRules } from './rules'
import type { ParsedMail } from '../parser'

// ============ 类型定义 ============

export interface ForwardResult {
  /** 是否全部成功 */
  success: boolean
  /** 成功发送的目标数量 */
  successCount: number
  /** 总目标数量 */
  totalTargets: number
  /** 错误消息列表 */
  errors?: string[]
  /** 失败的目标（用于重试） */
  failedTargets?: ForwardTarget[]
}

/**
 * 正在处理的邮件集合（防止并发重复处理）
 */
const processingMails = new Set<number>()

/**
 * 转发队列 - 用于防止过快发送导致的限流
 */
const forwardQueue: Array<{
  mailId: number
  ruleId: number
  resolve: (value: ForwardResult) => void
  reject: (error: Error) => void
}> = []
let isProcessingQueue = false

// ============ 新邮件处理 ============

/**
 * 处理新邮件（由 IMAP 连接调用）
 * 负责创建邮件记录并触发自动转发
 */
export async function handleNewMail(accountId: number, parsedMail: ParsedMail): Promise<void> {
  const logger = getLogger()

  try {
    const mail = await createMail(accountId, parsedMail)
    logger.info(LogModule.MAIL, `账户 #${accountId} 收到新邮件: "${mail.subject}"`)

    // 异步处理自动转发，不阻塞主流程
    processAutoForwardingAsync(mail).catch(e => {
      logger.error(LogModule.FORWARD, `自动转发失败: ${(e as Error).message}`)
    })
  } catch (e) {
    logger.error(LogModule.MAIL, `处理新邮件失败: ${(e as Error).message}`)
  }
}

/**
 * 异步处理自动转发（带并发控制）
 */
export async function processAutoForwardingAsync(mail: StoredMail): Promise<void> {
  const logger = getLogger()
  const config = getConfig()

  // 防止同一邮件被并发处理
  if (processingMails.has(mail.id)) {
    logger.debug(LogModule.FORWARD, `邮件 #${mail.id} 正在处理中，跳过`)
    return
  }

  processingMails.add(mail.id)

  try {
    const rules = await getRules()
    const enabledRules = rules.filter(r => r.enabled)

    if (enabledRules.length === 0) {
      logger.debug(LogModule.FORWARD, '没有启用的规则，跳过自动转发')
      return
    }

    // 获取所有匹配的规则（按优先级排序）
    const matchingRules = getMatchingRules(mail, enabledRules)

    if (matchingRules.length === 0) {
      logger.debug(LogModule.FORWARD, `邮件 "${mail.subject}" 没有匹配的规则`)
      return
    }

    // 默认使用 first-match 策略
    const matchStrategy: RuleMatchStrategy = 'first-match'

    // 如果是 first-match，只处理第一个匹配的规则
    const rulesToExecute = matchStrategy === 'first-match'
      ? [matchingRules[0]]
      : matchingRules

    for (const rule of rulesToExecute) {
      // 检查是否跳过已转发的邮件
      if (rule.skipForwarded && mail.isForwarded) {
        logger.debug(LogModule.FORWARD, `邮件 "${mail.subject}" 已转发，规则 "${rule.name}" 跳过`)
        continue
      }

      logger.info(LogModule.FORWARD, `邮件 "${mail.subject}" 匹配规则 "${rule.name}" (优先级: ${rule.priority})，开始转发`)

      // 如果配置了延迟，则等待
      const delay = rule.delayMs || 0
      if (delay > 0) {
        logger.debug(LogModule.FORWARD, `等待 ${delay}ms 后转发`)
        await sleep(delay)
      }

      try {
        const result = await executeForwardWithRetry(mail.id, rule)
        logForwardResult(logger, result, rule)
      } catch (e) {
        logger.error(LogModule.FORWARD, `执行转发失败: ${(e as Error).message}`)
      }
    }
  } finally {
    processingMails.delete(mail.id)
  }
}

/**
 * 记录转发结果
 */
function logForwardResult(logger: ReturnType<typeof getLogger>, result: ForwardResult, rule: ForwardRule): void {
  if (result.success) {
    logger.info(LogModule.FORWARD, `转发成功: ${result.successCount}/${result.totalTargets} 个目标`)
  } else if (result.successCount > 0) {
    logger.warn(LogModule.FORWARD, `转发部分成功: ${result.successCount}/${result.totalTargets}，失败: ${result.errors?.join(', ')}`)
  } else {
    logger.error(LogModule.FORWARD, `转发全部失败: ${result.errors?.join(', ')}`)
  }
}

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============ 手动转发 ============

export async function forwardMail(
  mailId: number,
  ruleId?: number,
  targetOverride?: ForwardTarget[]
): Promise<ForwardResult> {
  const logger = getLogger()

  const mail = await getMail(mailId)
  if (!mail) {
    return {
      success: false,
      successCount: 0,
      totalTargets: 0,
      errors: ['邮件不存在'],
    }
  }

  try {
    const rule = await findMatchingRule(mail, ruleId)
    const targets = targetOverride || rule?.targets || []

    if (targets.length === 0) {
      return {
        success: false,
        successCount: 0,
        totalTargets: 0,
        errors: ['没有可用的转发目标'],
      }
    }

    return await executeForward(mailId, rule?.id, targets)
  } catch (e) {
    logger.error(LogModule.FORWARD, `转发邮件失败: ${(e as Error).message}`)
    return {
      success: false,
      successCount: 0,
      totalTargets: 0,
      errors: [(e as Error).message],
    }
  }
}

// ============ 执行转发 ============

/**
 * 执行带重试的转发
 */
async function executeForwardWithRetry(mailId: number, rule: ForwardRule): Promise<ForwardResult> {
  const logger = getLogger()
  const maxRetries = rule.retryCount || 0
  const retryInterval = rule.retryIntervalMs || 5000
  let lastResult: ForwardResult = {
    success: false,
    successCount: 0,
    totalTargets: 0,
    errors: [],
  }

  // 首次尝试
  lastResult = await executeForward(mailId, rule.id)

  // 如果需要重试且有失败的目标
  if (!lastResult.success && maxRetries > 0 && lastResult.failedTargets && lastResult.failedTargets.length > 0) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(LogModule.FORWARD, `重试转发 (${attempt}/${maxRetries})，等待 ${retryInterval}ms`)
      await sleep(retryInterval)

      // 只重试失败的目标
      const retryResult = await executeForward(mailId, rule.id, lastResult.failedTargets)

      // 合并结果
      lastResult.successCount += retryResult.successCount
      lastResult.failedTargets = retryResult.failedTargets
      lastResult.errors = retryResult.errors

      if (retryResult.success || !retryResult.failedTargets?.length) {
        lastResult.success = true
        break
      }
    }
  }

  return lastResult
}

export async function executeForward(
  mailId: number,
  ruleId?: number,
  targetOverride?: ForwardTarget[]
): Promise<ForwardResult> {
  const logger = getLogger()
  const mailRenderer = getMailRenderer()

  const mail = await getMail(mailId)
  if (!mail) throw new Error('邮件不存在')

  let rule: ForwardRule | null = null
  if (ruleId) {
    rule = await findMatchingRule(mail, ruleId)
  }

  const targets = targetOverride || rule?.targets || []
  if (targets.length === 0) {
    return {
      success: false,
      successCount: 0,
      totalTargets: 0,
      errors: ['没有转发目标'],
    }
  }

  // 如果没有指定规则，创建一个默认规则用于渲染
  const effectiveRule: ForwardRule = rule || createDefaultRule()

  let messageElements: h[]
  try {
    messageElements = await mailRenderer.generateForwardElements(mail, effectiveRule)
  } catch (e) {
    logger.error(LogModule.FORWARD, `渲染消息失败: ${(e as Error).message}`)
    return {
      success: false,
      successCount: 0,
      totalTargets: targets.length,
      errors: [`渲染失败: ${(e as Error).message}`],
    }
  }

  // 广播到目标
  const result = await broadcastToTargets(messageElements, targets)

  // 根据失败策略决定是否标记为已转发
  const failureStrategy = effectiveRule.failureStrategy || 'mark-partial'
  const shouldMarkForwarded = shouldMarkAsForwarded(result, failureStrategy)

  if (shouldMarkForwarded) {
    await markAsForwarded(mailId)
  }

  return result
}

/**
 * 根据失败策略决定是否标记邮件为已转发
 */
function shouldMarkAsForwarded(result: ForwardResult, strategy: string): boolean {
  switch (strategy) {
    case 'require-all':
      return result.success // 只有全部成功才标记
    case 'retry-failed':
    case 'mark-partial':
    default:
      return result.successCount > 0 // 部分成功就标记
  }
}

/**
 * 创建默认规则用于渲染
 */
function createDefaultRule(): ForwardRule {
  return {
    id: 0,
    name: '默认规则',
    enabled: true,
    priority: 100,
    conditionLogic: 'and',
    conditions: [],
    targets: [],
    elements: [],
    renderConfig: {
      imageWidth: 800,
      backgroundColor: '#ffffff',
      textColor: '#333333',
      fontSize: 14,
      padding: 20,
      showBorder: true,
      borderColor: '#e0e0e0',
    },
    failureStrategy: 'mark-partial',
    delayMs: 0,
    skipForwarded: true,
    retryCount: 0,
    retryIntervalMs: 5000,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ============ 目标广播 ============

export async function broadcastToTargets(
  messageElements: h[],
  targets: ForwardTarget[]
): Promise<ForwardResult> {
  const ctx = getContext()
  const logger = getLogger()

  const errors: string[] = []
  const failedTargets: ForwardTarget[] = []
  let successCount = 0

  for (const target of targets) {
    try {
      const bot = findBot(target.platform, target.selfId)
      if (!bot) {
        const errMsg = `找不到 Bot: platform=${target.platform}, selfId=${target.selfId}`
        errors.push(errMsg)
        failedTargets.push(target)
        logger.warn(LogModule.FORWARD, errMsg)
        continue
      }

      if (!bot.isActive) {
        const errMsg = `Bot 未激活: platform=${target.platform}, selfId=${target.selfId}`
        errors.push(errMsg)
        failedTargets.push(target)
        logger.warn(LogModule.FORWARD, errMsg)
        continue
      }

      await bot.sendMessage(target.channelId, messageElements)
      successCount++
      logger.debug(LogModule.FORWARD, `成功发送到 ${target.displayName || target.channelId}`)
    } catch (e) {
      const errMsg = `发送到 ${target.displayName || target.channelId} 失败: ${(e as Error).message}`
      errors.push(errMsg)
      failedTargets.push(target)
      logger.warn(LogModule.FORWARD, errMsg)
    }
  }

  return {
    success: successCount === targets.length,
    successCount,
    totalTargets: targets.length,
    errors: errors.length > 0 ? errors : undefined,
    failedTargets: failedTargets.length > 0 ? failedTargets : undefined,
  }
}

/**
 * 查找匹配的 Bot 实例
 */
function findBot(platform: string, selfId: string): Bot | undefined {
  const ctx = getContext()

  // 首先尝试精确匹配
  const exactMatch = ctx.bots.find(b => b.platform === platform && b.selfId === selfId)
  if (exactMatch) return exactMatch

  // 如果找不到精确匹配，尝试模糊匹配（可能是 platform 格式问题）
  const fuzzyMatch = ctx.bots.find(b =>
    b.selfId === selfId && (
      b.platform === platform ||
      b.platform.startsWith(platform + ':') ||
      platform.startsWith(b.platform + ':')
    )
  )

  return fuzzyMatch
}

// ============ 账户连接状态监控 ============

/**
 * 启动所有已启用账户的连接
 */
export async function startAllConnections(): Promise<void> {
  const ctx = getContext()
  const logger = getLogger()

  const accounts = await ctx.database.get('mail_manager.accounts', { enabled: true })

  for (const account of accounts) {
    try {
      await connectAccount(account.id)
    } catch (e) {
      logger.error(LogModule.IMAP, `启动账户 "${account.name}" 连接失败: ${(e as Error).message}`)
    }
  }
}

/**
 * 停止所有连接
 */
export async function stopAllConnections(): Promise<void> {
  const logger = getLogger()

  for (const [accountId, connection] of activeConnections.entries()) {
    try {
      await connection.disconnect()
      activeConnections.delete(accountId)
    } catch (e) {
      logger.warn(LogModule.IMAP, `断开账户 #${accountId} 连接失败: ${(e as Error).message}`)
    }
  }
}

// ============ 导出给外部使用 ============

export { handleNewMail as onNewMail }
