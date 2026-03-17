/**
 * 全局配置常量
 * 统一管理所有策略常量
 */

/** 重连策略配置 */
export const RECONNECT_STRATEGY = {
  MAX_ATTEMPTS: 999,
  BASE_DELAY: 5000,
} as const

/** 邮件同步策略配置 */
export const SYNC_STRATEGY = {
  /** 每批次处理的邮件数量 */
  BATCH_SIZE: 30,
  /** 单封邮件拉取超时（毫秒） */
  FETCH_TIMEOUT: 30000,
  /** 超时邮件重试阈值（超过此数量不重试） */
  RETRY_THRESHOLD: 50,
  /** 超时重试时的扩展超时时间（毫秒） */
  EXTENDED_TIMEOUT: 60000,
  /** 内嵌图片附件大小限制（500 KB） */
  SMALL_IMAGE_LIMIT: 500 * 1024,
  /** 单封邮件最大体积（25 MB），超过则跳过 */
  MAX_MAIL_SIZE: 25 * 1024 * 1024,
  /** 单批次并发下载的最大总体积（100 MB） */
  MAX_BATCH_SIZE: 100 * 1024 * 1024,
} as const

/** 连接策略配置 */
export const CONNECTION_STRATEGY = {
  /** 连接超时（毫秒） */
  TIMEOUT: 10000,
  /** 断开后等待时间（毫秒），防止立即重连 */
  DISCONNECT_WAIT: 200,
  /** 断开操作最长等待时间（毫秒） */
  DISCONNECT_TIMEOUT: 3000,
  /** 等待上一次断开完成的最长时间（毫秒） */
  MAX_DISCONNECT_WAIT: 5000,
  /** 轮询等待间隔（毫秒） */
  POLL_INTERVAL: 100,
} as const
