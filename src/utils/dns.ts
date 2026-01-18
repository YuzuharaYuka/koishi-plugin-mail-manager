/**
 * DNS 解析工具模块
 *
 * 提供 DNS 解析功能，支持：
 * - 强制 IPv4 解析
 * - 可扩展的 IP 选择策略
 * - IP 连通性测试与最优选择
 */

import * as dns from 'dns'
import * as net from 'net'
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
  /** DNS 查询超时时间（毫秒） */
  dnsTimeout?: number
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
  dnsTimeout: 10000, // 10秒超时
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
      const addresses = await dnsLookup(hostname, opts.forceIPv4, opts.dnsTimeout)
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
 * 添加超时保护，防止无限期阻塞
 */
async function dnsLookup(hostname: string, forceIPv4: boolean, timeoutMs: number = 10000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DNS lookup timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    dns.lookup(
      hostname,
      { family: forceIPv4 ? 4 : 0, all: true },
      (err, addresses) => {
        clearTimeout(timer)
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
 * 使用备用 DNS 服务器进行解析
 * 用于绕过系统 DNS 缓存，获取更多 IP
 */
async function dnsResolve4Backup(hostname: string): Promise<string[]> {
  const resolver = new dns.promises.Resolver()

  // 使用 Google Public DNS 和 Cloudflare DNS
  resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])

  try {
    const addresses = await resolver.resolve4(hostname)
    return addresses
  } catch (err) {
    throw new Error(`Backup DNS resolution failed: ${(err as Error).message}`)
  }
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

// ==================== IP 连通性测试 ====================

/**
 * 单个 IP 连通性测试结果
 */
export interface IpTestResult {
  /** IP 地址 */
  address: string
  /** 是否可达 */
  reachable: boolean
  /** 连接延迟 (ms)，不可达时为 Infinity */
  latency: number
  /** 错误信息（如有） */
  error?: string
}

/**
 * IP 连通性测试配置
 */
export interface IpTestOptions {
  /** 测试端口 */
  port: number
  /** 单个 IP 测试超时时间 (ms)，默认 3000 */
  timeout?: number
  /** 并发测试数量，默认 5 */
  concurrency?: number
  /** 日志记录器 */
  logger?: DnsResolverOptions['logger']
}

/**
 * 测试单个 IP 的 TCP 连通性
 *
 * @param address IP 地址
 * @param port 端口号
 * @param timeout 超时时间(ms)
 * @returns 测试结果
 */
export function testTcpConnection(
  address: string,
  port: number,
  timeout: number = 3000
): Promise<IpTestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      const latency = Date.now() - startTime
      cleanup()
      resolve({ address, reachable: true, latency })
    })

    socket.on('timeout', () => {
      cleanup()
      resolve({ address, reachable: false, latency: Infinity, error: 'Connection timeout' })
    })

    socket.on('error', (err) => {
      cleanup()
      resolve({ address, reachable: false, latency: Infinity, error: err.message })
    })

    try {
      socket.connect(port, address)
    } catch (err) {
      cleanup()
      resolve({
        address,
        reachable: false,
        latency: Infinity,
        error: (err as Error).message
      })
    }
  })
}

/**
 * 批量测试多个 IP 的连通性
 *
 * @param addresses IP 地址列表
 * @param options 测试配置
 * @returns 所有测试结果，按延迟排序（可达的在前）
 */
export async function testMultipleIps(
  addresses: string[],
  options: IpTestOptions
): Promise<IpTestResult[]> {
  const { port, timeout = 3000, concurrency = 5, logger } = options

  if (addresses.length === 0) {
    return []
  }

  // 单个 IP 无需测试，直接返回
  if (addresses.length === 1) {
    logger?.debug('[IP-TEST] Only one IP, skipping connectivity test')
    return [{ address: addresses[0], reachable: true, latency: 0 }]
  }

  logger?.info('[IP-TEST] Testing connectivity for %d IPs on port %d...', addresses.length, port)

  const results: IpTestResult[] = []

  // 分批并发测试
  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(addr => testTcpConnection(addr, port, timeout))
    )
    results.push(...batchResults)
  }

  // 按延迟排序：可达的在前，延迟低的优先
  results.sort((a, b) => {
    if (a.reachable && !b.reachable) return -1
    if (!a.reachable && b.reachable) return 1
    return a.latency - b.latency
  })

  // 记录测试结果
  const reachableCount = results.filter(r => r.reachable).length
  logger?.info('[IP-TEST] Results: %d/%d reachable', reachableCount, results.length)

  results.forEach((r, idx) => {
    if (r.reachable) {
      logger?.debug('[IP-TEST] #%d %s - %dms', idx + 1, r.address, r.latency)
    } else {
      logger?.debug('[IP-TEST] #%d %s - unreachable (%s)', idx + 1, r.address, r.error)
    }
  })

  return results
}

/**
 * 选择最佳 IP 地址
 *
 * 综合考虑连通性测试结果和 IP 选择策略
 *
 * @param testResults 连通性测试结果
 * @param strategy IP 选择策略（用于优选/黑名单判断）
 * @returns 选中的地址和相关信息
 */
