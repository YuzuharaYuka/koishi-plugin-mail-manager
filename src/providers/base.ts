/**
 * 邮箱提供商适配器基类
 * 定义统一的邮箱操作接口
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { DefaultIpStrategy, type IpSelectionStrategy, type ErrorMatcher } from '../utils'

/**
 * 邮箱提供商配置接口
 */
export interface ProviderConfig {
  /** IMAP 主机地址 */
  host: string
  /** IMAP 端口 */
  port: number
  /** 是否使用 TLS */
  secure: boolean
  /** 是否发送 IMAP ID */
  sendImapId?: boolean
  /** 认证超时时间(ms) */
  authTimeout?: number
  /** 连接超时时间(ms) */
  connectionTimeout?: number
  /** 是否需要特殊的认证方式 */
  requiresSpecialAuth?: boolean
  /** 支持的认证方式 */
  authMethods?: string[]
}

/**
 * 邮箱监听策略
 *
 * - 'idle-only': 仅使用 IDLE，适合 IDLE 可靠的服务器
 * - 'poll-only': 仅使用轮询，禁用 IDLE
 * - 'hybrid': 同时使用 IDLE 和轮询，IDLE 为主，轮询为备选（默认）
 * - 'idle-with-fallback': 优先 IDLE，IDLE 失败时自动切换到轮询
 */
export type ListenStrategy = 'idle-only' | 'poll-only' | 'hybrid' | 'idle-with-fallback'

/**
 * 邮箱提供商特性
 */
export interface ProviderFeatures {
  /** 支持 IDLE 命令 */
  supportsIdle: boolean
  /** 支持 CONDSTORE 扩展 */
  supportsCondstore: boolean
  /** 支持 QRESYNC 扩展 */
  supportsQresync: boolean
  /** 最大并发连接数 */
  maxConcurrentConnections: number
  /** 建议的批量操作大小 */
  recommendedBatchSize: number
  /** 需要周期性心跳 */
  requiresHeartbeat: boolean
  /** 心跳间隔(ms) */
  heartbeatInterval?: number

  // ============ 新增：IDLE 和轮询相关配置 ============

  /**
   * IDLE 最大持续时间(ms)
   * 超过此时间后 IDLE 会自动重启，防止服务器静默断开
   * 默认: 29分钟 (RFC 2177 建议不超过 29 分钟)
   */
  maxIdleTime?: number

  /**
   * 服务器已知的 IDLE 超时时间(ms)
   * 用于在服务器超时前主动重启 IDLE
   */
  serverIdleTimeout?: number

  /**
   * 邮件监听策略
   * 默认: 'hybrid'
   */
  listenStrategy?: ListenStrategy

  /**
   * 轮询间隔(ms)
   * 仅在 listenStrategy 包含轮询时有效
   * 默认: 120秒 (2分钟)
   */
  pollInterval?: number

  /**
   * 连接存活检测间隔(ms)
   * 检测连接是否仍然有效
   * 默认: 60秒
   */
  connectionCheckInterval?: number

  /**
   * IDLE 可靠性评分 (0-100)
   * 高分表示 IDLE 实现可靠，可以减少轮询
   * 低分表示 IDLE 可能不可靠，需要更频繁的轮询
   */
  idleReliability?: number
}

/**
 * 邮箱提供商适配器抽象基类
 */
export abstract class MailProviderAdapter {
  /** 提供商名称 */
  abstract readonly name: string

  /** 提供商显示名称 */
  abstract readonly displayName: string

  /** 支持的域名列表 */
  abstract readonly supportedDomains: string[]

  /**
   * 获取 IMAP 配置
   */
  abstract getImapConfig(account: MailAccount, resolvedHost?: string, proxyUrl?: string): Partial<ImapFlowOptions>

  /**
   * 获取提供商特性
   */
  abstract getFeatures(): ProviderFeatures

