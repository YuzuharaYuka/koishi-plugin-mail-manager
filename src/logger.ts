/**
 * 统一日志工具
 * 所有日志格式: mail-manager [模块] 消息内容
 */

import { Context, Logger } from 'koishi'

const baseLogger = new Logger('mail-manager')
let isDebugEnabled = false

/**
 * 预定义的日志模块常量
 */
export const LogModule = {
  CONNECT: '连接',        // IMAP 连接相关
  SYNC: '同步',           // 邮件同步相关
  FORWARD: '转发',        // 邮件转发相关
  RULE: '规则',           // 转发规则相关
  SYSTEM: '系统',         // 系统级操作（启动、卸载等）
  CLEANUP: '清理',        // 数据清理相关
} as const

/** 全局 logger 实例（用于在初始化前访问） */
let globalLogger: MailManagerLogger | null = null

/**
 * 获取全局 logger 实例
 */
export function getLogger(): MailManagerLogger {
  if (!globalLogger) {
    throw new Error('Logger not initialized. Call setGlobalLogger first.')
  }
  return globalLogger
}

/**
 * 设置全局 logger 实例
 */
export function setGlobalLogger(logger: MailManagerLogger): void {
  globalLogger = logger
}

/**
 * 设置调试模式
 */
export function setDebugMode(enabled: boolean): void {
  isDebugEnabled = enabled
}

/**
 * 日志级别类型
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success'

/**
 * 格式化日志消息
 * @param module 模块名称（不再使用，保留用于兼容）
 * @param message 消息内容
 */
function formatMessage(module: string, message: string): string {
  return message
}

/**
 * 统一的日志工具类
 */
export class MailManagerLogger {
  constructor(private ctx: Context) {}

  /**
   * 信息日志
   */
  info(module: string, message: string): void {
    baseLogger.info(formatMessage(module, message))
  }

  /**
   * 警告日志
   */
  warn(module: string, message: string): void {
    baseLogger.warn(formatMessage(module, message))
  }

  /**
   * 错误日志
   */
  error(module: string, message: string): void {
    baseLogger.error(formatMessage(module, message))
  }

  /**
   * 调试日志（仅在 debug 模式下显示）
   */
  debug(module: string, message: string): void {
    if (isDebugEnabled) {
      baseLogger.debug(formatMessage(module, message))
    }
  }

  /**
   * 成功日志
   */
  success(module: string, message: string): void {
    baseLogger.success(formatMessage(module, message))
  }
}

/**
 * 创建日志实例
 */
export function createLogger(ctx: Context): MailManagerLogger {
  return new MailManagerLogger(ctx)
}
