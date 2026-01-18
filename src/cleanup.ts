import { Context, $ } from 'koishi'
import { Logger } from 'koishi'
import { sleep } from './utils'

const logger = new Logger('mail-manager')

/**
 * Options for the mail cleanup process.
 */
export interface CleanupOptions {
  /**
   * If true, only simulate the cleanup and return the count of mails that would be deleted.
   */
  dryRun?: boolean

  /**
   * Optional callback to report progress during the cleanup.
   */
  reportProgress?: (message: string) => Promise<void>
}

/**
 * Cleans up expired mails from the database based on the retention policy.
 *
 * This function performs the cleanup in batches to avoid database locks and memory issues.
 *
 * @param ctx The Koishi context.
 * @param retentionDays The number of days to retain mails. Mails older than this will be deleted.
 * @param options Optional configuration for the cleanup process.
 * @returns A promise that resolves to the number of deleted mails (or would-be deleted in dry-run).
 */
export async function cleanExpiredMails(
  ctx: Context,
  retentionDays: number,
  options: CleanupOptions = {}
): Promise<number> {
  const { dryRun = false, reportProgress } = options

  // 1. Calculate the cutoff date
  if (retentionDays <= 0) {
    throw new Error('Retention days must be greater than 0.')
  }

  const expirationThreshold = new Date()
  expirationThreshold.setDate(expirationThreshold.getDate() - retentionDays)

  // 2. Count expired mails
  // We use $.count to get the number of records without loading them into memory.
  const expiredMailCount = await ctx.database.eval('mail_manager.mails', row => $.count(row.id), {
    receivedAt: { $lt: expirationThreshold },
  }) as number

  if (!expiredMailCount || expiredMailCount === 0) {
    return 0
  }

  // If it's a dry run, we just return the count.
  if (dryRun) {
    return expiredMailCount
  }

  // 3. Perform batch deletion
  const BATCH_SIZE = 100
  let totalDeleted = 0

  if (reportProgress) {
    await reportProgress(`Found ${expiredMailCount} expired mails. Starting cleanup...`)
  }

  while (totalDeleted < expiredMailCount) {
    // Fetch a batch of IDs to delete
    const batch = await ctx.database
      .select('mail_manager.mails')
      .where({ receivedAt: { $lt: expirationThreshold } })
      .limit(BATCH_SIZE)
      .project(['id'])
      .execute()

    if (batch.length === 0) {
      break
    }

    const batchIds = batch.map(mail => mail.id)

    // Delete the batch
    await ctx.database.remove('mail_manager.mails', batchIds)

    totalDeleted += batch.length

    // Report progress periodically
    if (reportProgress && totalDeleted % 500 === 0) {
      await reportProgress(`Cleaned ${totalDeleted}/${expiredMailCount} mails...`)
    }

    // Small delay to prevent database starvation
    await sleep(50)

    // Trigger Garbage Collection if available to keep memory footprint low
    if (totalDeleted % 500 === 0 && global.gc) {
      global.gc()
    }
  }

  // Final GC
  if (global.gc) {
    global.gc()
  }

  return totalDeleted
}

// 固定的清理间隔：24小时
const CLEANUP_INTERVAL = 86400000

/**
 * Schedules the automatic cleanup task.
 *
 * @param ctx The Koishi context.
 * @param config The plugin configuration.
 */
export function scheduleAutoCleanup(ctx: Context, config: { autoCleanup: boolean, mailRetentionDays: number }) {
  if (!config.autoCleanup || config.mailRetentionDays <= 0) {
    return
  }

  const runCleanup = async () => {
    try {
      logger.info('[Auto Cleanup] Starting scheduled cleanup task...')

      const deletedCount = await cleanExpiredMails(ctx, config.mailRetentionDays, {
        reportProgress: async (msg) => logger.info(`[Auto Cleanup] ${msg}`)
      })

      if (deletedCount > 0) {
        logger.info(`[Auto Cleanup] Completed. Deleted ${deletedCount} expired mails.`)
      } else {
        logger.debug('[Auto Cleanup] No expired mails found.')
      }
    } catch (error) {
      logger.error(`[Auto Cleanup] Failed: ${(error as Error).message}`)
    }
  }

  // Delay the first run to allow the application to start up fully
  ctx.setTimeout(() => {
    runCleanup().catch(err => logger.error(`[Auto Cleanup] Initial run failed: ${err.message}`))
  }, 30000)

  // Schedule the recurring task
  ctx.setInterval(runCleanup, CLEANUP_INTERVAL)
}
