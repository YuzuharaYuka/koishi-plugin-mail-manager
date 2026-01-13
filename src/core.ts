/**
 * 邮件管理核心逻辑
 * 遵循 Clean Code 原则重构
 */

import { Context, h, $ } from 'koishi'
import { type ParsedMail } from './parser'
import type {
  MailAccount,
  StoredMail,
  ForwardRule,
  CreateMailAccountRequest,
  UpdateMailAccountRequest,
  MailListQuery,
  PaginatedResponse,
  ForwardPreviewRequest,
  ForwardPreviewResponse,
  ConnectionTestResult,
  ForwardTarget,
  ForwardCondition,
  Config,
} from './types'
import { ImapConnection, convertParsedMail } from './imap'
import { MailRenderer, DEFAULT_RENDER_CONFIG, DEFAULT_FORWARD_ELEMENTS } from './render'
import { MailManagerLogger, createLogger, LogModule } from './logger'

// ============ 常量定义 ============

const TABLE_ACCOUNTS = 'mail_manager.accounts'
const TABLE_MAILS = 'mail_manager.mails'
const TABLE_RULES = 'mail_manager.rules'
const RULES_CACHE_TTL_MS = 60000 // 1分钟缓存

// ============ 全局状态 ============

/** 活跃的 IMAP 连接集合 */
const activeConnections = new Map<number, ImapConnection>()

/** 邮件渲染器 */
let mailRenderer: MailRenderer

/** 插件上下文 */
let context: Context

/** 插件配置 */
let pluginConfig: Config

/** 日志记录器 */
let logger: MailManagerLogger

/** 调试模式标志 */
let isDebugMode = false

/** 转发规则缓存 */
let cachedRules: ForwardRule[] | null = null
let lastRulesCacheUpdate = 0

// ============ 初始化与生命周期 ============

/**
 * 设置调试模式
 */
export function setDebugMode(enabled: boolean): void {
  isDebugMode = enabled
}

/**
 * 初始化核心模块
 * 负责资源分配和生命周期钩子注册
 */
export async function initCore(ctx: Context, config: Config): Promise<void> {
  context = ctx
  pluginConfig = config
  mailRenderer = new MailRenderer(ctx)
  logger = createLogger(ctx)

  await cleanupStaleConnections()
  registerLifecycleHooks(ctx)
}

/**
 * 清理旧连接（用于热重载）
 * 防止连接泄漏
 */
async function cleanupStaleConnections(): Promise<void> {
  if (activeConnections.size === 0) return

  logger.info(LogModule.SYSTEM, `清理 ${activeConnections.size} 个旧连接`)

  const disconnectPromises = Array.from(activeConnections.entries()).map(async ([id, connection]) => {
    try {
      await connection.disconnect()
    } catch (e) {
      logger.warn(LogModule.SYSTEM, `断开旧连接 ${id} 失败: ${(e as Error).message}`)
    }
  })

  await Promise.all(disconnectPromises).catch(err => {
    logger.warn(LogModule.SYSTEM, `部分连接断开失败: ${err.message}`)
  })

  activeConnections.clear()
}

/**
 * 注册生命周期钩子
 */
function registerLifecycleHooks(ctx: Context): void {
  // 启动时连接所有启用的账号
  ctx.on('ready', async () => {
    const accounts = await ctx.database.get(TABLE_ACCOUNTS, { enabled: true })

    for (const account of accounts) {
      connectAccount(account.id).catch((error) => {
        logger.error(LogModule.SYSTEM, `连接账号 ${account.id} 失败: ${error.message}`)
      })
    }

    logger.info(LogModule.SYSTEM, `已加载 ${accounts.length} 个账号`)
  })

  // 插件卸载时断开所有连接
  ctx.on('dispose', async () => {
    logger.info(LogModule.SYSTEM, `正在断开 ${activeConnections.size} 个账号连接`)

    const disconnectPromises = Array.from(activeConnections.values()).map(conn => conn.disconnect())

    await Promise.all(disconnectPromises).catch(err => {
      logger.warn(LogModule.SYSTEM, `部分连接断开失败: ${err.message}`)
    })

    activeConnections.clear()
    logger.info(LogModule.SYSTEM, '插件已停止')
  })
}

