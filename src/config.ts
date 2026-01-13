import { Schema } from 'koishi'

export interface Config {
  debug: boolean
  mailRetentionDays: number
  autoCleanup: boolean
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectInterval: number
  connectionTimeout: number
  healthCheckEnabled: boolean
  healthCheckInterval: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().default(false)
      .description('调试模式'),
    mailRetentionDays: Schema.number().default(30).min(0)
      .description('邮件保留天数(0为永久保留)'),
    autoCleanup: Schema.boolean().default(true)
      .description('自动清理过期邮件(每24小时检查一次)'),
  }).description('邮件管理'),

  Schema.object({
    autoReconnect: Schema.boolean().default(true)
      .description('自动重连(连接断开后自动尝试重新连接)'),
    maxReconnectAttempts: Schema.number().default(10).min(1).max(999)
      .description('最大重连尝试次数'),
    reconnectInterval: Schema.number().default(30).min(5).max(300)
      .description('重连基础间隔(秒)'),
    connectionTimeout: Schema.number().default(30).min(10).max(120)
      .description('连接超时时间(秒)'),
    healthCheckEnabled: Schema.boolean().default(true)
      .description('启用健康检查(定期检测连接状态并自动重连)'),
    healthCheckInterval: Schema.number().default(300).min(60).max(3600)
      .description('健康检查间隔(秒)'),
  }).description('连接设置'),
])