export function selectBestIpFromTestResults(
  testResults: IpTestResult[],
  strategy?: IpSelectionStrategy
): { address: string; latency: number; isPreferred: boolean } {
  if (testResults.length === 0) {
    throw new Error('No IP addresses to select from')
  }

  const reachableIps = testResults.filter(r => r.reachable)

  // 如果没有可达的 IP，返回第一个（让后续连接逻辑处理错误）
  if (reachableIps.length === 0) {
    return {
      address: testResults[0].address,
      latency: Infinity,
      isPreferred: false
    }
  }

  // 如果没有策略，直接返回延迟最低的
  if (!strategy) {
    const best = reachableIps[0]
    return {
      address: best.address,
      latency: best.latency,
      isPreferred: false
    }
  }

  // 有策略时，在可达 IP 中应用策略
  const reachableAddresses = reachableIps.map(r => r.address)
  const strategyResult = strategy.selectBestAddress(reachableAddresses)

  // 找到策略选中的 IP 的延迟信息
  const selectedResult = reachableIps.find(r => r.address === strategyResult.address)

  return {
    address: strategyResult.address,
    latency: selectedResult?.latency ?? 0,
    isPreferred: strategyResult.isPreferred
  }
}

/**
 * 带连通性测试的增强 DNS 解析
 *
 * 解析 DNS 后测试所有 IP 的连通性，选择最优的 IP
 * 如果所有 IP 不可达，尝试使用备用 DNS 服务器获取更多 IP
 *
 * @param hostname 主机名
 * @param port 目标端口（用于连通性测试）
 * @param strategy IP 选择策略
 * @param options 配置选项
 */
export async function resolveDnsWithConnectivityTest(
  hostname: string,
  port: number,
  strategy: IpSelectionStrategy = new DefaultIpStrategy(),
  options: DnsResolverOptions & {
    /** 连通性测试超时 (ms)，默认 3000 */
    connectivityTimeout?: number
    /** 是否启用连通性测试，默认 true */
    enableConnectivityTest?: boolean
    /** 是否启用备用 DNS 解析（当所有 IP 不可达时），默认 true */
    enableBackupDns?: boolean
  } = {}
): Promise<DnsResolveResult & { latency?: number; proxyRequired?: boolean }> {
  const {
    connectivityTimeout = 3000,
    enableConnectivityTest = true,
    enableBackupDns = true,
    ...dnsOptions
  } = options

  const log = options.logger

  // 1. 先进行 DNS 解析
  let dnsResult = await resolveDns(hostname, strategy, dnsOptions)

  // 如果解析失败或只有一个地址，或禁用连通性测试，直接返回
  if (dnsResult.allAddresses.length <= 1 || !enableConnectivityTest) {
    return dnsResult
  }

  // 2. 测试所有 IP 的连通性
  let testResults = await testMultipleIps(dnsResult.allAddresses, {
    port,
    timeout: connectivityTimeout,
    logger: log
  })

  // 3. 检查是否所有 IP 都不可达
  const reachableCount = testResults.filter(r => r.reachable).length

  if (reachableCount === 0 && enableBackupDns) {
    log?.warn('[DNS] All IPs unreachable for %s, trying backup DNS servers...', hostname)

    try {
      // 尝试使用备用 DNS 服务器
      const backupAddresses = await dnsResolve4Backup(hostname)

      // 去重（合并原有和新解析的 IP）
      const allUniqueAddresses = Array.from(new Set([...dnsResult.allAddresses, ...backupAddresses]))

      if (allUniqueAddresses.length > dnsResult.allAddresses.length) {
        log?.info('[DNS] Backup DNS found %d additional IPs, testing...',
          allUniqueAddresses.length - dnsResult.allAddresses.length)

        // 只测试新的 IP
        const newAddresses = backupAddresses.filter(addr => !dnsResult.allAddresses.includes(addr))
        const newTestResults = await testMultipleIps(newAddresses, {
          port,
          timeout: connectivityTimeout,
          logger: log
        })

        // 合并测试结果
        testResults = [...testResults, ...newTestResults]
        dnsResult.allAddresses = allUniqueAddresses
      } else {
        log?.warn('[DNS] Backup DNS returned same IPs, no new options available')
      }
    } catch (err) {
      log?.warn('[DNS] Backup DNS resolution failed: %s', (err as Error).message)
    }
  }

  // 4. 选择最佳 IP
  const bestIp = selectBestIpFromTestResults(testResults, strategy)

  // 5. 检查是否需要提示使用代理
  const finalReachableCount = testResults.filter(r => r.reachable).length
  const proxyRequired = finalReachableCount === 0

  if (proxyRequired) {
    log?.warn('[DNS] ⚠️  All %d IPs unreachable for %s. Proxy/VPN required for this service.',
      testResults.length, hostname)
  }

  log?.info('[DNS] Selected best IP: %s (latency: %s%s)',
    bestIp.address,
    bestIp.latency === Infinity ? 'N/A' : `${bestIp.latency}ms`,
    proxyRequired ? ', PROXY REQUIRED' : ''
  )

  return {
    selectedAddress: bestIp.address,
    allAddresses: dnsResult.allAddresses,
    isPreferred: bestIp.isPreferred,
    latency: bestIp.latency === Infinity ? undefined : bestIp.latency,
    proxyRequired
  }
}