// ============ 账号管理 ============

export async function getAccounts(): Promise<MailAccount[]> {
  const accounts = await context.database.get(TABLE_ACCOUNTS, {})
  return accounts.map(account => ({
    ...account,
    status: activeConnections.get(account.id)?.status || account.status,
  }))
}

export async function getAccount(id: number): Promise<MailAccount | null> {
  const [account] = await context.database.get(TABLE_ACCOUNTS, { id })
  if (!account) return null
  return {
    ...account,
    status: activeConnections.get(id)?.status || account.status,
  }
}

export async function createAccount(data: CreateMailAccountRequest): Promise<MailAccount> {
  const now = new Date()
  const account = await context.database.create(TABLE_ACCOUNTS, {
    name: data.name,
    email: data.email.trim(),
    password: data.password,
    imapHost: data.imapHost.trim(),
    imapPort: data.imapPort ?? 993,
    imapTls: data.imapTls ?? true,
    proxyUrl: data.proxyUrl || undefined, // 保存代理配置
    enabled: data.enabled ?? false,
    sendImapId: false, // 默认不发送 IMAP ID（避免连接不稳定）
    status: 'disconnected',
    createdAt: now,
    updatedAt: now,
  })

  logger.info(LogModule.RULE, `创建账号 ${account.email}`)

  if (account.enabled) {
    connectAccount(account.id).catch((error) => {
      logger.error(LogModule.CONNECT, `连接账号 ${account.id} 失败: ${error.message}`)
    })
  }

  return account
}

export async function updateAccount(id: number, data: UpdateMailAccountRequest): Promise<MailAccount> {
  const existing = await fetchAccountById(id)
  if (!existing) {
    throw new Error(`账号不存在: ${id}`)
  }

  const wasEnabled = existing.enabled
  const isEnabled = data.enabled ?? existing.enabled

  await updateAccountInDatabase(id, data)
  await handleAccountStateChange(id, wasEnabled, isEnabled, data)

  return (await fetchAccountById(id))!
}

export async function deleteAccount(id: number): Promise<void> {
  await disconnectAccount(id)
  await context.database.remove(TABLE_MAILS, { accountId: id })
  await context.database.remove(TABLE_ACCOUNTS, { id })
  logger.info(LogModule.RULE, `删除账号 ${id}`)
}

export async function testConnection(id: number): Promise<ConnectionTestResult> {
  const account = await getAccount(id)
  if (!account) {
    return { success: false, message: '账号不存在' }
  }

  // 运行时修正：去除可能存在的空格
  account.imapHost = account.imapHost.trim()
  account.email = account.email.trim()

  const result = await ImapConnection.testConnection(account)
  return {
    ...result,
    details: {
      host: account.imapHost,
      port: account.imapPort,
      tls: account.imapTls,
    },
  }
}

export async function connectAccount(id: number): Promise<void> {
  const account = await getAccount(id)
  if (!account) {
    throw new Error(`账号不存在: ${id}`)
  }

  // 运行时修正：去除可能存在的空格
  account.imapHost = account.imapHost.trim()
  account.email = account.email.trim()

  if (activeConnections.has(id)) {
    logger.debug(LogModule.CONNECT, `账号 ${id} 已连接`)
    return
  }

  const connection = new ImapConnection(
    context,
    account,
    {
      mailRetentionDays: pluginConfig.mailRetentionDays,
      autoReconnect: pluginConfig.autoReconnect,
      maxReconnectAttempts: pluginConfig.maxReconnectAttempts,
      reconnectInterval: pluginConfig.reconnectInterval,
      connectionTimeout: pluginConfig.connectionTimeout,
      healthCheckEnabled: pluginConfig.healthCheckEnabled,
      healthCheckInterval: pluginConfig.healthCheckInterval,
    },
    (mail) => handleNewMail(account, mail),
    (status, error) => updateAccountStatus(id, status, error)
  )

  activeConnections.set(id, connection)

  try {
    await connection.connect()
  } catch (error) {
    activeConnections.delete(id)
    throw error
  }
}

