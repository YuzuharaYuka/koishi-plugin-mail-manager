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
      greetingTimeout: 30000,
      socketTimeout: 60000,
    }

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

  getErrorHint(error: Error): string | null {
    if (error.message.includes('AUTHENTICATIONFAILED')) {
      return '认证失败，iCloud 需要使用应用专用密码。请到 Apple ID 管理页面 -> 安全性 -> 应用专用密码 中生成'
    }
    return null
  }
}
