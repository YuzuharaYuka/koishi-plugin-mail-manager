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
  ctx.command('mail.cleanup', '清理邮件数据库')
    .option('expired', '-e 仅清理过期邮件')
    .option('all', '-a 清理所有邮件（危险！）')
    .option('dry-run', '-d 预览清理数量（不实际删除）')
    .action(async ({ options, session }) => {
      // 1. Validate options
      if (!options.expired && !options.all) {
        return '请指定清理模式：\n-e 清理过期邮件\n-a 清理所有邮件（危险！）'
      }

      if (options.all && !options['dry-run']) {
        return '清理所有邮件需要添加 -d 预览或明确确认。使用 mail.cleanup -a -d 预览'
      }

      try {
        // 2. Handle "Expired Mails" cleanup
        if (options.expired) {
          if (config.mailRetentionDays <= 0) {
            return '未设置邮件保留天数（当前为永久保留），无法清理过期邮件'
          }

          const isDryRun = !!options['dry-run']

          // Use the shared cleanup logic
          const count = await cleanExpiredMails(ctx, config.mailRetentionDays, {
            dryRun: isDryRun,
            reportProgress: async (msg) => { await session.send(msg) }
          })

          if (isDryRun) {
            const cutoffDate = new Date()
            cutoffDate.setDate(cutoffDate.getDate() - config.mailRetentionDays)
            return `预览：将清理 ${count} 封过期邮件（早于 ${cutoffDate.toLocaleString()}）`
          }

          return `清理完成：已删除 ${count} 封过期邮件`
        }

        // 3. Handle "All Mails" cleanup (Preview only for safety)
        if (options.all) {
          const totalMails = await ctx.database.eval('mail_manager.mails', row => $.count(row.id)) as number
          return `预览：将清理 ${totalMails || 0} 封邮件（全部）\n\n如需执行，请联系管理员在数据库中直接操作`
        }

      } catch (err) {
        ctx.logger.error('Cleanup command failed: %s', (err as Error).message)
        return `清理失败：${(err as Error).message}`
      }
    })
}

/**
 * Registers the 'mail.memory' command.
 * Displays memory usage statistics for monitoring purposes.
 */
function registerMemoryCommand(ctx: Context) {
  ctx.command('mail.memory', '查看插件内存使用情况')
    .action(async () => {
      const usage = process.memoryUsage()
      const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)

      let output = `邮件管理器内存使用情况:\n`
      output += `- 堆内存使用: ${formatMB(usage.heapUsed)} MB / ${formatMB(usage.heapTotal)} MB\n`
      output += `- RSS (总内存): ${formatMB(usage.rss)} MB\n`
      output += `- 外部内存: ${formatMB(usage.external)} MB\n`

      if (!global.gc) {
        output += `\n未启用手动垃圾回收 (GC)\n`
        output += `建议启动 Koishi 时添加参数: --node-arg=--expose-gc`
      } else {
        output += `\n手动 GC 已启用，可使用 mail.gc 命令释放内存`
      }

      // Add database statistics
      try {
        const totalMails = await ctx.database.eval('mail_manager.mails', row => $.count(row.id), {}) as number
        output += `\n\n数据库统计:\n`
        output += `- 总邮件数: ${totalMails}`
      } catch (err) {
        output += `\n\n无法获取数据库统计`
      }

      return output
    })
}

/**
 * Registers the 'mail.gc' command.
 * Allows manual triggering of Garbage Collection if exposed.
 */
function registerGcCommand(ctx: Context) {
  ctx.command('mail.gc', '手动触发垃圾回收')
    .action(async () => {
      if (!global.gc) {
        return '未启用手动垃圾回收\n请使用以下方式启动 Koishi:\nkoishi start --node-arg=--expose-gc'
      }

      const before = process.memoryUsage()

      // Trigger GC
      global.gc()

      // Wait a bit for GC to settle
      await new Promise(resolve => setTimeout(resolve, 100))

      const after = process.memoryUsage()
      const freedMB = ((before.heapUsed - after.heapUsed) / 1024 / 1024).toFixed(2)

      return `垃圾回收完成\n释放内存: ${freedMB} MB\n当前堆内存: ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB`
    })
}
