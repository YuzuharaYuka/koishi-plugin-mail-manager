/**
 * DNS 解析工具模块
 *
 * 提供 DNS 解析功能，支持：
 * - 强制 IPv4 解析
 * - 可扩展的 IP 选择策略
 */

import * as dns from 'dns'
import { sleep } from './common'

/**
 * DNS 解析结果
 */
export interface DnsResolveResult {
  /** 选中的地址 */
  selectedAddress: string
  /** 所有解析到的地址 */
  allAddresses: string[]
  /** 是否使用了优选地址 */
  isPreferred: boolean
}

/**
 * IP 选择策略接口
 * 提供商可以实现自己的 IP 选择逻辑
 */
export interface IpSelectionStrategy {
  /** 策略名称 */
  name: string

  /**
   * 选择最佳 IP 地址
   * @param addresses 所有可用地址
   * @returns 选中的地址和是否为优选
   */
  selectBestAddress(addresses: string[]): { address: string; isPreferred: boolean }

  /**
   * 是否需要重试 DNS 查询
   * @param addresses 当前查询到的地址
   * @returns true 表示需要重试以获取更好的 IP
   */
  shouldRetryQuery?(addresses: string[]): boolean
}

/**
 * 默认 IP 选择策略
 * 简单地返回第一个地址
 */
export class DefaultIpStrategy implements IpSelectionStrategy {
  name = 'default'

  selectBestAddress(addresses: string[]): { address: string; isPreferred: boolean } {
    return {
      address: addresses[0],
      isPreferred: false,
    }
  }
}

/**
 * 基于前缀的 IP 选择策略
 * 支持配置优选和黑名单 IP 前缀
 */
export class PrefixBasedIpStrategy implements IpSelectionStrategy {
  constructor(
    public readonly name: string,
    private readonly preferredPrefixes: string[],
    private readonly blockedPrefixes: string[]
  ) {}

  selectBestAddress(addresses: string[]): { address: string; isPreferred: boolean } {
    // 1. 优先选择白名单 IP
    const preferred = addresses.find(ip =>
      this.preferredPrefixes.some(prefix => ip.startsWith(prefix))
    )

    if (preferred) {
      return { address: preferred, isPreferred: true }
    }

    // 2. 尝试选择非黑名单 IP
    const acceptable = addresses.find(ip =>
      !this.blockedPrefixes.some(prefix => ip.startsWith(prefix))
    )

    if (acceptable) {
      return { address: acceptable, isPreferred: false }
    }

    // 3. 没有好的选择，返回第一个
    return { address: addresses[0], isPreferred: false }
  }

  shouldRetryQuery(addresses: string[]): boolean {
    // 如果没有找到优选或可接受的 IP，建议重试
    const hasPreferred = addresses.some(ip =>
      this.preferredPrefixes.some(prefix => ip.startsWith(prefix))
    )

    if (hasPreferred) return false

    const hasAcceptable = addresses.some(ip =>
      !this.blockedPrefixes.some(prefix => ip.startsWith(prefix))
    )

    return !hasAcceptable
  }
}

/**
 * DNS 解析器配置
 */
export interface DnsResolverOptions {
  /** 最大 DNS 查询尝试次数 */
  maxAttempts?: number
  /** 重试间隔（毫秒） */
  retryDelay?: number
  /** 是否强制 IPv4 */
  forceIPv4?: boolean
  /** 日志函数 */
  logger?: {
    debug: (msg: string, ...args: any[]) => void
    info: (msg: string, ...args: any[]) => void
    warn: (msg: string, ...args: any[]) => void
    error: (msg: string, ...args: any[]) => void
  }
}

const defaultOptions: Required<Omit<DnsResolverOptions, 'logger'>> = {
  maxAttempts: 3,
  retryDelay: 1000,
  forceIPv4: true,
}

/**
 * 解析主机名到 IP 地址
 *
 * @param hostname 主机名
 * @param strategy IP 选择策略（可选）
 * @param options 解析选项
 */
export async function resolveDns(
  hostname: string,
  strategy: IpSelectionStrategy = new DefaultIpStrategy(),
  options: DnsResolverOptions = {}
): Promise<DnsResolveResult> {
  const opts = { ...defaultOptions, ...options }
  const log = opts.logger

  let allAddresses: string[] = []
  let selectedResult = { address: hostname, isPreferred: false }

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const addresses = await dnsLookup(hostname, opts.forceIPv4)
      allAddresses = addresses

      log?.debug('[DNS] Attempt %d: Resolved %s -> [%s]', attempt, hostname, addresses.join(', '))

      selectedResult = strategy.selectBestAddress(addresses)

      // 检查是否需要重试
      const shouldRetry = strategy.shouldRetryQuery?.(addresses) ?? false

      if (!shouldRetry || attempt >= opts.maxAttempts) {
        if (selectedResult.isPreferred) {
          log?.info('[DNS] Found preferred IP on attempt %d: %s', attempt, selectedResult.address)
        } else if (addresses.length > 1) {
          log?.info('[DNS] Selected IP: %s (from %d options)', selectedResult.address, addresses.length)
        }
        break
      }

      log?.warn('[DNS] Attempt %d: No ideal IP found, retrying...', attempt)
      await sleep(opts.retryDelay)

    } catch (err) {
      log?.error('[DNS] Failed to resolve %s: %s', hostname, (err as Error).message)

      if (attempt >= opts.maxAttempts) {
        // 所有尝试都失败，返回原始主机名
        return {
          selectedAddress: hostname,
          allAddresses: [],
          isPreferred: false,
        }
      }

      await sleep(opts.retryDelay)
    }
  }

  return {
    selectedAddress: selectedResult.address,
    allAddresses,
    isPreferred: selectedResult.isPreferred,
  }
}

/**
 * 底层 DNS 查找（强制 IPv4）
 */
async function dnsLookup(hostname: string, forceIPv4: boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(
      hostname,
      { family: forceIPv4 ? 4 : 0, all: true },
      (err, addresses) => {
        if (err) {
          reject(err)
        } else {
          resolve(addresses.map((addr: any) => addr.address))
        }
      }
    )
  })
}

/**
 * 自定义 DNS 查找函数（用于 ImapFlow 的 lookup 选项）
 * 强制使用 IPv4
 */
export function createCustomLookup(
  logger?: DnsResolverOptions['logger']
): (hostname: string, options: any, callback: (err: Error | null, address?: string, family?: number) => void) => void {
  return (hostname, _options, callback) => {
    logger?.debug('Custom DNS lookup for host: %s (forcing IPv4)', hostname)

    dns.lookup(hostname, { family: 4, all: false }, (err, address, family) => {
      if (err) {
        logger?.error('DNS lookup failed for %s: %s', hostname, err.message)
        callback(err)
      } else {
        logger?.debug('DNS lookup success: %s -> %s (family: %d)', hostname, address, family)
        callback(null, address as string, family)
      }
    })
  }
}