  /**
   * 检查是否支持该邮箱地址
   */
  isSupportedEmail(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return false
    return this.supportedDomains.some(d => domain.includes(d))
  }

  /**
   * 检查是否支持该主机地址
   */
  isSupportedHost(host: string): boolean {
    const hostLower = host.toLowerCase()
    return this.supportedDomains.some(d => hostLower.includes(d))
  }

  /**
   * 获取推荐的重连延迟(ms)
   */
  getReconnectDelay(attemptCount: number, baseInterval: number = 30): number {
    // 指数退避策略：baseInterval, baseInterval*2, baseInterval*4...
    const delay = baseInterval * 1000 * Math.pow(2, Math.max(0, attemptCount - 1))
    return Math.min(delay, 300000) // 最大 5 分钟
  }

  /**
   * 获取连接超时配置
   */
  getConnectionTimeout(configTimeout: number): number {
    // 默认使用配置的超时时间，子类可以覆盖
    return configTimeout * 1000
  }

  /**
   * 处理连接错误，返回是否应该重试
   */
  shouldRetryOnError(error: Error): boolean {
    const msg = error.message.toLowerCase()

    // 这些错误不应该重试
    const nonRetryableErrors = [
      'authentication failed',
      'invalid credentials',
      'login failed',
      'user',
      'password',
    ]

    return !nonRetryableErrors.some(pattern => msg.includes(pattern))
  }

  /**
   * 获取 DNS 解析策略
   * 子类可以覆盖此方法提供特定的 IP 选择策略
   */
  getDnsStrategy(): IpSelectionStrategy {
    return new DefaultIpStrategy()
  }

  /**
   * 获取自定义错误匹配规则
   * 子类可以覆盖此方法提供特定的错误处理
   */
  getCustomErrorMatchers(): ErrorMatcher[] {
    return []
  }

  /**
   * 获取连接前的特殊处理
   */
  async preConnect?(account: MailAccount): Promise<void>

  /**
   * 获取连接后的特殊处理
   */
  async postConnect?(account: MailAccount): Promise<void>

  /**
   * 处理连接错误
   */
  handleConnectionError?(error: Error): { shouldRetry: boolean; message?: string }

  /**
   * 获取错误提示信息
   */
  getErrorHint?(error: Error): string | null
}

/**
 * 默认/通用邮箱适配器
 */
export class GenericMailProvider extends MailProviderAdapter {
  readonly name = 'generic'
  readonly displayName = '通用邮箱'
  readonly supportedDomains: string[] = []

  getImapConfig(account: MailAccount, resolvedHost?: string, proxyUrl?: string): Partial<ImapFlowOptions> {
    const config: Partial<ImapFlowOptions> = {
      host: resolvedHost || account.imapHost,
      port: account.imapPort,
      secure: account.imapTls,
      auth: {
        user: account.email,
        pass: account.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        // 始终设置 servername 以支持 TLS SNI（特别是使用代理时）
        servername: account.imapHost,
      } as any,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    }

    // 代理配置
    if (proxyUrl) {
      config.proxy = proxyUrl

      // 使用 HTTP/HTTPS 代理时，必须使用域名而非 IP
      // 这样代理才能正确建立 CONNECT 隧道
      if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
        config.host = account.imapHost
      }
    }

    return config
  }

  getFeatures(): ProviderFeatures {
    return {
      supportsIdle: true,
      supportsCondstore: false,
      supportsQresync: false,
      maxConcurrentConnections: 3,
      recommendedBatchSize: 50,
      requiresHeartbeat: false,

      // 通用邮箱使用保守的混合策略
      maxIdleTime: 20 * 60 * 1000, // 20分钟，保守值
      listenStrategy: 'hybrid', // 混合模式，最安全
      pollInterval: 120 * 1000, // 2分钟轮询
      connectionCheckInterval: 60 * 1000, // 60秒连接检测
      idleReliability: 60, // 中等可靠性（未知服务器）
    }
  }
}
