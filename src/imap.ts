/**
 * IMAP 邮件连接管理模块
 *
 * 本模块负责管理与 IMAP 服务器的连接生命周期，包括：
 * 1. 建立与断开连接
 * 2. 自动重连机制
 * 3. 邮件监听与实时通知
 * 4. 历史邮件同步
 *
 * 设计原则：Clean Code (清晰命名、单一职责、高可读性)
 */

import { ImapFlow } from 'imapflow'
import { Context } from 'koishi'
import type { MailAccount, MailAddress, MailAttachment, StoredMail } from './types'
import { getLogger } from './logger'
import { parseMail, type ParsedMail } from './parser'
import { MailProviderFactory, type MailProviderAdapter } from './providers'
import {
  sleep,
  chunkArray,
  withTimeout,
  generateRandomId,
  formatString,
  resolveDns,
  getFriendlyErrorMessage,
} from './utils'

// ==================== 配置常量 ====================

const SYNC_STRATEGY = {
  BATCH_SIZE: 30,
  FETCH_TIMEOUT: 30000,
  RETRY_THRESHOLD: 50,
  EXTENDED_TIMEOUT: 60000,
  SMALL_IMAGE_LIMIT: 500 * 1024, // 500KB
} as const

const CONNECTION_STRATEGY = {
  TIMEOUT: 10000,
  DISCONNECT_WAIT: 200,
  DISCONNECT_TIMEOUT: 3000,
  MAX_DISCONNECT_WAIT: 5000,
  POLL_INTERVAL: 100,
} as const

// ==================== 日志工具 ====================

/**
 * 安全日志代理
 * 封装底层 logger，提供异常捕获和格式化功能
 */
class SafeLogger {
  private get logger() {
    return getLogger()
  }

  info(message: string, ...args: any[]) {
    this.log('info', message, args)
  }

  warn(message: string, ...args: any[]) {
    this.log('warn', message, args)
  }

  error(message: string, ...args: any[]) {
    this.log('error', message, args)
  }

  debug(message: string, ...args: any[]) {
    this.log('debug', message, args)
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, args: any[]) {
    try {
      const formattedMessage = formatString(message, args)
      this.logger[level]('', formattedMessage)
    } catch {
      // 忽略日志记录过程中的错误，防止影响主流程
    }
  }
}

const logger = new SafeLogger()

// ==================== 核心类：ImapConnection ====================

/**
 * IMAP 连接管理器
 *
 * 维护单个邮箱账号的 IMAP 会话。
 * 采用状态机思想管理连接状态（Connecting, Connected, Disconnecting, Disconnected）。
 */
export class ImapConnection {
  private imapFlow: ImapFlow | null = null
  private mailboxLock: any = null

  // 状态标志
  private state = {
    isConnecting: false,
    isConnected: false,
    isDisconnecting: false,
    manualDisconnect: false // 标记是否为手动断开
  }

  // 重连控制
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private lastConnectError: Error | null = null

  // 健康检查
  private healthCheckTimer: NodeJS.Timeout | null = null
  private lastHealthCheck: number = 0

  // 缓存属性
  private readonly provider: MailProviderAdapter
  private readonly retentionDays: number

  constructor(
    private readonly ctx: Context,
    private readonly account: MailAccount,
    private readonly config: {
      mailRetentionDays: number
      autoReconnect: boolean
      maxReconnectAttempts: number
      reconnectInterval: number
      connectionTimeout: number
      healthCheckEnabled: boolean
      healthCheckInterval: number
    },
    private readonly onMailReceived: (mail: ParsedMail) => void,
    private readonly onStatusChanged?: (status: MailAccount['status'], error?: string) => void
  ) {
    this.provider = MailProviderFactory.getProvider(account)
    this.retentionDays = config.mailRetentionDays
    logger.info('Using provider: %s for %s', this.provider.displayName, account.email)
  }

  // ==================== 公共 API ====================

  /**
   * 获取当前连接状态
   */
  get status(): MailAccount['status'] {
    if (this.state.isConnecting) return 'connecting'
    if (this.state.isConnected) return 'connected'
    return 'disconnected'
  }

