import { Schema } from 'koishi'
import { randomBytes } from 'crypto'

export interface Config {
  debug: boolean
  encryptionKey: string
  mailRetentionDays: number
  autoCleanup: boolean
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectInterval: number
  connectionTimeout: number
  healthCheckEnabled: boolean
  healthCheckInterval: number
  enableConnectivityTest: boolean
  connectivityTestTimeout: number
}

const generateDefaultKey = () => randomBytes(32).toString('base64')

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().default(false).description('调试模式'),
    encryptionKey: Schema.string().default(generateDefaultKey())
      .description('密码加密密钥').role('secret'),
    mailRetentionDays: Schema.number().default(30).min(0)
      .description('保留天数 (0=永久)'),
    autoCleanup: Schema.boolean().default(true)
      .description('自动清理过期邮件'),
  }).description('基础设置'),

  Schema.object({
    autoReconnect: Schema.boolean().default(true).description('断线自动重连'),
    maxReconnectAttempts: Schema.number().default(10).min(1).max(999)
      .description('最大重连次数'),
    reconnectInterval: Schema.number().default(30).min(5).max(300)
      .description('重连间隔 (秒)'),
    connectionTimeout: Schema.number().default(30).min(10).max(120)
      .description('连接超时 (秒)'),
    healthCheckEnabled: Schema.boolean().default(true).description('健康检查'),
    healthCheckInterval: Schema.number().default(300).min(60).max(3600)
      .description('检查间隔 (秒)'),
    enableConnectivityTest: Schema.boolean().default(true)
      .description('IP 连通性测试'),
    connectivityTestTimeout: Schema.number().default(3000).min(1000).max(10000)
      .description('测试超时 (毫秒)'),
  }).description('连接设置'),
])

