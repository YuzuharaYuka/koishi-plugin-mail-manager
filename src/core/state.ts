/**
 * 核心模块 - 全局状态管理
 *
 * 集中管理插件的全局状态，避免循环依赖
 */

import { Context } from 'koishi'
import type { Config, ForwardRule } from '../types'
import type { ImapConnection } from '../imap'
import type { MailRenderer } from '../render'
import type { MailManagerLogger } from '../logger'

// ============ 常量定义 ============

export const TABLE_ACCOUNTS = 'mail_manager.accounts'
export const TABLE_MAILS = 'mail_manager.mails'
export const TABLE_RULES = 'mail_manager.rules'
export const RULES_CACHE_TTL_MS = 60000 // 1分钟缓存

// ============ 实例隔离机制 ============

/** 当前实例 ID（用于热重载隔离） */
let _instanceId = 0

/** 生成新的实例 ID */
export function generateInstanceId(): number {
  return ++_instanceId
}

/** 当前活跃的实例 ID */
let _currentInstanceId = 0

export function getCurrentInstanceId(): number {
  return _currentInstanceId
}

export function setCurrentInstanceId(id: number): void {
  _currentInstanceId = id
}

// ============ 全局状态 ============

/** 活跃的 IMAP 连接集合 */
export const activeConnections = new Map<number, ImapConnection>()

/** 账号操作互斥锁，确保同一账号的连接/断开操作顺序执行 */
export const accountOperationLocks = new Map<number, Promise<void>>()

/** 插件上下文 */
let _context: Context | null = null

/** 插件配置 */
let _pluginConfig: Config | null = null

/** 邮件渲染器 */
let _mailRenderer: MailRenderer | null = null

/** 日志记录器 */
let _logger: MailManagerLogger | null = null

/** 调试模式标志 */
let _isDebugMode = false

/** 转发规则缓存 */
export const rulesCache = {
  data: null as ForwardRule[] | null,
  lastUpdate: 0,
  queryPromise: null as Promise<ForwardRule[]> | null,
}

// ============ 状态访问器 ============

export function getContext(): Context {
  if (!_context) {
    throw new Error('Core module not initialized. Call initState() first.')
  }
  return _context
}

export function getConfig(): Config {
  if (!_pluginConfig) {
    throw new Error('Core module not initialized. Call initState() first.')
  }
  return _pluginConfig
}

export function getMailRenderer(): MailRenderer {
  if (!_mailRenderer) {
    throw new Error('Core module not initialized. Call initState() first.')
  }
  return _mailRenderer
}

export function getLogger(): MailManagerLogger {
  if (!_logger) {
    throw new Error('Core module not initialized. Call initState() first.')
  }
  return _logger
}

export function isDebugMode(): boolean {
  return _isDebugMode
}

export function setDebugMode(enabled: boolean): void {
  _isDebugMode = enabled
}

// ============ 初始化 ============

/**
 * 初始化全局状态
 */
export function initState(
  ctx: Context,
  config: Config,
  logger: MailManagerLogger,
  mailRenderer: MailRenderer
): void {
  _context = ctx
  _pluginConfig = config
  _logger = logger
  _mailRenderer = mailRenderer
}

/**
 * 清理全局状态（用于热重载）
 */
export function clearState(): void {
  activeConnections.clear()
  accountOperationLocks.clear()
  rulesCache.data = null
  rulesCache.lastUpdate = 0
  rulesCache.queryPromise = null
}

/**
 * 使规则缓存失效
 */
export function invalidateRulesCache(): void {
  rulesCache.data = null
  rulesCache.lastUpdate = 0
  rulesCache.queryPromise = null
}
