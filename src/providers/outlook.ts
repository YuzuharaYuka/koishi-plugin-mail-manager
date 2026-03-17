/**
 * Outlook/Hotmail 适配器
 * Microsoft 邮箱服务
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

export class OutlookProvider extends MailProviderAdapter {
  readonly name = 'outlook'
  readonly displayName = 'Outlook'
  readonly supportedDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com']
  private readonly defaultHost = 'outlook.office365.com'

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
      greetingTimeout: 45000,
      socketTimeout: 90000,
    }

    this.applyProxyConfig(config, proxyUrl, servername)

    return config
  }

  getFeatures(): ProviderFeatures {
    return {
      supportsIdle: true,
      supportsCondstore: true,
      supportsQresync: false,
      maxConcurrentConnections: 5,
      recommendedBatchSize: 50,
      requiresHeartbeat: false,

      // Outlook IDLE 整体可靠，但在部分网络环境会出现静默中断
      maxIdleTime: 24 * 60 * 1000,
      listenStrategy: 'idle-with-fallback',
      pollInterval: 120 * 1000,
      connectionCheckInterval: 60 * 1000,
      idleReliability: 72,
    }
  }

  getErrorHint(error: Error): string | null {
    const message = error.message.toLowerCase()

    if (message.includes('authenticationfailed')) {
      return '认证失败，Outlook 可能需要在账户设置中启用"允许安全性较低的应用"或使用应用专用密码'
    }
    if (message.includes('unavailable')) {
      return 'Outlook 服务暂时不可用，可能需要配置代理访问'
    }
    return null
  }
}
