/**
 * Yahoo Mail 适配器
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

export class YahooProvider extends MailProviderAdapter {
  readonly name = 'yahoo'
  readonly displayName = 'Yahoo Mail'
  readonly supportedDomains = ['yahoo.com', 'yahoo.co.jp', 'ymail.com', 'rocketmail.com']
  private readonly defaultHost = 'imap.mail.yahoo.com'

  getImapConfig(account: MailAccount, resolvedHost?: string, proxyUrl?: string): Partial<ImapFlowOptions> {
    const targetHost = this.resolveImapHost(account, resolvedHost, this.defaultHost)
    const servername = this.resolveServerName(account, this.defaultHost)

    const config: Partial<ImapFlowOptions> = {
      host: targetHost,
      port: account.imapPort || 993,
      secure: account.imapTls,
      auth: {
        user: account.email,
        pass: account.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        // 始终设置 servername 以支持 TLS SNI
        servername,
      },
      greetingTimeout: 30000,
      socketTimeout: 60000,
    }

    this.applyProxyConfig(config, proxyUrl, servername)

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

      // Yahoo 在跨区域网络中 IDLE 可靠性一般，使用混合策略更稳妥
      maxIdleTime: 20 * 60 * 1000,
      listenStrategy: 'hybrid',
      pollInterval: 120 * 1000,
      connectionCheckInterval: 60 * 1000,
      idleReliability: 62,
    }
  }

  getErrorHint(error: Error): string | null {
    const message = error.message.toLowerCase()

    if (message.includes('authenticationfailed')) {
      return '认证失败，Yahoo Mail 需要使用应用密码。请到 Yahoo 账户安全设置中生成应用密码'
    }
    if (message.includes('unavailable')) {
      return 'Yahoo Mail 服务暂时不可用，可能需要配置代理访问'
    }
    return null
  }
}
