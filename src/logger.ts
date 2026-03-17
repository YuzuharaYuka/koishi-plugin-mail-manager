/** 统一日志工具 */

import { Context, Logger } from 'koishi'

const baseLogger = new Logger('mail-manager')
let isDebugEnabled = false

/** 预定义日志模块常量 */
export const LogModule = {
  CONNECT: '连接',
  SYNC: '同步',
  FORWARD: '转发',
  RULE: '规则',
  SYSTEM: '系统',
  CLEANUP: '清理',
  MAIL: '邮件',
  IMAP: 'IMAP',
} as const

/** 全局 logger 实例 */
let globalLogger: MailManagerLogger | null = null

/** 获取全局 logger 实例 */
export function getLogger(): MailManagerLogger {
  if (!globalLogger) {
    throw new Error('Logger not initialized. Call setGlobalLogger first.')
  }
  return globalLogger
}

/** 设置全局 logger 实例 */
export function setGlobalLogger(logger: MailManagerLogger): void {
  globalLogger = logger
}

/** 设置调试模式 */
export function setDebugMode(enabled: boolean): void {
  isDebugEnabled = enabled
}

/** 统一日志工具类 */
export class MailManagerLogger {
  constructor(private ctx: Context) {}

  /** 格式化消息：当 module 非空时，添加 [模块] 前缀 */
  private format(module: string, message: string): string {
    return module ? `[${module}] ${message}` : message
  }

  info(module: string, message: string): void {
    baseLogger.info(this.format(module, message))
  }

  warn(module: string, message: string): void {
    baseLogger.warn(this.format(module, message))
  }

  error(module: string, message: string): void {
    baseLogger.error(this.format(module, message))
  }

  /** 仅在调试模式下输出 */
  debug(module: string, message: string): void {
    if (isDebugEnabled) {
      baseLogger.debug(this.format(module, message))
    }
  }

  success(module: string, message: string): void {
    baseLogger.success(this.format(module, message))
  }
}

/** 创建日志实例 */
export function createLogger(ctx: Context): MailManagerLogger {
  return new MailManagerLogger(ctx)
}
