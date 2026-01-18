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
  resolveDnsWithConnectivityTest,
  getFriendlyErrorMessage,
} from './utils'

// ==================== 配置常量 ====================

const SYNC_STRATEGY = {
  BATCH_SIZE: 30,
  FETCH_TIMEOUT: 30000,
  RETRY_THRESHOLD: 50,
  EXTENDED_TIMEOUT: 60000,
  SMALL_IMAGE_LIMIT: 500 * 1024, // 500KB
  MAX_MAIL_SIZE: 25 * 1024 * 1024, // 25MB - 单封邮件最大大小
  MAX_BATCH_SIZE: 100 * 1024 * 1024, // 100MB - 单批次最大总大小
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
  private reconnectTimer: (() => void) | null = null
  private reconnectAttempts = 0
  private lastConnectError: Error | null = null

  // 健康检查
  private healthCheckTimer: (() => void) | null = null
  private lastHealthCheck: number = 0

  // 轮询检查定时器
  private pollTimer: (() => void) | null = null
  private lastMailCount: number = 0
  private healthCheckFailCount: number = 0
  private readonly maxHealthCheckFailures: number = 3

  // 生命周期标志：标记是否已被销毁
  private disposed = false

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
      enableConnectivityTest: boolean
      connectivityTestTimeout: number
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
  async connect(): Promise<void> {    // 检查是否已销毁
    if (this.disposed) {
      logger.debug('Connection %s already disposed, skip connect', this.account.email)
      return
    }
    // 立即取消任何待定的重连，防止竞态
    this.cancelReconnect()

    await this.ensurePreviousDisconnectCompletes()
    await this.disconnectIfActive()

    this.state.manualDisconnect = false
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
   * 1. 标记为已销毁，阻止后续操作
   * 2. 停止健康检查
   * 3. 取消重连计划
   * 4. 释放邮箱锁
   * 5. 关闭 IMAP 会话
   * 6. 清理内存引用
   */
  async disconnect(): Promise<void> {
    // 防止重复调用
    if (this.disposed) {
      logger.debug('Already disposed %s, skip disconnect', this.account.email)
      return
    }

    // 首先标记为已销毁，阻止所有后续操作
    this.disposed = true
    this.state.manualDisconnect = true

    // 立即停止健康检查（在任何其他操作之前）
    this.stopHealthCheck()

    // 停止轮询
    this.stopPolling()

    // 立即取消重连（在检查 isDisconnecting 之前）
    this.cancelReconnect()

    if (this.state.isDisconnecting) {
      logger.debug('Already disconnecting %s', this.account.email)
      return
    }

    this.state.isDisconnecting = true
    const wasActive = this.state.isConnected

    try {
      // 等待短暂时间，确保所有进行中的回调能检查到 disposed 状态
      await sleep(100)

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
    let proxyRequired = false

    // 使用代理时，直接使用域名（让代理处理 DNS）
    // 不使用代理时，通过 provider 的 DNS 策略解析，并测试连通性
    if (!proxyUrl) {
      const dnsResult = await resolveDnsWithConnectivityTest(
        this.account.imapHost,
        this.account.imapPort,
        this.provider.getDnsStrategy(),
        {
          maxAttempts: 3,
          retryDelay: 1000,
          forceIPv4: true,
          logger,
          connectivityTimeout: this.config.connectivityTestTimeout,
          enableConnectivityTest: this.config.enableConnectivityTest,
          enableBackupDns: true,
        }
      )

      resolvedHost = dnsResult.selectedAddress
      proxyRequired = dnsResult.proxyRequired || false

      if (dnsResult.allAddresses.length > 1) {
        const latencyInfo = dnsResult.latency !== undefined ? `, latency: ${dnsResult.latency}ms` : ''
        logger.info('[DNS] Resolved %s -> [%s], selected: %s%s',
          this.account.imapHost,
          dnsResult.allAddresses.join(', '),
          resolvedHost,
          latencyInfo)
      } else if (dnsResult.allAddresses.length === 1) {
        logger.info('[DNS] Resolved %s -> %s', this.account.imapHost, resolvedHost)
      }

      // 如果检测到需要代理但未配置，给出明确提示
      if (proxyRequired) {
        throw new Error(`无法连接到 ${this.account.imapHost}，所有 IP 均不可达。建议配置代理 (proxyUrl) 或检查网络连接。`)
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
      // 忽略断开连接时的 null 引用错误（ImapFlow 内部问题）
      if (this.disposed || this.state.isDisconnecting) {
        logger.debug('Ignoring error during disconnect: %s', err.message)
        return
      }
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
    // 检查是否已销毁
    if (this.disposed) {
      logger.debug('Connection %s disposed, skip reconnect', this.account.email)
      return
    }

    // 防止重复调度
    if (this.reconnectTimer) {
      logger.debug('Reconnect already scheduled for %s, skip', this.account.email)
      return
    }

    if (this.state.isConnected || this.state.isConnecting) {
      logger.debug('Already connected or connecting for %s, skip reconnect', this.account.email)
      return
    }

    if (!this.config.autoReconnect) {
      logger.info('Auto-reconnect disabled for %s', this.account.email)
      return
    }

    if (!this.account.enabled) return

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

    // 使用 Koishi 托管的定时器
    this.reconnectTimer = this.ctx.setTimeout(() => this.executeReconnect(), delay)
  }

  private async executeReconnect(): Promise<void> {
    this.reconnectTimer = null

    // 首要检查：是否已销毁
    if (this.disposed) {
      logger.debug('Connection %s disposed, abort reconnect', this.account.email)
      return
    }

    // 多重检查，防止竞态
    if (this.state.isConnected || this.state.isConnecting) {
      logger.debug('Already connected/connecting for %s, skip reconnect execution', this.account.email)
      this.reconnectAttempts = 0 // 重置计数
      return
    }

    if (!this.account.enabled) {
      logger.debug('Account %s disabled, skip reconnect', this.account.email)
      return
    }

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

  /**
   * 启动健康检查/心跳机制
   *
   * 心跳间隔的优先级：
   * 1. 如果 provider 要求心跳（requiresHeartbeat），使用 provider 的 heartbeatInterval
   * 2. 否则使用全局配置的 healthCheckInterval
   *
   * 这对于像网易邮箱这样 IDLE 超时较短的服务器非常重要
   */
  private startHealthCheck(): void {
    if (!this.config.healthCheckEnabled) return
    if (this.disposed) return // 已销毁则不启动

    this.stopHealthCheck()

    const features = this.provider.getFeatures()

    // 优先使用 provider 指定的心跳间隔（如果 provider 要求心跳）
    let intervalMs: number
    if (features.requiresHeartbeat && features.heartbeatInterval) {
      intervalMs = features.heartbeatInterval
      logger.info('Using provider heartbeat interval for %s: %ds (provider: %s)',
        this.account.email, Math.floor(intervalMs / 1000), this.provider.name)
    } else {
      intervalMs = this.config.healthCheckInterval * 1000
      logger.debug('Starting health check for %s (interval: %ds)', this.account.email, this.config.healthCheckInterval)
    }

    // 使用 Koishi 托管的定时器
    this.healthCheckTimer = this.ctx.setInterval(() => {
      this.performHealthCheck()
    }, intervalMs)

    this.lastHealthCheck = Date.now()
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      this.healthCheckTimer() // 调用 dispose 函数取消定时器
      this.healthCheckTimer = null
      logger.debug('Stopped health check for %s', this.account.email)
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (this.disposed) return // 已销毁则不执行

    const now = Date.now()
    this.lastHealthCheck = now

    if (!this.state.isConnected || !this.imapFlow) {
      logger.debug('Health check: %s not connected', this.account.email)
      return
    }

    try {
      await this.imapFlow.noop()
      this.healthCheckFailCount = 0 // 重置失败计数
      logger.debug('Health check: %s OK', this.account.email)
    } catch (error) {
      this.healthCheckFailCount++
      logger.warn('Health check failed for %s (%d/%d): %s',
        this.account.email,
        this.healthCheckFailCount,
        this.maxHealthCheckFailures,
        (error as Error).message
      )

      // 只有连续失败超过阈值才触发重连
      if (this.healthCheckFailCount >= this.maxHealthCheckFailures) {
        logger.warn('Health check failed %d times consecutively for %s, triggering reconnect',
          this.healthCheckFailCount, this.account.email)
        this.healthCheckFailCount = 0
        this.state.isConnected = false
        this.handleConnectionClosed()
      }
    }
  }

  // ==================== 内部逻辑：邮件监听 ====================

  private async startInboxListener(): Promise<void> {
    if (!this.imapFlow) return

    const mailbox = await this.imapFlow.mailboxOpen('INBOX')
    logger.info('INBOX opened for %s (exists: %d)', this.account.email, mailbox.exists)

    // 记录当前邮件数量
    this.lastMailCount = mailbox.exists

    // 监听新邮件事件（IDLE 模式下服务器推送）
    this.imapFlow.on('exists', (data) => {
      if (this.disposed) return

      logger.info('[EXISTS] %s: count=%d, prev=%d',
        this.account.email, data.count, data.prevCount)

      // 更新邮件计数
      this.lastMailCount = data.count

      // 邮件数量增加时触发扫描
      if (data.count > data.prevCount) {
        logger.info('New mail detected via EXISTS event for %s', this.account.email)
        this.triggerScan()
      }
    })

    // 先执行初始扫描
    await this.scanUnseenMails()

    // 启动 IDLE 模式
    this.startIdleLoop()

    // 同时启动轮询检查作为备选方案
    // 某些邮箱服务器的 IDLE 实现不可靠，轮询可以确保不遗漏邮件
    this.startPolling()
  }

  // 触发扫描的标志
  private pendingScan: boolean = false
  private isScanning: boolean = false

  private triggerScan(): void {
    if (this.isScanning) {
      // 已经在扫描中，标记需要再次扫描
      this.pendingScan = true
      return
    }

    // 直接执行扫描（不依赖 IDLE 循环）
    this.executeScan()
  }

  private async executeScan(): Promise<void> {
    if (this.isScanning || this.disposed || !this.imapFlow) return

    this.isScanning = true
    try {
      await this.scanUnseenMails()

      // 检查是否有待处理的扫描
      while (this.pendingScan && !this.disposed && this.imapFlow) {
        this.pendingScan = false
        await this.scanUnseenMails()
      }
    } catch (err) {
      logger.error('Scan failed for %s: %s', this.account.email, (err as Error).message)
    } finally {
      this.isScanning = false
    }
  }

  /**
   * 启动轮询检查
   *
   * 作为 IDLE 的备选方案，定期检查是否有新邮件。
   * 某些邮箱服务器（如 QQ 邮箱）的 IDLE 实现可能不稳定，
   * 轮询可以确保新邮件不会被遗漏。
   */
  private startPolling(): void {
    if (this.disposed) return

    // 停止之前的轮询
    this.stopPolling()

    // 默认轮询间隔：30 秒
    const pollInterval = 30 * 1000

    logger.info('Starting poll timer for %s (interval: %ds)', this.account.email, pollInterval / 1000)

    this.pollTimer = this.ctx.setInterval(async () => {
      if (this.disposed || !this.imapFlow || !this.state.isConnected) return

      try {
        // 使用 NOOP 命令检查新邮件
        // NOOP 会触发服务器发送任何待处理的通知（包括 EXISTS）
        await this.imapFlow.noop()
        logger.debug('[POLL] NOOP sent for %s', this.account.email)

        // 额外检查：直接搜索未读邮件
        // 这是最可靠的方式，不依赖服务器推送
        const uids = await this.searchUnseenUids()
        if (uids.length > 0) {
          logger.info('[POLL] Found %d unseen mails for %s via polling', uids.length, this.account.email)
          this.triggerScan()
        }
      } catch (err) {
        logger.debug('[POLL] Check failed for %s: %s', this.account.email, (err as Error).message)
      }
    }, pollInterval)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      this.pollTimer()
      this.pollTimer = null
    }
  }

  /**
   * 启动 IDLE 循环
   *
   * IDLE 是 IMAP 的扩展命令，允许客户端保持连接并接收服务器推送的实时通知。
   * 注意：IDLE 可能不可靠，我们同时使用轮询作为备选。
   */
  private startIdleLoop(): void {
    if (!this.imapFlow || this.disposed) return

    const runIdleLoop = async () => {
      logger.info('IDLE loop started for %s', this.account.email)

      while (this.imapFlow && this.state.isConnected && !this.disposed) {
        try {
          // 检查连接状态
          if (!this.imapFlow || !this.state.isConnected || this.disposed) {
            break
          }

          // 进入 IDLE 模式
          // 设置较短的超时，确保定期退出以检查状态
          logger.debug('[IDLE] Entering IDLE for %s', this.account.email)

          await this.imapFlow.idle()

          logger.debug('[IDLE] Returned for %s', this.account.email)

          // IDLE 返回可能是因为：
          // 1. 收到新邮件通知 (EXISTS)
          // 2. IDLE 超时
          // 3. 连接问题
          // EXISTS 事件会由事件监听器处理，这里只需要短暂等待后重新进入 IDLE

          await sleep(100)
        } catch (err) {
          if (this.disposed || !this.state.isConnected) {
            break
          }

          const errMsg = (err as Error).message
          logger.debug('[IDLE] Interrupted for %s: %s', this.account.email, errMsg)
          await sleep(500)
        }
      }

      logger.info('IDLE loop stopped for %s', this.account.email)
    }

    runIdleLoop().catch(err => {
      if (!this.disposed) {
        logger.error('IDLE loop fatal error for %s: %s', this.account.email, err.message)
      }
    })
  }

  private async scanUnseenMails(): Promise<void> {
    if (!this.imapFlow) return

    // 注意：不要使用 withMailboxLock！
    // 因为邮箱已经在 startInboxListener 中打开，并且 IDLE 模式正在运行
    // 获取锁会导致 IDLE 退出且不会自动重启
    const uids = await this.searchUnseenUids()

    if (uids.length === 0) return

    logger.info('Found %d unseen mails for %s', uids.length, this.account.email)

    const CONCURRENT_LIMIT = 5
    for (let i = 0; i < uids.length; i += CONCURRENT_LIMIT) {
      const batch = uids.slice(i, i + CONCURRENT_LIMIT)
      await Promise.all(batch.map(uid => this.fetchAndNotifyMail(uid)))
    }
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
      // 首先获取邮件大小（不下载内容）
      const sizeInfo = await this.imapFlow.fetchOne(String(uid), { size: true }, { uid: true })
      if (sizeInfo && sizeInfo.size && sizeInfo.size > SYNC_STRATEGY.MAX_MAIL_SIZE) {
        logger.warn('Mail %s is too large (%d bytes > %d bytes limit), skipping',
          uid, sizeInfo.size, SYNC_STRATEGY.MAX_MAIL_SIZE)
        return null
      }

      const message = await this.imapFlow.fetchOne(String(uid), { source: true }, { uid: true })
      if (!message || !message.source) {
        logger.warn('Mail %s has no source data', uid)
        return null
      }

      // 再次检查实际下载的大小
      const sourceBuffer = message.source as Buffer
      if (sourceBuffer.length > SYNC_STRATEGY.MAX_MAIL_SIZE) {
        logger.warn('Mail %s actual size (%d bytes) exceeds limit, skipping',
          uid, sourceBuffer.length)
        return null
      }

      const parsedMail = await parseMail(sourceBuffer)

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

    const client = this.imapFlow
    this.imapFlow = null // 先置空，防止其他地方继续使用

    try {
      // 先移除所有监听器，防止在关闭过程中触发事件
      client.removeAllListeners()

      // 如果正在 IDLE，尝试先退出 IDLE
      if (client.idling) {
        try {
          // 发送 NOOP 命令来中断 IDLE
          await Promise.race([
            client.noop(),
            sleep(2000)
          ])
        } catch {
          // 忽略 NOOP 失败，继续关闭
        }
      }

      // 尝试正常登出
      await Promise.race([
        client.logout().catch(() => {}),
        sleep(CONNECTION_STRATEGY.DISCONNECT_TIMEOUT)
      ])
    } catch (err) {
      // 忽略关闭过程中的错误
      logger.debug('Error during close session: %s', (err as Error).message)
    }
  }

  private resetState(): void {
    this.imapFlow = null
    this.state.isConnecting = false
    this.state.isConnected = false
    this.mailboxLock = null
    // 注意：不在这里重置 reconnectAttempts，让重连逻辑自己管理
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      this.reconnectTimer() // 调用 dispose 函数取消定时器
      this.reconnectTimer = null
      logger.debug('Cancelled reconnect timer for %s', this.account.email)
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

export function parseMailAddress(addr: any): MailAddress | null {
  if (!addr) return null
  if (typeof addr === 'string') {
    return addr.trim() ? { address: addr.trim() } : null
  }
  const address = addr?.address?.trim()
  if (!address) return null
  return {
    name: addr?.name?.trim() || undefined,
    address,
  }
}

export function parseMailAddresses(addrs: any): MailAddress[] {
  if (!addrs) return []
  if (Array.isArray(addrs.value)) {
    return addrs.value.map(parseMailAddress).filter((a: MailAddress | null): a is MailAddress => a !== null)
  }
  if (addrs.address) {
    const parsed = parseMailAddress(addrs)
    return parsed ? [parsed] : []
  }
  return []
}

export function convertParsedMail(accountId: number, mail: ParsedMail): Omit<StoredMail, 'id' | 'createdAt'> {
  // 内容长度限制
  const MAX_TEXT_LENGTH = 100000  // 100KB
  const MAX_HTML_LENGTH = 500000  // 500KB

  let textContent = mail.text
  let htmlContent = mail.html

  // 截断过长的文本内容
  if (textContent && textContent.length > MAX_TEXT_LENGTH) {
    textContent = textContent.substring(0, MAX_TEXT_LENGTH) + '\n\n[内容过长，已截断]'
    logger.debug('Truncated text content from %d to %d chars', mail.text!.length, MAX_TEXT_LENGTH)
  }

  // 截断过长的 HTML 内容
  if (htmlContent && htmlContent.length > MAX_HTML_LENGTH) {
    htmlContent = htmlContent.substring(0, MAX_HTML_LENGTH) + '\n<!-- 内容过长，已截断 -->'
    logger.debug('Truncated HTML content from %d to %d chars', mail.html!.length, MAX_HTML_LENGTH)
  }

  // 安全地解析发件人，提供默认值
  const fromAddresses = parseMailAddresses(mail.from)
  const fromAddress = fromAddresses[0] || { address: 'unknown@unknown' }

  return {
    accountId,
    messageId: mail.messageId || generateRandomId(),
    from: fromAddress,
    to: parseMailAddresses(mail.to),
    cc: parseMailAddresses(mail.cc),
    subject: mail.subject || '(无主题)',
    textContent,
    htmlContent: htmlContent || undefined,
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