  /**
   * 建立连接
   *
   * 执行完整的连接流程：
   * 1. 确保前序断开完成
   * 2. 清理旧连接
   * 3. 初始化客户端
   * 4. 建立网络连接
   * 5. 开启收件箱监听
   */
  async connect(): Promise<void> {
    await this.ensurePreviousDisconnectCompletes()
    await this.disconnectIfActive()

    this.state.manualDisconnect = false
    this.cancelReconnect()
    this.markAsConnecting()

    try {
      await this.initializeAndConnect()
      this.markAsConnected()
      await this.startInboxListener()
      this.startHealthCheck()
    } catch (error) {
      this.handleConnectionFailure(error as Error)
      throw error
    }
  }

  /**
   * 断开连接
   *
   * 安全地释放所有资源：
   * 1. 取消重连计划
   * 2. 释放邮箱锁
   * 3. 关闭 IMAP 会话
   * 4. 清理内存引用
   */
  async disconnect(): Promise<void> {
    this.state.manualDisconnect = true
    this.stopHealthCheck()

    if (this.state.isDisconnecting) {
      logger.debug('Already disconnecting %s', this.account.email)
      return
    }

    this.state.isDisconnecting = true
    const wasActive = this.state.isConnected || this.reconnectTimer

    try {
      this.cancelReconnect()
      this.releaseLock()
      await this.closeImapSession()
      this.resetState()

      logger.info('Disconnected from %s', this.account.email)

      if (wasActive) {
        this.notifyStatus('disconnected')
      }
    } finally {
      this.state.isDisconnecting = false
    }
  }

  /**
   * 重置重连计数器
   * 通常在手动触发连接时调用
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0
  }

  /**
   * 同步邮件
   *
   * @param days 同步最近 N 天的邮件（可选）
   * @param onBatch 批次处理回调
   */
  async syncMails(days?: number, onBatch?: (mails: ParsedMail[]) => Promise<void>): Promise<{ total: number; synced: number }> {
    this.assertConnected()

    return await this.withMailboxLock(async () => {
      const uids = await this.findMailsToSync(days)

      if (uids.length === 0) {
        logger.info('No mails to sync for %s', this.account.email)
        return { total: 0, synced: 0 }
      }

      logger.info('Found %d mails to sync for %s', uids.length, this.account.email)

      const result = await this.processMailSyncBatches(uids, onBatch)
      this.logSyncSummary(result, uids.length)

      return { total: uids.length, synced: result.synced }
    })
  }

  /**
   * 静态测试方法
   */
  static async testConnection(account: Partial<MailAccount>): Promise<{ success: boolean; message: string }> {
    try {
      const provider = MailProviderFactory.getProvider(account as MailAccount)
      const config = provider.getImapConfig(account as MailAccount)
      const client = new ImapFlow(config as any)
      await client.connect()
      await client.logout()
      return { success: true, message: '连接测试成功' }
    } catch (error) {
      return { success: false, message: (error as Error).message }
    }
  }

  // ==================== 内部逻辑：连接管理 ====================

  private async ensurePreviousDisconnectCompletes(): Promise<void> {
    if (!this.state.isDisconnecting) return

    logger.debug('Waiting for previous disconnect to complete for %s', this.account.email)

    const maxChecks = CONNECTION_STRATEGY.MAX_DISCONNECT_WAIT / CONNECTION_STRATEGY.POLL_INTERVAL
    for (let i = 0; i < maxChecks; i++) {
      if (!this.state.isDisconnecting) return
      await sleep(CONNECTION_STRATEGY.POLL_INTERVAL)
    }

    throw new Error('等待上一次断开超时')
  }

  private async disconnectIfActive(): Promise<void> {
    if (this.imapFlow || this.state.isConnecting) {
      logger.debug('Account %s active, disconnecting first', this.account.email)
      await this.disconnect()
      await sleep(CONNECTION_STRATEGY.DISCONNECT_WAIT)
    }
  }

