import { Context, $ } from 'koishi'
import { Config } from './config'
import { cleanExpiredMails } from './cleanup'

/**
 * Registers all available commands for the Mail Manager plugin.
 *
 * @param ctx The Koishi context.
 * @param config The plugin configuration.
 */
export function registerCommands(ctx: Context, config: Config) {
  registerCleanupCommand(ctx, config)
  registerMemoryCommand(ctx)
  registerGcCommand(ctx)
}

/**
 * Registers the 'mail.cleanup' command.
 * Allows administrators to manually clean up the mail database.
 */
function registerCleanupCommand(ctx: Context, config: Config) {
  ctx.command('mail.cleanup', '清理邮件')
    .option('expired', '-e 清理过期邮件')
    .option('all', '-a 清理所有邮件')
    .option('dry-run', '-d 预览清理数量')
    .action(async ({ options, session }) => {
      if (!options.expired && !options.all) {
        return '请指定: -e 过期邮件 / -a 所有邮件'
      }

      if (options.all && !options['dry-run']) {
        return '清理所有邮件需添加 -d 预览'
      }

      try {
        if (options.expired) {
          if (config.mailRetentionDays <= 0) {
            return '未设置保留天数'
          }

          const isDryRun = !!options['dry-run']

          const count = await cleanExpiredMails(ctx, config.mailRetentionDays, {
            dryRun: isDryRun,
            reportProgress: async (msg) => { await session.send(msg) }
          })

          if (isDryRun) {
            const cutoffDate = new Date()
            cutoffDate.setDate(cutoffDate.getDate() - config.mailRetentionDays)
            return `预览: ${count} 封过期邮件 (早于 ${cutoffDate.toLocaleDateString()})`
          }

          return `已删除 ${count} 封过期邮件`
        }

        if (options.all) {
          const totalMails = await ctx.database.eval('mail_manager.mails', row => $.count(row.id)) as number
          return `预览: ${totalMails || 0} 封邮件`
        }

      } catch (err) {
        ctx.logger.error('Cleanup failed: %s', (err as Error).message)
        return `失败: ${(err as Error).message}`
      }
    })
}

/**
 * Registers the 'mail.memory' command.
 * Displays memory usage statistics for monitoring purposes.
 */
function registerMemoryCommand(ctx: Context) {
  ctx.command('mail.memory', '内存使用情况')
    .action(async () => {
      const usage = process.memoryUsage()
      const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)

      let output = `堆内存: ${formatMB(usage.heapUsed)}/${formatMB(usage.heapTotal)} MB\n`
      output += `RSS: ${formatMB(usage.rss)} MB\n`
      output += `外部: ${formatMB(usage.external)} MB`

      if (!global.gc) {
        output += `\nGC 未启用 (--node-arg=--expose-gc)`
      } else {
        output += `\nGC 已启用，可用 mail.gc 释放`
      }

      try {
        const totalMails = await ctx.database.eval('mail_manager.mails', row => $.count(row.id), {}) as number
        output += `\n邮件数: ${totalMails}`
      } catch (err) {
        // ignore
      }

      return output
    })
}

function registerGcCommand(ctx: Context) {
  ctx.command('mail.gc', '垃圾回收')
    .action(async () => {
      if (!global.gc) {
        return 'GC 未启用\n启动参数: --node-arg=--expose-gc'
      }

      const before = process.memoryUsage()
      global.gc()
      await new Promise(resolve => setTimeout(resolve, 100))
      const after = process.memoryUsage()
      const freedMB = ((before.heapUsed - after.heapUsed) / 1024 / 1024).toFixed(2)

      return `释放 ${freedMB} MB，当前 ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB`
    })
}
