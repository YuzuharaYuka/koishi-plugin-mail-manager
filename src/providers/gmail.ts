/**
 * Gmail 邮箱适配器
 * 适配 Google Gmail 服务
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'
import { PrefixBasedIpStrategy, type IpSelectionStrategy, type ErrorMatcher } from '../utils'

/**
 * Gmail IP 选择策略
 *
 * Google 的 IMAP 服务器使用多个 IP 段，某些 IP 段在特定地区可能更稳定。
 * 此策略优先选择已知稳定的 IP 段。
 *
 * 注意：在中国大陆，Gmail 服务被封锁，无论哪个 IP 段都无法直连。
 * 建议使用代理（配置 proxyUrl）以绕过网络限制。
 */
export class GmailIpStrategy extends PrefixBasedIpStrategy {
  constructor() {
    super(
      'gmail',
      // 优选 IP 段（Google 全球稳定 IP）
      ['142.250.', '142.251.', '172.253.', '74.125.'],
      // 黑名单 IP 段（已知完全不可用的 IP）
      []
    )
  }

  /**
   * 覆盖重试策略
   * Gmail 在中国大陆无法直连，避免无意义的重试
   */
  shouldRetryQuery(addresses: string[]): boolean {
    // 如果有任何可用地址，就不重试
    // 即使不是优选段，也接受（因为在中国大陆都无法直连）
    return false
  }
}

/**
 * Gmail 特定的错误匹配规则
 */
export const GMAIL_ERROR_MATCHERS: ErrorMatcher[] = [
  {
    pattern: /invalid credentials|authentication failed/i,
    message: '认证失败。Gmail 需要使用"应用专用密码"，请前往 Google 账号设置生成应用专用密码',
    retryable: false,
  },
  {
    pattern: /too many|rate limit/i,
    message: 'Gmail 请求过于频繁，请稍后再试',
    retryable: true,
  },
  {
    pattern: /less secure app/i,
    message: '请在 Google 账号设置中启用"两步验证"并生成"应用专用密码"',
    retryable: false,
  },
]

export class GmailProvider extends MailProviderAdapter {
  readonly name = 'gmail'
  readonly displayName = 'Gmail (Google)'
  readonly supportedDomains = ['gmail.com', 'googlemail.com']

  /** Gmail 专用 IP 选择策略 */
  private readonly ipStrategy = new GmailIpStrategy()

  getImapConfig(account: MailAccount, resolvedHost?: string, proxyUrl?: string): Partial<ImapFlowOptions> {
    const isUsingProxy = !!proxyUrl
    const targetHost = account.imapHost || 'imap.gmail.com'

    const config: any = {
      host: resolvedHost || targetHost,
      port: account.imapPort || 993,
      secure: true,
      auth: {
        user: account.email,
        pass: account.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        // 使用代理时必须设置 servername 为域名（而非 IP）
        servername: targetHost,
      } as any,
      greetingTimeout: 30000,
      socketTimeout: 120000, // Gmail 建议更长的超时时间
    }

    // 代理配置
    if (proxyUrl) {
      config.proxy = proxyUrl

      // 使用 HTTP/HTTPS 代理时，需要确保 host 是域名而非 IP
      // 这样代理可以正确处理 CONNECT 隧道
      if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
        config.host = targetHost // 强制使用域名
      }
    }

    return config
  }

  getFeatures(): ProviderFeatures {
    return {
      supportsIdle: true,
      supportsCondstore: true,
      supportsQresync: true,
      maxConcurrentConnections: 10,
      recommendedBatchSize: 100,
      requiresHeartbeat: false,

      // Gmail 的 IDLE 实现非常可靠
      // 使用 idle-only 策略以减少不必要的轮询
      maxIdleTime: 29 * 60 * 1000, // 29分钟（RFC 2177 建议）
      listenStrategy: 'idle-only', // Gmail IDLE 可靠，无需轮询
      pollInterval: 300 * 1000, // 5分钟（仅作为最后的备选）
      connectionCheckInterval: 90 * 1000, // 90秒连接检测
      idleReliability: 95, // 非常可靠
    }
  }

  getReconnectDelay(attemptCount: number): number {
    // Gmail 对频繁重连较为宽容，可以使用较短的延迟
    return Math.min(3000 * Math.pow(1.5, attemptCount - 1), 30000)
  }

  /**
   * 获取 Gmail 专用的 IP 选择策略
   */
  getDnsStrategy(): IpSelectionStrategy {
    return this.ipStrategy
  }

  /**
   * 获取 Gmail 专用的错误匹配规则
   */
  getCustomErrorMatchers(): ErrorMatcher[] {
    return GMAIL_ERROR_MATCHERS
  }

  getErrorHint(error: Error): string | null {
    const message = error.message.toLowerCase()

    if (message.includes('invalid credentials') || message.includes('authentication failed')) {
      return '认证失败。Gmail 需要使用"应用专用密码"，请前往 Google 账号设置生成应用专用密码'
    }

    if (message.includes('too many') || message.includes('rate limit')) {
      return 'Gmail 请求过于频繁，请稍后再试'
    }

    return null
  }
}