export async function disconnectAccount(id: number): Promise<void> {
  const connection = activeConnections.get(id)
  if (connection) {
    await connection.disconnect()
    activeConnections.delete(id)
  }

  await updateAccountStatus(id, 'disconnected')
}

// ============ 账号管理辅助函数 ============

async function fetchAccountById(id: number): Promise<MailAccount | undefined> {
  const [account] = await context.database.get(TABLE_ACCOUNTS, { id })
  return account
}

async function updateAccountInDatabase(id: number, data: UpdateMailAccountRequest): Promise<void> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined && data.name !== '') updateData.name = data.name
  if (data.email !== undefined && data.email !== '') updateData.email = data.email.trim()
  if (data.password !== undefined && data.password !== '') updateData.password = data.password
  if (data.imapHost !== undefined && data.imapHost !== '') updateData.imapHost = data.imapHost.trim()
  if (data.imapPort !== undefined) updateData.imapPort = data.imapPort
  if (data.imapTls !== undefined) updateData.imapTls = data.imapTls
  if (data.proxyUrl !== undefined) updateData.proxyUrl = data.proxyUrl || null // 更新代理配置
  if (data.enabled !== undefined) updateData.enabled = data.enabled
  if (data.sendImapId !== undefined) updateData.sendImapId = data.sendImapId

  await context.database.set(TABLE_ACCOUNTS, { id }, updateData)
}

async function handleAccountStateChange(
  id: number,
  wasEnabled: boolean,
  isEnabled: boolean,
  data: UpdateMailAccountRequest
): Promise<void> {
  const hasConfigChanged = data.imapHost || data.imapPort || data.password || data.proxyUrl !== undefined || data.sendImapId !== undefined

  if (wasEnabled && !isEnabled) {
    disconnectAccount(id).catch(e => logger.error(LogModule.CONNECT, `断开账号 ${id} 失败: ${e.message}`))
  } else if (!wasEnabled && isEnabled) {
    connectAccount(id).catch(e => logger.error(LogModule.CONNECT, `连接账号 ${id} 失败: ${e.message}`))
  } else if (isEnabled && hasConfigChanged) {
    disconnectAccount(id)
      .then(() => connectAccount(id))
      .catch(e => logger.error(LogModule.CONNECT, `重连账号 ${id} 失败: ${e.message}`))
  }
}

async function updateAccountStatus(id: number, status: MailAccount['status'], error?: string): Promise<void> {
  try {
    await context.database.set(TABLE_ACCOUNTS, { id }, {
      status,
      lastError: error || null,
      updatedAt: new Date(),
    })

    logger.info(LogModule.SYSTEM, `[状态更新] 账号 ${id} 状态变更为: ${status}${error ? ` (错误: ${error})` : ''}`)

    if (!context.console) {
      logger.warn(LogModule.SYSTEM, `[状态更新] console 服务不可用，无法广播事件`)
      return
    }

    context.console.broadcast('mail-manager/account-status-changed', {
      accountId: id,
      status,
      error: error || null,
      timestamp: new Date().toISOString(),
    })

    logger.debug(LogModule.SYSTEM, `[状态更新] 已广播状态变更事件: accountId=${id}, status=${status}`)
  } catch (e) {
    logger.error(LogModule.SYSTEM, `更新账号状态失败: ${(e as Error).message}`)
  }
}

