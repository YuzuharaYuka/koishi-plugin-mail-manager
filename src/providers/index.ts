/**
 * 邮箱提供商注册表和工厂类
 * 自动识别邮箱类型并返回对应的适配器
 */

import { MailProviderAdapter, GenericMailProvider } from './base'
import { GmailProvider, GmailIpStrategy, GMAIL_ERROR_MATCHERS } from './gmail'
import { QQMailProvider } from './qq'
import { NeteaseMailProvider } from './netease'
import { OutlookProvider } from './outlook'
import { iCloudProvider } from './icloud'
import { YahooProvider } from './yahoo'
import type { MailAccount } from '../types'

/**
 * 邮箱提供商工厂类
 */
export class MailProviderFactory {
  private static providers: MailProviderAdapter[] = [
    new GmailProvider(),
    new QQMailProvider(),
    new NeteaseMailProvider(),
    new OutlookProvider(),
    new iCloudProvider(),
    new YahooProvider(),
  ]

  private static genericProvider = new GenericMailProvider()

  /**
   * 根据邮箱账号自动检测并返回对应的提供商适配器
   */
  static getProvider(account: MailAccount): MailProviderAdapter {
    // 1. 优先根据邮箱地址匹配
    for (const provider of this.providers) {
      if (provider.isSupportedEmail(account.email)) {
        return provider
      }
    }

    // 2. 根据 IMAP 主机地址匹配
    for (const provider of this.providers) {
      if (provider.isSupportedHost(account.imapHost)) {
        return provider
      }
    }

    // 3. 返回通用适配器
    return this.genericProvider
  }

  /**
   * 根据提供商名称获取适配器
   */
  static getProviderByName(name: string): MailProviderAdapter | null {
    const provider = this.providers.find(p => p.name === name)
    return provider || null
  }

  /**
   * 获取所有已注册的提供商
   */
  static getAllProviders(): MailProviderAdapter[] {
    return [...this.providers]
  }

  /**
   * 注册自定义提供商
   */
  static registerProvider(provider: MailProviderAdapter): void {
    this.providers.push(provider)
  }
}

// 导出所有提供商类
export {
  MailProviderAdapter,
  GenericMailProvider,
  GmailProvider,
  GmailIpStrategy,
  GMAIL_ERROR_MATCHERS,
  QQMailProvider,
  NeteaseMailProvider,
  OutlookProvider,
  iCloudProvider,
  YahooProvider,
}

// 导出类型
export type { ProviderConfig, ProviderFeatures, ListenStrategy } from './base'
