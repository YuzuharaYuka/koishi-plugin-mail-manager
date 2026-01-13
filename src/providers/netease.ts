/**
 * 网易邮箱适配器 (163/126/Yeah.net)
 * 网易邮箱特点：
 * - 需要发送 IMAP ID 标识
 * - 连接不稳定，需要更保守的重连策略
 * - 授权码登录
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

export class NeteaseMailProvider extends MailProviderAdapter {
  readonly name = 'netease'
  readonly displayName = '网易邮箱'
  readonly supportedDomains = ['163.com', '126.com', 'yeah.net']

  getImapConfig(account: MailAccount, resolvedHost?: string, proxyUrl?: string) {
    const config: any = {
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

    // 网易邮箱需要发送 IMAP ID
    if (account.sendImapId !== false) {
      config.clientInfo = {
        name: 'Koishi Mail Manager',
        version: '1.0.0',
      }
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
      maxConcurrentConnections: 2,
      recommendedBatchSize: 30,
      requiresHeartbeat: true,
      heartbeatInterval: 300000, // 5分钟
    }
  }

  getReconnectDelay(attemptCount: number): number {
    // 网易邮箱使用固定的重连延迟
    return 10000 // 10秒
  }

  getErrorHint(error: Error): string | null {
    if (error.message.includes('AUTHENTICATIONFAILED')) {
      return '认证失败，请检查邮箱密码或授权码是否正确'
    }
    if (error.message.includes('Too many login failures')) {
      return '登录失败次数过多，请稍后再试'
    }
    return null
  }
}