  private markAsConnecting(): void {
    this.state.isConnecting = true
    this.state.isConnected = false
    logger.info('Connecting to %s...', this.account.email)
    this.notifyStatus('connecting')
  }

  private markAsConnected(): void {
    this.state.isConnecting = false
    this.state.isConnected = true
    this.reconnectAttempts = 0
    this.cancelReconnect()
    this.notifyStatus('connected')
    logger.info('IMAP connected for %s', this.account.email)
  }

  private async initializeAndConnect(): Promise<void> {
    const proxyUrl = this.account.proxyUrl || undefined
    let resolvedHost = this.account.imapHost

    // 使用代理时，直接使用域名（让代理处理 DNS）
    // 不使用代理时，通过 provider 的 DNS 策略解析
    if (!proxyUrl) {
      const dnsResult = await resolveDns(
        this.account.imapHost,
        this.provider.getDnsStrategy(),
        {
          maxAttempts: 3,
          retryDelay: 1000,
          forceIPv4: true,
          logger,
        }
      )

      resolvedHost = dnsResult.selectedAddress

      if (dnsResult.allAddresses.length > 1) {
        logger.info('[DNS] Resolved %s -> [%s], selected: %s%s',
          this.account.imapHost,
          dnsResult.allAddresses.join(', '),
          resolvedHost,
          dnsResult.isPreferred ? ' (优选)' : '')
      } else if (dnsResult.allAddresses.length === 1) {
        logger.info('[DNS] Resolved %s -> %s', this.account.imapHost, resolvedHost)
      }
    } else {
      logger.info('[PROXY] Using domain name %s directly (proxy will resolve DNS)', this.account.imapHost)
    }

    // 使用 provider 生成配置
    const providerConfig = this.provider.getImapConfig(this.account, resolvedHost, proxyUrl)

    // 应用配置的超时时间
    const connectionTimeout = this.provider.getConnectionTimeout(this.config.connectionTimeout)
    const config = {
      ...providerConfig,
      greetingTimeout: connectionTimeout,
      socketTimeout: connectionTimeout * 2,
    }

    logger.info('[%s] Config: host=%s (original: %s), port=%d, proxy=%s, timeout=%ds',
      this.provider.name, config.host, this.account.imapHost, config.port, proxyUrl || 'none', this.config.connectionTimeout)

    this.imapFlow = new ImapFlow(config as any)

    this.bindClientEvents()
    await this.imapFlow.connect()
  }

  private bindClientEvents(): void {
    if (!this.imapFlow) return

    this.imapFlow.on('close', () => this.handleConnectionClosed())
    this.imapFlow.on('error', (err) => {
      logger.error('IMAP error for %s: %s', this.account.email, err.message)
    })
  }

  private handleConnectionFailure(error: Error): void {
    this.state.isConnecting = false
    this.state.isConnected = false
    this.lastConnectError = error

    // 使用 provider 的自定义错误匹配规则获取友好消息
    const friendlyMsg = getFriendlyErrorMessage(
      error,
      this.account.imapHost,
      this.provider.getCustomErrorMatchers()
    )
    logger.error('Connection failed for %s: %s', this.account.email, friendlyMsg)

    this.cleanupClient()
    this.notifyStatus('error', friendlyMsg)

    // 检查是否应该重试
    const shouldRetry = this.provider.shouldRetryOnError(error)
    if (shouldRetry) {
      this.tryScheduleReconnect()
    } else {
      logger.warn('Error is not retryable for %s: %s', this.account.email, error.message)
    }
  }

  private handleConnectionClosed(): void {
    const { isConnected, isConnecting, manualDisconnect } = this.state
    this.resetState()

    if (manualDisconnect) {
      logger.info('Manual disconnect for %s', this.account.email)
      return
    }

    if (isConnected) {
      logger.info('Connection closed for %s', this.account.email)
      this.notifyStatus('disconnected')
      this.tryScheduleReconnect()
    } else if (isConnecting) {
      logger.warn('Connection closed during handshake for %s', this.account.email)
      this.tryScheduleReconnect()
    }
  }

  // ==================== 内部逻辑：重连机制 ====================

