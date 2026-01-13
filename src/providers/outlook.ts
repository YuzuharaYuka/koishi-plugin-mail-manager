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
        // 始终设置 servername 以支持 TLS SNI
        servername: account.imapHost,
      } as any,
      greetingTimeout: 45000,
      socketTimeout: 90000,
    }

    if (proxyUrl) {
      config.proxy = proxyUrl
    }

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
    }
  }

  getErrorHint(error: Error): string | null {
    if (error.message.includes('AUTHENTICATIONFAILED')) {
      return '认证失败，Outlook 可能需要在账户设置中启用"允许安全性较低的应用"或使用应用专用密码'
    }
    if (error.message.includes('UNAVAILABLE')) {
      return 'Outlook 服务暂时不可用，可能需要配置代理访问'
    }
    return null
  }
}
