/**
 * 全局配置常量
 * 统一管理所有策略常量
 */

/**
 * 重连策略配置
 */
export const RECONNECT_STRATEGY = {
  MAX_ATTEMPTS: 999,
  BASE_DELAY: 5000,
} as const

/**
 * 邮件同步策略配置
 */
export const SYNC_STRATEGY = {
  BATCH_SIZE: 30,
  FETCH_TIMEOUT: 30000,
  RETRY_THRESHOLD: 50,
  EXTENDED_TIMEOUT: 60000,
  SMALL_IMAGE_LIMIT: 500 * 1024, // 500KB
} as const

/**
 * 连接策略配置
 */
export const CONNECTION_STRATEGY = {
  TIMEOUT: 10000,
  DISCONNECT_WAIT: 200,
  DISCONNECT_TIMEOUT: 3000,
  MAX_DISCONNECT_WAIT: 5000,
  POLL_INTERVAL: 100,
} as const
