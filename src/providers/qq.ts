/**
 * QQ 邮箱适配器
 * 支持 QQ 邮箱和 Foxmail
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

export class QQMailProvider extends MailProviderAdapter {
  readonly name = 'qq'
  readonly displayName = 'QQ邮箱'
  readonly supportedDomains = ['qq.com', 'foxmail.com', 'vip.qq.com']

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

      // QQ 邮箱的 IDLE 比较可靠，但偶尔会有问题
      // 使用 idle-with-fallback 策略：优先 IDLE，失败时自动切换
      maxIdleTime: 25 * 60 * 1000, // 25分钟
      listenStrategy: 'idle-with-fallback',
      pollInterval: 120 * 1000, // 2分钟轮询（作为备选）
      connectionCheckInterval: 60 * 1000, // 60秒连接检测
      idleReliability: 75, // 较高可靠性
    }
  }

  getErrorHint(error: Error): string | null {
    if (error.message.includes('AUTHENTICATIONFAILED')) {
      return '认证失败，QQ邮箱需要使用授权码而非登录密码。请到 QQ邮箱设置 -> 账户 -> POP3/IMAP/SMTP服务 中生成授权码'
    }
    if (error.message.includes('Too many simultaneous connections')) {
      return 'QQ邮箱同时连接数过多，请稍后再试'
    }
    return null
  }
}