  private tryScheduleReconnect(): void {
    if (this.state.isConnected || this.state.isConnecting) {
      logger.debug('Already connected or connecting for %s, skip reconnect', this.account.email)
      return
    }

    if (!this.config.autoReconnect) {
      logger.info('Auto-reconnect disabled for %s', this.account.email)
      return
    }

    if (!this.account.enabled || this.reconnectTimer) return

    this.reconnectAttempts++

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      logger.warn('Max reconnect attempts reached for %s (%d/%d)',
        this.account.email, this.reconnectAttempts, this.config.maxReconnectAttempts)
      this.notifyStatus('error', `已达到最大重连次数 (${this.config.maxReconnectAttempts})`)
      return
    }

    const delay = this.calculateReconnectDelay()
    logger.info('Scheduling reconnect for %s in %ds (Attempt %d/%d)',
      this.account.email, Math.floor(delay / 1000), this.reconnectAttempts, this.config.maxReconnectAttempts)

    this.reconnectTimer = setTimeout(() => this.executeReconnect(), delay)
  }

  private async executeReconnect(): Promise<void> {
    this.reconnectTimer = null

    if (this.state.isConnected) {
      logger.debug('Already connected for %s, skip reconnect execution', this.account.email)
      return
    }

    if (!this.account.enabled) return

    try {
      await this.connect()
      logger.info('Reconnection successful for %s (attempt %d)', this.account.email, this.reconnectAttempts)
    } catch (error) {
      logger.debug('Reconnection failed for %s: %s', this.account.email, (error as Error).message)
    }
  }

  private calculateReconnectDelay(): number {
    return this.provider.getReconnectDelay(this.reconnectAttempts, this.config.reconnectInterval)
  }

  // ==================== 内部逻辑：健康检查 ====================

  private startHealthCheck(): void {
    if (!this.config.healthCheckEnabled) return

    this.stopHealthCheck()

    const intervalMs = this.config.healthCheckInterval * 1000
    logger.debug('Starting health check for %s (interval: %ds)', this.account.email, this.config.healthCheckInterval)

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, intervalMs)

    this.lastHealthCheck = Date.now()
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
      logger.debug('Stopped health check for %s', this.account.email)
    }
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now()
    this.lastHealthCheck = now

    if (!this.state.isConnected || !this.imapFlow) {
      logger.debug('Health check: %s not connected', this.account.email)
      return
    }

    try {
      await this.imapFlow.noop()
      logger.debug('Health check: %s OK', this.account.email)
    } catch (error) {
      logger.warn('Health check failed for %s: %s', this.account.email, (error as Error).message)
      this.state.isConnected = false
      this.handleConnectionClosed()
    }
  }

  // ==================== 内部逻辑：邮件监听 ====================

  private async startInboxListener(): Promise<void> {
    if (!this.imapFlow) return

    await this.imapFlow.mailboxOpen('INBOX')
    logger.info('INBOX opened for %s', this.account.email)

    await this.scanUnseenMails()

    this.imapFlow.on('exists', async (data) => {
      logger.debug('New mail event for %s: %d messages', this.account.email, data.count)
      this.scanUnseenMails().catch(err => {
        logger.error('Scan failed after event: %s', err.message)
      })
    })
  }

  private async scanUnseenMails(): Promise<void> {
    await this.withMailboxLock(async () => {
      const uids = await this.searchUnseenUids()

      if (uids.length === 0) return

      logger.info('Found %d unseen mails for %s', uids.length, this.account.email)

      const CONCURRENT_LIMIT = 5
      for (let i = 0; i < uids.length; i += CONCURRENT_LIMIT) {
        const batch = uids.slice(i, i + CONCURRENT_LIMIT)
        await Promise.all(batch.map(uid => this.fetchAndNotifyMail(uid)))
      }
    })
  }

  private async searchUnseenUids(): Promise<number[]> {
    if (!this.imapFlow) return []

    const criteria: any = { seen: false }

    if (this.retentionDays > 0) {
      const since = new Date()
      since.setDate(since.getDate() - this.retentionDays)
      criteria.since = since
      logger.debug('Searching unseen mails since %s (retention: %d days)',
        since.toISOString().split('T')[0], this.retentionDays)
    }

    const results = await this.imapFlow.search(criteria, { uid: true })
    return results || []
  }

  private async fetchAndNotifyMail(uid: number): Promise<void> {
    try {
      const mail = await this.downloadMail(uid)
      if (mail) {
        await this.markAsSeen(uid)
        this.onMailReceived(mail)
      }
    } catch (err) {
      logger.error('Failed to process mail %s: %s', uid, (err as Error).message)
    }
  }

  // ==================== 内部逻辑：邮件同步 ====================

  private async findMailsToSync(days?: number): Promise<number[]> {
    if (!this.imapFlow) return []

    const criteria: any = { all: true }
    if (days && days > 0) {
      const since = new Date()
      since.setDate(since.getDate() - days)
      criteria.since = since
    }

    const results = await this.imapFlow.search(criteria, { uid: true })
    return results || []
  }

  private async processMailSyncBatches(
    allUids: number[],
    onBatch?: (mails: ParsedMail[]) => Promise<void>
  ): Promise<{ synced: number; skipped: number[] }> {

    const batches = chunkArray(allUids, SYNC_STRATEGY.BATCH_SIZE)
    let totalSynced = 0
    const skippedUids: number[] = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const { mails, timeouts } = await this.fetchBatch(batch, i + 1, batches.length)

      skippedUids.push(...timeouts)
      totalSynced += mails.length

      if (onBatch && mails.length > 0) {
        await onBatch(mails)
      }
    }

    if (skippedUids.length > 0 && skippedUids.length < SYNC_STRATEGY.RETRY_THRESHOLD) {
      const retried = await this.retrySkippedMails(skippedUids, onBatch)
      totalSynced += retried
    }

    return { synced: totalSynced, skipped: skippedUids }
  }

  private async fetchBatch(uids: number[], index: number, total: number) {
    const start = Date.now()
    logger.info('Syncing batch %d/%d (%d mails)...', index, total, uids.length)

    const promises = uids.map(uid => this.downloadMailWithTimeout(uid, SYNC_STRATEGY.FETCH_TIMEOUT))
    const results = await Promise.all(promises)

    const mails = results.filter((m): m is ParsedMail => m !== null)
    const timeouts = uids.filter((_, i) => results[i] === null)

    const duration = Date.now() - start
    logger.info('Batch %d done in %dms. Success: %d, Timeout: %d',
      index, duration, mails.length, timeouts.length)

    return { mails, timeouts }
  }

  private async retrySkippedMails(uids: number[], onBatch?: (mails: ParsedMail[]) => Promise<void>): Promise<number> {
    logger.info('Retrying %d timed out mails...', uids.length)

    const mails: ParsedMail[] = []
    for (const uid of uids) {
      const mail = await this.downloadMailWithTimeout(uid, SYNC_STRATEGY.EXTENDED_TIMEOUT)
      if (mail) mails.push(mail)
    }

    if (onBatch && mails.length > 0) {
      await onBatch(mails)
    }

    return mails.length
  }

  private async downloadMailWithTimeout(uid: number, timeoutMs: number): Promise<ParsedMail | null> {
    return withTimeout(
      this.downloadMail(uid).then(m => m || null),
      timeoutMs,
      null
    )
  }

  private async downloadMail(uid: number): Promise<ParsedMail | null> {
    if (!this.imapFlow) return null

    try {
      const message = await this.imapFlow.fetchOne(String(uid), { source: true }, { uid: true })
      if (!message || !message.source) {
        logger.warn('Mail %s has no source data', uid)
        return null
      }

      const parsedMail = await parseMail(message.source as Buffer)

      if (!this.validateMail(parsedMail)) {
        logger.warn('Mail %s validation failed, skipping', uid)
        return null
      }

      return parsedMail
    } catch (err) {
      logger.error('Failed to download/parse mail %s: %s', uid, (err as Error).message)
      return null
    }
  }

  private async markAsSeen(uid: number): Promise<void> {
    if (!this.imapFlow) return
    await this.imapFlow.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
  }

  // ==================== 辅助方法 ====================

  private async withMailboxLock<T>(action: () => Promise<T>): Promise<T> {
    if (!this.imapFlow) throw new Error('Client not initialized')

    try {
      this.mailboxLock = await this.imapFlow.getMailboxLock('INBOX')
      return await action()
    } catch (err) {
      logger.error('Mailbox operation failed: %s', (err as Error).message)
      throw err
    } finally {
      this.releaseLock()
    }
  }

  private releaseLock(): void {
    if (this.mailboxLock) {
      try { this.mailboxLock.release() } catch {}
      this.mailboxLock = null
    }
  }

  private cleanupClient(): void {
    if (this.imapFlow) {
      this.imapFlow.removeAllListeners()
      try { this.imapFlow.close() } catch {}
      this.imapFlow = null
    }
  }

  private async closeImapSession(): Promise<void> {
    if (!this.imapFlow) return

    this.imapFlow.removeAllListeners()
    await Promise.race([
      this.imapFlow.close(),
      sleep(CONNECTION_STRATEGY.DISCONNECT_TIMEOUT)
    ])
    this.imapFlow = null
  }

  private resetState(): void {
    this.imapFlow = null
    this.state.isConnecting = false
    this.state.isConnected = false
    this.mailboxLock = null
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private notifyStatus(status: MailAccount['status'], error?: string): void {
    this.onStatusChanged?.(status, error)
  }

  private assertConnected(): void {
    if (!this.imapFlow || !this.state.isConnected) {
      throw new Error('未连接到邮箱服务器')
    }
  }

  private logSyncSummary(result: { synced: number; skipped: number[] }, total: number): void {
    logger.info('Sync completed. Total: %d, Synced: %d, Skipped: %d',
      total, result.synced, result.skipped.length)
  }

  private validateMail(mail: ParsedMail | null): mail is ParsedMail {
    if (!mail) {
      logger.debug('Mail is null')
      return false
    }

    if (!mail.from || (Array.isArray(mail.from) && mail.from.length === 0)) {
      logger.debug('Mail has no sender (from field)')
      return false
    }

    if (!mail.subject && !mail.text && !mail.html) {
      logger.debug('Mail has no content (subject, text, or html)')
      return false
    }

    if (!mail.messageId) {
      logger.debug('Mail has no messageId, will generate one')
    }

    return true
  }
}