/** 同步账号邮件（重新获取邮箱服务器上的邮件）*/
export async function syncAccountMails(accountId: number, days?: number): Promise<{ total: number; new: number; existing: number }> {
  const account = await getAccount(accountId)
  if (!account) throw new Error(`账号不存在: ${accountId}`)

  const connection = activeConnections.get(accountId)
  if (!connection) throw new Error('账号未连接，请先连接账号')

  logger.info(LogModule.SYNC, `同步账号 ${accountId} (${account.email})`)

  // 优化：只查询 messageId 字段用于去重
  const existingMessageIds = await fetchExistingMessageIds(accountId)

  let totalCount = 0
  let newCount = 0
  let existingCount = 0

  try {
    const result = await connection.syncMails(days, async (batchMails) => {
      const { saved, skipped } = await processMailBatch(accountId, batchMails, existingMessageIds)
      newCount += saved
      existingCount += skipped
    })

    totalCount = result.total
    logger.info(LogModule.SYNC, `已同步邮件 ${totalCount} 封 (新增 ${newCount}, 已有 ${existingCount})`)

    return { total: totalCount, new: newCount, existing: existingCount }
  } catch (err) {
    logger.error(LogModule.SYNC, `同步失败`)
    throw err
  }
}

// ============ 邮件管理 ============

export async function getMails(query: MailListQuery): Promise<PaginatedResponse<StoredMail>> {
  const page = query.page || 1
  const pageSize = query.pageSize || 20
  const conditions = buildMailQueryConditions(query)

  // 先统计总数
  const total = await context.database
    .eval(TABLE_MAILS, row => $.count(row.id), conditions) as number

  const totalPages = Math.ceil(total / pageSize)

  // 查询数据
  const items = await context.database
    .select(TABLE_MAILS)
    .where(conditions)
    .orderBy('receivedAt', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute()

  return { items, total, page, pageSize, totalPages }
}

export async function getMail(id: number): Promise<StoredMail | null> {
  const [mail] = await context.database.get(TABLE_MAILS, { id })
  return mail || null
}

export async function deleteMail(id: number): Promise<void> {
  await context.database.remove(TABLE_MAILS, { id })
}

/** 批量删除邮件 */
export async function batchDeleteMails(accountId?: number, days?: number): Promise<{ deleted: number }> {
  const conditions: any = {}

  if (accountId !== undefined) {
    conditions.accountId = accountId
  }

  if (days !== undefined && days > 0) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    conditions.receivedAt = { $lt: cutoffDate }
  }

  try {
    const result = await context.database.remove(TABLE_MAILS, conditions)
    logger.info(LogModule.CLEANUP, `删除 ${result.matched} 封邮件`)
    return { deleted: result.matched }
  } catch (err) {
    logger.error(LogModule.CLEANUP, `删除失败`)
    throw err
  }
}

export async function markAsRead(id: number): Promise<void> {
  await context.database.set(TABLE_MAILS, { id }, { isRead: true })
}

export async function forwardMail(mailId: number, ruleId?: number): Promise<void> {
  const mail = await getMail(mailId)
  if (!mail) throw new Error('邮件不存在')

  const rule = await findMatchingRule(mail, ruleId)
  if (!rule) throw new Error('没有匹配的转发规则')

  await executeForward(mail, rule)

  await context.database.set(TABLE_MAILS, { id: mailId }, {
    isForwarded: true,
    forwardedAt: new Date(),
  })
}

// ============ 邮件管理辅助函数 ============

async function fetchExistingMessageIds(accountId: number): Promise<Set<string>> {
  logger.debug(LogModule.SYNC, '正在加载已有邮件 ID...')
  // 优化：只查询 messageId 字段，减少数据传输
  const existingMails = await context.database
    .select(TABLE_MAILS, ['messageId'])
    .where({ accountId })
    .execute()

  const ids = new Set(existingMails.map(m => m.messageId))
  logger.debug(LogModule.SYNC, `已加载 ${ids.size} 个已有邮件`)
  return ids
}

