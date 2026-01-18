/**
 * 网易邮箱适配器 (163/126/Yeah.net)
 * 网易邮箱特点：
 * - 需要发送 IMAP ID 标识
 * - IDLE 超时非常短（约 200 秒），需要频繁发送 NOOP 保活
 * - 授权码登录
 * - IDLE 实现不完全可靠，需要轮询作为备选
 */

import type { ImapFlowOptions } from 'imapflow'
import type { MailAccount } from '../types'
import { MailProviderAdapter, type ProviderFeatures } from './base'

/**
 * 网易 IMAP 服务器的 IDLE 超时时间约为 200 秒（3分20秒）
 * 为了保持连接稳定，我们需要在此之前发送 NOOP 命令
 * 使用 90 秒的心跳间隔，留有足够的安全余量
 */
const NETEASE_IDLE_TIMEOUT = 200 * 1000 // 200秒 - 服务器超时
const NETEASE_MAX_IDLE_TIME = 150 * 1000 // 150秒 - 主动重启 IDLE，在超时前
const NETEASE_HEARTBEAT_INTERVAL = 90 * 1000 // 90秒 - 心跳间隔
const NETEASE_POLL_INTERVAL = 60 * 1000 // 60秒 - 轮询间隔（比默认更短，因为 IDLE 不可靠）

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
      // 关键配置：禁用 ImapFlow 的自动 IDLE，改用主动 NOOP 保活
      // ImapFlow 默认会在空闲时进入 IDLE 模式，但网易的 IDLE 超时太短
      // 通过设置较短的 idleTimeout，让 ImapFlow 更频繁地刷新 IDLE
      idleTimeout: NETEASE_HEARTBEAT_INTERVAL,
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
      // 网易邮箱必须启用心跳，且间隔要短于其 IDLE 超时
      requiresHeartbeat: true,
      heartbeatInterval: NETEASE_HEARTBEAT_INTERVAL,

      // 网易邮箱的 IDLE 实现不够可靠，使用混合模式
      // 设置较短的 maxIdleTime 以在服务器超时前重启 IDLE
      maxIdleTime: NETEASE_MAX_IDLE_TIME,
      serverIdleTimeout: NETEASE_IDLE_TIMEOUT,
      listenStrategy: 'hybrid', // 使用混合模式确保不遗漏邮件
      pollInterval: NETEASE_POLL_INTERVAL, // 60秒轮询
      connectionCheckInterval: 45 * 1000, // 45秒连接检测
      idleReliability: 50, // 中等可靠性
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
