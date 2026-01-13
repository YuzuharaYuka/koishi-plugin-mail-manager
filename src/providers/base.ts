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
    }
  }
}