async function processMailBatch(
  accountId: number,
  batchMails: ParsedMail[],
  existingMessageIds: Set<string>
): Promise<{ saved: number; skipped: number }> {
  const newMails: Omit<StoredMail, 'id'>[] = []
  let skipped = 0

  for (const mail of batchMails) {
    const converted = convertParsedMail(accountId, mail)

    if (existingMessageIds.has(converted.messageId)) {
      skipped++
      continue
    }

    newMails.push({
      ...converted,
      createdAt: new Date(),
    })
    existingMessageIds.add(converted.messageId)
  }

  if (newMails.length === 0) return { saved: 0, skipped }

  // 优化：使用批量插入，大大减少数据库操作次数
  try {
    await context.database.upsert(TABLE_MAILS, newMails)
    const saved = newMails.length
    logger.debug(LogModule.SYNC, `已批量插入 ${saved} 封邮件`)
    return { saved, skipped }
  } catch (err) {
    // 如果批量插入失败，回退到逐条插入
    logger.warn(LogModule.SYNC, `批量插入失败，切换到逐条插入: ${(err as Error).message}`)

    const insertPromises = newMails.map(mail =>
      context.database.create(TABLE_MAILS, mail).catch(err => {
        logger.warn(LogModule.SYNC, `保存邮件失败 (${mail.messageId})`)
        return null
      })
    )

    const results = await Promise.all(insertPromises)
    const saved = results.filter(r => r !== null).length
    return { saved, skipped }
  }
}

function buildMailQueryConditions(query: MailListQuery): any {
  const conditions: any = {}
  if (query.accountId) conditions.accountId = query.accountId
  if (typeof query.isRead === 'boolean') conditions.isRead = query.isRead
  if (typeof query.isForwarded === 'boolean') conditions.isForwarded = query.isForwarded

  if (query.startDate || query.endDate) {
    conditions.receivedAt = {}
    if (query.startDate) conditions.receivedAt.$gte = new Date(query.startDate)
    if (query.endDate) conditions.receivedAt.$lte = new Date(query.endDate)
  }

  if (query.keyword) {
    const kw = `%${query.keyword}%`
    conditions.$or = [
      { subject: { $regex: kw, $options: 'i' } },
      { 'from.address': { $regex: kw, $options: 'i' } },
      { textContent: { $regex: kw, $options: 'i' } }
    ]
  }
  return conditions
}

async function findMatchingRule(mail: StoredMail, ruleId?: number): Promise<ForwardRule | null> {
  if (ruleId) {
    const rule = await getRule(ruleId)
    if (!rule) throw new Error('规则不存在')
    return rule
  }

  const rules = await getRules()
  return rules.find(r => r.enabled && matchConditions(mail, r.conditions)) || null
}

// ============ 规则管理 ============

export async function getRules(): Promise<ForwardRule[]> {
  const now = Date.now()
  if (cachedRules && (now - lastRulesCacheUpdate) < RULES_CACHE_TTL_MS) {
    return cachedRules
  }

  cachedRules = await context.database.get(TABLE_RULES, {})
  lastRulesCacheUpdate = now
  return cachedRules
}

export async function getRule(id: number): Promise<ForwardRule | null> {
  const [rule] = await context.database.get(TABLE_RULES, { id })
  return rule || null
}

export async function createRule(data: Partial<ForwardRule>): Promise<ForwardRule> {
  const now = new Date()
  const rule = await context.database.create(TABLE_RULES, {
    name: data.name || '新规则',
    description: data.description,
    enabled: data.enabled ?? true,
    accountId: data.accountId,
    conditions: data.conditions || [],
    targets: data.targets || [],
    elements: data.elements || [...DEFAULT_FORWARD_ELEMENTS],
    customCss: data.customCss,
    renderConfig: data.renderConfig || { ...DEFAULT_RENDER_CONFIG },
    createdAt: now,
    updatedAt: now,
  })

  logger.info(LogModule.RULE, `创建规则 "${rule.name}"`)
  invalidateRulesCache()
  return rule
}

export async function updateRule(id: number, data: Partial<ForwardRule>): Promise<ForwardRule> {
  const [existing] = await context.database.get(TABLE_RULES, { id })
  if (!existing) throw new Error(`规则不存在: ${id}`)

  await context.database.set(TABLE_RULES, { id }, {
    ...data,
    updatedAt: new Date(),
  })

  invalidateRulesCache()
  return (await getRule(id))!
}