// ==================== 数据转换工具 ====================

export function parseMailAddress(addr: any): MailAddress {
  if (typeof addr === 'string') return { address: addr }
  return {
    name: addr?.name,
    address: addr?.address || '',
  }
}

export function parseMailAddresses(addrs: any): MailAddress[] {
  if (!addrs) return []
  if (Array.isArray(addrs.value)) return addrs.value.map(parseMailAddress)
  if (addrs.address) return [parseMailAddress(addrs)]
  return []
}

export function convertParsedMail(accountId: number, mail: ParsedMail): Omit<StoredMail, 'id' | 'createdAt'> {
  return {
    accountId,
    messageId: mail.messageId || generateRandomId(),
    from: parseMailAddresses(mail.from)[0] || { address: 'unknown' },
    to: parseMailAddresses(mail.to),
    cc: parseMailAddresses(mail.cc),
    subject: mail.subject || '(无主题)',
    textContent: mail.text,
    htmlContent: mail.html || undefined,
    attachments: processAttachments(mail.attachments),
    receivedAt: mail.date || new Date(),
    isRead: false,
    isForwarded: false,
    forwardedAt: undefined,
  }
}

function processAttachments(attachments?: any[]): MailAttachment[] {
  if (!attachments) return []

  return attachments.map(att => {
    const isSmallImage = att.contentType.startsWith('image/') &&
                        att.content &&
                        att.size < SYNC_STRATEGY.SMALL_IMAGE_LIMIT

    return {
      filename: att.filename || 'unknown',
      contentType: att.contentType,
      size: att.size,
      cid: att.cid,
      content: isSmallImage ? (att.content as Buffer).toString('base64') : undefined
    }
  })
}
