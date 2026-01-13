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
      return '认证失败，Yahoo Mail 需要使用应用密码。请到 Yahoo 账户安全设置中生成应用密码'
    }
    if (error.message.includes('UNAVAILABLE')) {
      return 'Yahoo Mail 服务暂时不可用，可能需要配置代理访问'
    }
    return null
  }
}
