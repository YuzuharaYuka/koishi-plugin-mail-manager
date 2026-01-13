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
 * 此策略优先选择已知稳定的 IP 段，避免不稳定的 IP 段。
 */
export class GmailIpStrategy extends PrefixBasedIpStrategy {
  constructor() {
    super(
      'gmail',
      // 优选 IP 段（Google 全球稳定 IP）
      ['142.250.', '142.251.', '172.253.'],
      // 避免的 IP 段（某些地区不稳定）
      ['74.125.']
    )
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
    const config: any = {
      host: resolvedHost || account.imapHost || 'imap.gmail.com',
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
        // Gmail 支持的加密套件
        ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!MD5:!PSK:!RC4',
        // 使用代理时，必须设置 servername 以支持 TLS SNI
        servername: account.imapHost || 'imap.gmail.com',
      },
      greetingTimeout: 30000,
      socketTimeout: 120000, // Gmail 建议更长的超时时间
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
      supportsCondstore: true,
      supportsQresync: true,
      maxConcurrentConnections: 10,
      recommendedBatchSize: 100,
      requiresHeartbeat: false,
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