export async function deleteRule(id: number): Promise<void> {
  await context.database.remove(TABLE_RULES, { id })
  invalidateRulesCache()
  logger.info(LogModule.RULE, `删除规则 #${id}`)
}

function invalidateRulesCache(): void {
  cachedRules = null
  lastRulesCacheUpdate = 0
}

// ============ 预览与工具 ============

export async function getForwardPreview(request: ForwardPreviewRequest): Promise<ForwardPreviewResponse> {
  const mail = await getMail(request.mailId)
  if (!mail) throw new Error('邮件不存在')

  const config = await resolvePreviewConfig(request)

  return await mailRenderer.generatePreview(
    mail,
    config.elements,
    config.customCss,
    config.renderConfig
  )
}

export async function getAvailableTargets(): Promise<ForwardTarget[]> {
  const targets: ForwardTarget[] = []

  for (const bot of context.bots) {
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

  if (request.ruleId) {
    const rule = await getRule(request.ruleId)
    if (rule) {
      elements = elements || rule.elements
      customCss = customCss ?? rule.customCss
      renderConfig = renderConfig || rule.renderConfig
    }
  }

  return {
    elements: elements || [...DEFAULT_FORWARD_ELEMENTS],
    customCss,
    renderConfig: { ...DEFAULT_RENDER_CONFIG, ...renderConfig }
  }
}

// ============ 内部处理逻辑 ============

async function handleNewMail(account: MailAccount, parsedMail: ParsedMail): Promise<void> {
  try {
    // 验证邮件数据完整性
    if (!validateParsedMail(parsedMail)) {
      logger.warn(LogModule.SYNC, `邮件数据不完整，已跳过`)
      return
    }

    const mailData = convertParsedMail(account.id, parsedMail)

    // 验证转换后的数据
    if (!validateMailData(mailData)) {
      logger.warn(LogModule.SYNC, `邮件转换数据无效，已跳过`)
      return
    }

    // 检查邮件是否存在
    if (await checkMailExists(account.id, mailData.messageId)) {
      logger.debug(LogModule.SYNC, `邮件已存在`)
      return
    }

    // 并行保存邮件和获取转发规则
    const [mail, rules] = await Promise.all([
      saveNewMail(account.id, mailData),
      getRules()
    ])

    logger.info(LogModule.SYNC, `收到邮件 "${mail.subject}"`)

    // 异步处理转发，不阻塞主流程
    processAutoForwardingAsync(account, mail, rules).catch(e => {
      logger.error(LogModule.FORWARD, `转发处理失败: ${(e as Error).message}`)
    })
  } catch (e) {
    logger.error(LogModule.SYNC, `处理邮件失败: ${(e as Error).message}`)
  }
}

async function checkMailExists(accountId: number, messageId: string): Promise<boolean> {
  const existing = await context.database.get(TABLE_MAILS, {
    accountId,
    messageId,
  })
  return existing.length > 0
}

/**
 * 验证解析后的邮件数据
 */
function validateParsedMail(mail: ParsedMail): boolean {
  if (!mail) {
    logger.debug(LogModule.SYNC, '邮件对象为空')
    return false
  }

  // 验证发件人
  if (!mail.from || (Array.isArray(mail.from) && mail.from.length === 0)) {
    logger.debug(LogModule.SYNC, '邮件缺少发件人信息')
    return false
  }

  // 验证邮件内容（至少有一项）
  const hasContent = mail.subject || mail.text || mail.html
  if (!hasContent) {
    logger.debug(LogModule.SYNC, '邮件缺少内容（主题/正文/HTML）')
    return false
  }

  return true
}

/**
 * 验证转换后的邮件数据
 */
function validateMailData(mailData: Omit<StoredMail, 'id' | 'createdAt'>): boolean {
  // 验证 messageId
  if (!mailData.messageId || mailData.messageId.length === 0) {
    logger.debug(LogModule.SYNC, '邮件缺少 messageId')
    return false
  }

  // 验证发件人
  if (!mailData.from || !mailData.from.address) {
    logger.debug(LogModule.SYNC, '邮件发件人数据无效')
    return false
  }

  // 验证主题
  if (!mailData.subject || mailData.subject.length === 0) {
    logger.debug(LogModule.SYNC, '邮件缺少主题')
    return false
  }

  // 验证时间
  if (!mailData.receivedAt || !(mailData.receivedAt instanceof Date)) {
    logger.debug(LogModule.SYNC, '邮件接收时间无效')
    return false
  }

  return true
}

async function saveNewMail(accountId: number, mailData: any): Promise<StoredMail> {
  return await context.database.create(TABLE_MAILS, {
    accountId,
    ...mailData,
    isRead: false,
    isForwarded: false,
    createdAt: new Date(),
  })
}

async function processAutoForwardingAsync(account: MailAccount, mail: StoredMail, rules: ForwardRule[]): Promise<void> {
  for (const rule of rules) {
    if (!shouldApplyRule(rule, account, mail)) continue

    try {
      await executeForward(mail, rule)
      await markAsForwarded(mail.id)
      logger.info(LogModule.FORWARD, `已转发邮件 ${mail.id}`)
    } catch (e) {
      logger.error(LogModule.FORWARD, `转发失败: ${(e as Error).message}`)
    }
  }
}

function shouldApplyRule(rule: ForwardRule, account: MailAccount, mail: StoredMail): boolean {
  if (!rule.enabled) return false
  if (rule.accountId && rule.accountId !== account.id) return false
  return matchConditions(mail, rule.conditions)
}

async function markAsForwarded(mailId: number): Promise<void> {
  await context.database.set(TABLE_MAILS, { id: mailId }, {
    isForwarded: true,
    forwardedAt: new Date(),
  })
}

function matchConditions(mail: StoredMail, conditions: ForwardCondition[]): boolean {
  if (conditions.length === 0) return true

  for (const condition of conditions) {
    let matched = false

    try {
      matched = checkSingleCondition(mail, condition)
    } catch {
      matched = false
    }

    if (condition.negate) matched = !matched
    if (!matched) return false
  }

  return true
}

function checkSingleCondition(mail: StoredMail, condition: ForwardCondition): boolean {
  const value = condition.value.toLowerCase()

  switch (condition.type) {
    case 'all':
      return true
    case 'subject_contains':
      return mail.subject?.toLowerCase().includes(value) || false
    case 'subject_regex':
      return new RegExp(condition.value, 'i').test(mail.subject || '')
    case 'from_contains':
      return mail.from?.address?.toLowerCase().includes(value) || false
    case 'from_regex':
      return new RegExp(condition.value, 'i').test(mail.from?.address || '')
    case 'to_contains':
      return mail.to?.some(t => t.address?.toLowerCase().includes(value)) || false
    case 'body_contains':
      return mail.textContent?.toLowerCase().includes(value) || false
    case 'body_regex':
      return new RegExp(condition.value, 'i').test(mail.textContent || '')
    default:
      return false
  }
}

async function executeForward(mail: StoredMail, rule: ForwardRule): Promise<void> {
  const messageContent = await generateForwardContent(mail, rule)
  await broadcastToTargets(rule.targets, messageContent)
}

async function generateForwardContent(mail: StoredMail, rule: ForwardRule): Promise<any> {
  return await mailRenderer.generateForwardElements(mail, rule)
}

async function broadcastToTargets(targets: ForwardTarget[], content: any): Promise<void> {
  for (const target of targets) {
    const bot = context.bots.find(b =>
      b.platform === target.platform && b.selfId === target.selfId && b.isActive
    )

    if (!bot) {
      logger.warn(LogModule.FORWARD, `Bot 未找到: ${target.platform} (${target.selfId})`)
      continue
    }

    try {
      await bot.sendMessage(target.channelId, content)
      logger.debug(LogModule.FORWARD, `已发送到 ${target.displayName}`)
    } catch (e) {
      logger.error(LogModule.FORWARD, `发送失败: ${(e as Error).message}`)
    }
  }
}
