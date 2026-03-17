import { Context, $, Logger } from 'koishi'
import { sleep } from './utils'

// cleanup.ts 使用独立 logger，不依赖全局状态，确保在任何阶段都可安全调用
const logger = new Logger('mail-manager')

/** 邮件清理选项 */
export interface CleanupOptions {
  /** 若为 true，仅统计待删除数量，不实际执行删除 */
  dryRun?: boolean
  /** 可选进度回调，用于向用户实时汇报进度 */
  reportProgress?: (message: string) => Promise<void>
}

/**
 * 批量清理过期邮件
 *
 * 采用分批删除策略避免数据库锁定和内存峰值问题。
 * @param ctx Koishi 上下文
 * @param retentionDays 保留天数（必须 > 0）
 * @param options 清理选项
 * @returns 已删除的邮件数量
 */
export async function cleanExpiredMails(
  ctx: Context,
  retentionDays: number,
  options: CleanupOptions = {}
): Promise<number> {
  const { dryRun = false, reportProgress } = options

  if (retentionDays <= 0) {
    throw new Error('保留天数必须大于 0')
  }

  const expirationThreshold = new Date()
  expirationThreshold.setDate(expirationThreshold.getDate() - retentionDays)
  const condition = { receivedAt: { $lt: expirationThreshold } }

  // 仅统计，不加载邮件数据到内存
  const expiredMailCount = await ctx.database.eval('mail_manager.mails', row => $.count(row.id), condition) as number

  if (!expiredMailCount) return 0

  if (dryRun) return expiredMailCount

  if (reportProgress) {
    await reportProgress(`发现 ${expiredMailCount} 封过期邮件，开始清理...`)
  }

  const BATCH_SIZE = 100
  const MAX_BATCHES = 10000 // 防止异常时无限循环
  let totalDeleted = 0
  let batchCount = 0

  while (true) {
    if (++batchCount > MAX_BATCHES) {
      logger.warn(`[清理] 已达最大批次限制 (${MAX_BATCHES})，终止循环`)
      break
    }

    // 批量获取待删除 ID（避免一次性加载全部到内存）
    const batch = await ctx.database
      .select('mail_manager.mails')
      .where(condition)
      .limit(BATCH_SIZE)
      .project(['id'])
      .execute()

    if (batch.length === 0) break

    await ctx.database.remove('mail_manager.mails', { id: { $in: batch.map(m => m.id) } })

    totalDeleted += batch.length

    if (reportProgress && totalDeleted % 500 === 0) {
      await reportProgress(`已清理 ${totalDeleted}/${expiredMailCount}...`)
    }

    // 短暂让出事件循环，避免阻塞数据库
    await sleep(50)
  }

  return totalDeleted
}

/** 自动清理任务的执行间隔：24 小时 */
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000

/**
 * 注册自动清理定时任务
 * 插件启动 30 秒后执行首次清理，此后每 24 小时执行一次。
 */
export function scheduleAutoCleanup(ctx: Context, config: { autoCleanup: boolean; mailRetentionDays: number }) {
  if (!config.autoCleanup || config.mailRetentionDays <= 0) return

  const runCleanup = async () => {
    try {
      logger.debug('[自动清理] 开始...')
      const deletedCount = await cleanExpiredMails(ctx, config.mailRetentionDays, {
        reportProgress: async (msg) => logger.debug(`[自动清理] ${msg}`),
      })
      if (deletedCount > 0) {
        logger.info(`[自动清理] 已删除 ${deletedCount} 封过期邮件`)
      }
    } catch (error) {
      logger.error(`[自动清理] 失败: ${(error as Error).message}`)
    }
  }

  // 延迟首次执行，等待应用完全启动后再运行
  ctx.setTimeout(() => runCleanup().catch(err => logger.error(`[自动清理] 失败: ${err.message}`)), 30000)
  ctx.setInterval(runCleanup, CLEANUP_INTERVAL)
}
