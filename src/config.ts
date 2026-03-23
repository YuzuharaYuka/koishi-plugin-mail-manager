import { Schema } from 'koishi'
import { randomBytes } from 'crypto'

export interface Config {
  debug: boolean
  encryptionKey: string
  mailRetentionDays: number
  autoCleanup: boolean
  maxReconnectAttempts: number
  reconnectBaseInterval: number
  fastReconnectAttempts: number
  fastReconnectInterval: number
  reconnectMaxInterval: number
  reconnectJitterRatio: number
  startupConnectStagger: number
  connectionTimeout: number
  healthCheckInterval: number
  connectivityTestTimeout: number
}

// 每次加载配置时生成新密钥（未持久化时作为默认值）
const generateDefaultKey = () => randomBytes(32).toString('base64')

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().default(false).description('输出详细调试日志（排障时开启）'),
    encryptionKey: Schema.string().default(generateDefaultKey())
      .description('账号密码加密密钥（建议固定设置，避免重启后无法解密）').role('secret'),
    mailRetentionDays: Schema.number().default(30).min(0)
      .description('邮件本地保留天数（0 = 永久保留）'),
    autoCleanup: Schema.boolean().default(true)
      .description('自动清理过期邮件（启动后约 30 秒首轮，之后每 24 小时）'),
  }).description('存储与安全'),

  Schema.object({
    maxReconnectAttempts: Schema.number().default(10).min(1).max(999)
      .description('单账号最大重连次数（达到后标记为错误）'),
    reconnectBaseInterval: Schema.number().default(20).min(5).max(300)
      .description('指数退避基础间隔（秒）'),
    fastReconnectAttempts: Schema.number().default(2).min(0).max(10)
      .description('快速重连次数（用于 ECONNRESET/超时等临时故障）'),
    fastReconnectInterval: Schema.number().default(8).min(3).max(120)
      .description('快速重连固定间隔（秒）'),
    reconnectMaxInterval: Schema.number().default(300).min(30).max(1800)
      .description('重连最大间隔上限（秒）'),
    reconnectJitterRatio: Schema.number().default(0.2).min(0).max(0.5).step(0.05)
      .description('重连抖动比例（0.2 = ±20%，用于错峰减少雪崩重连）'),
    startupConnectStagger: Schema.number().default(1500).min(0).max(10000).step(100)
      .description('启动时账号连接错峰间隔（毫秒）'),
  }).description('连接重试策略'),

  Schema.object({
    connectionTimeout: Schema.number().default(30).min(10).max(120)
      .description('IMAP 连接超时（秒）'),
    healthCheckInterval: Schema.number().default(300).min(60).max(3600)
      .description('健康检查间隔（秒）'),
    connectivityTestTimeout: Schema.number().default(3000).min(1000).max(10000)
      .description('DNS 候选 IP 连通性测试超时（毫秒）'),
  }).description('网络探测与健康检查'),
])

