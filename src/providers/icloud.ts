/**
 * iCloud Mail 适配器
 * Apple 邮箱服务
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

export class iCloudProvider extends MailProviderAdapter {
  readonly name = 'icloud'
  readonly displayName = 'iCloud'
  readonly supportedDomains = ['icloud.com', 'me.com', 'mac.com']
  private readonly defaultHost = 'imap.mail.me.com'

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

      // iCloud 对 IDLE 支持较好，但在部分地区网络下存在中断概率
      maxIdleTime: 22 * 60 * 1000,
      listenStrategy: 'idle-with-fallback',
      pollInterval: 120 * 1000,
      connectionCheckInterval: 60 * 1000,
      idleReliability: 68,
    }
  }

  getErrorHint(error: Error): string | null {
    const message = error.message.toLowerCase()

    if (message.includes('authenticationfailed')) {
      return '认证失败，iCloud 需要使用应用专用密码。请到 Apple ID 管理页面 -> 安全性 -> 应用专用密码 中生成'
    }
    return null
  }
}
