import { Context, $ } from 'koishi'
import * as core from './core'
import { getLogger } from './logger'
import { Config } from './config'
import { cleanExpiredMails } from './cleanup'
import type {
  CreateMailAccountRequest,
  UpdateMailAccountRequest,
  MailListQuery,
  ForwardPreviewRequest,
  ForwardRule,
} from './types'

/**
 * 日志代理 - 简化格式为 mail-manager 消息内容
 *
 * 封装了 getLogger() 调用，确保在任何时候都能安全地记录日志。
 */
class LoggerProxy {
  info(msg: string, ...args: any[]) { this.log('info', msg, args) }
  warn(msg: string, ...args: any[]) { this.log('warn', msg, args) }
  error(msg: string, ...args: any[]) { this.log('error', msg, args) }
  debug(msg: string, ...args: any[]) { this.log('debug', msg, args) }

  private log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, args: any[]) {
    try {
      const logger = getLogger()
      const message = args.length > 0 ? this.formatMessage(msg, args) : msg
      logger[level]('', message)
    } catch (e) {
      // 忽略日志记录失败，避免影响主流程
    }
  }

  private formatMessage(format: string, args: any[]): string {
    let result = format
    for (const arg of args) {
      result = result.replace(/%[sd]/, String(arg))
    }
    return result
  }
}

const logger = new LoggerProxy()

/**
 * 注册控制台 API
 *
 * 将 API 注册逻辑委托给 ApiRegistrar 类处理，保持入口函数简洁。
 */
export function registerConsoleApi(ctx: Context, config: Config): void {
  new ApiRegistrar(ctx, config).register()
  logger.info('API 已注册')
}

/**
 * API 注册器
 *
 * 负责将各类 API 注册到 Koishi 控制台。
 * 按照功能模块对 API 进行分组，提高代码的可读性和可维护性。
 */
class ApiRegistrar {
  constructor(private ctx: Context, private config: Config) {}

  /**
   * 注册所有 API
   */
  register() {
    this.registerAccountApis()
    this.registerMailApis()
    this.registerRuleApis()
    this.registerPreviewApis()
    this.registerSystemApis()
    this.registerCleanupApis()
  }

  /**
   * 注册账号管理相关 API
   */
  private registerAccountApis() {
    this.addListener('mail-manager/accounts/list', () => core.getAccounts())

    this.addListener('mail-manager/accounts/get', async (id: number) => {
      const account = await core.getAccount(id)
      if (!account) throw new Error('账号不存在')
      return account
    })

    this.addListener('mail-manager/accounts/create', (data: CreateMailAccountRequest) => core.createAccount(data))

    this.addListener('mail-manager/accounts/update', (id: number, data: UpdateMailAccountRequest) => core.updateAccount(id, data))

    this.addListener('mail-manager/accounts/delete', (id: number) => core.deleteAccount(id))

    this.addListener('mail-manager/accounts/test', (id: number) => core.testConnection(id))

    this.addListener('mail-manager/accounts/connect', (id: number) => core.connectAccount(id))

    this.addListener('mail-manager/accounts/disconnect', (id: number) => core.disconnectAccount(id))

    this.addListener('mail-manager/accounts/sync', (id: number, days?: number) => core.syncAccountMails(id, days))
  }

  /**
   * 注册邮件管理相关 API
   */
  private registerMailApis() {
    this.addListener('mail-manager/mails/list', (query: MailListQuery) => core.getMails(query))

    this.addListener('mail-manager/mails/get', async (id: number) => {
      const mail = await core.getMail(id)
      if (!mail) throw new Error('邮件不存在')
      return mail
    })

    this.addListener('mail-manager/mails/delete', (id: number) => core.deleteMail(id))

    this.addListener('mail-manager/mails/read', (id: number) => core.markAsRead(id))

    this.addListener('mail-manager/mails/forward', (mailId: number, ruleId?: number) => core.forwardMail(mailId, ruleId))

    this.addListener('mail-manager/mails/batch-delete', (accountId?: number, days?: number) => core.batchDeleteMails(accountId, days))
  }

  /**
   * 注册规则管理相关 API
   */
  private registerRuleApis() {
    this.addListener('mail-manager/rules/list', () => core.getRules())

    this.addListener('mail-manager/rules/get', async (id: number) => {
      const rule = await core.getRule(id)
      if (!rule) throw new Error('规则不存在')
      return rule
    })

    this.addListener('mail-manager/rules/create', (data: Partial<ForwardRule>) => core.createRule(data))

    this.addListener('mail-manager/rules/update', (id: number, data: Partial<ForwardRule>) => core.updateRule(id, data))

    this.addListener('mail-manager/rules/delete', (id: number) => core.deleteRule(id))

    // 新增：规则测试 API
    this.addListener('mail-manager/rules/test', async (ruleId: number, mailId: number) => {
      return await core.testRule(ruleId, mailId)
    })

    // 新增：规则导出 API
    this.addListener('mail-manager/rules/export', async () => {
      const rules = await core.getRules()
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        rules: rules.map(r => ({
          ...r,
          id: undefined, // 导出时移除 ID
          createdAt: undefined,
          updatedAt: undefined,
        })),
      }
    })

    // 新增：规则导入 API
    this.addListener('mail-manager/rules/import', async (data: { version: string; rules: Partial<ForwardRule>[] }) => {
      if (!data || !data.rules || !Array.isArray(data.rules)) {
        throw new Error('无效的导入数据格式')
      }

      let imported = 0
      let skipped = 0

      for (const ruleData of data.rules) {
        try {
          // 检查是否已存在同名规则
          const existingRules = await core.getRules()
          const duplicate = existingRules.find(r => r.name === ruleData.name)

          if (duplicate) {
            skipped++
            continue
          }

          await core.createRule(ruleData)
          imported++
        } catch (e) {
          logger.warn('导入规则失败: %s', (e as Error).message)
          skipped++
        }
      }

      return { imported, skipped }
    })
  }

  /**
   * 注册预览相关 API
   */
  private registerPreviewApis() {
    this.addListener('mail-manager/preview', (request: ForwardPreviewRequest) => core.getForwardPreview(request))
  }

  /**
   * 注册系统信息相关 API
   */
  private registerSystemApis() {
    this.addListener('mail-manager/targets', () => core.getAvailableTargets())

    this.addListener('mail-manager/stats', async () => {
      const [accounts, mails, rules, unreadMails] = await Promise.all([
        core.getAccounts(),
        core.getMails({ pageSize: 1 }),
        core.getRules(),
        core.getMails({ pageSize: 1, isRead: false })
      ])

      return {
        accountCount: accounts.length,
        connectedCount: accounts.filter(a => a.status === 'connected').length,
        mailCount: mails.total,
        unreadCount: unreadMails.total,
        ruleCount: rules.length,
        enabledRuleCount: rules.filter(r => r.enabled).length,
      }
    })

    // 健康检查 API
    this.addListener('mail-manager/health', async () => {
      const accounts = await core.getAccounts()
      const connectedAccounts = accounts.filter(a => a.status === 'connected')
      const errorAccounts = accounts.filter(a => a.status === 'error')

      const memoryUsage = process.memoryUsage()
      const uptime = process.uptime()

      return {
        status: errorAccounts.length === 0 ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        accounts: {
          total: accounts.length,
          connected: connectedAccounts.length,
          error: errorAccounts.length,
          errorDetails: errorAccounts.map(a => ({
            id: a.id,
            email: a.email,
            lastError: a.lastError,
          })),
        },
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
        },
        uptime: Math.round(uptime),
      }
    })

    // 指标监控 API
    this.addListener('mail-manager/metrics', async () => {
      const [accounts, mails, rules] = await Promise.all([
        core.getAccounts(),
        core.getMails({ pageSize: 1 }),
        core.getRules()
      ])

      // 按状态分组账号
      const accountsByStatus = accounts.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      // 最近24小时的邮件统计
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const recentMails = await core.getMails({
        pageSize: 1,
        startDate: oneDayAgo.toISOString(),
      })

      const recentForwarded = await this.ctx.database
        .select('mail_manager.mails')
        .where({
          isForwarded: true,
          forwardedAt: { $gte: oneDayAgo },
        })
        .execute()

      return {
        timestamp: new Date().toISOString(),
        accounts: {
          total: accounts.length,
          byStatus: accountsByStatus,
        },
        mails: {
          total: mails.total,
          last24h: recentMails.total,
          forwardedLast24h: recentForwarded.length,
        },
        rules: {
          total: rules.length,
          enabled: rules.filter(r => r.enabled).length,
        },
        memory: {
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
      }
    })
  }

  /**
   * 注册清理相关 API
   */
  private registerCleanupApis() {
    // 清理过期邮件
    this.addListener('mail-manager/cleanup/expired', async (dryRun: boolean = false) => {
      if (!this.config.mailRetentionDays || this.config.mailRetentionDays <= 0) {
        throw new Error('未设置邮件保留天数，无法执行清理')
      }

      // 使用 cleanup.ts 中的逻辑
      const count = await cleanExpiredMails(this.ctx, this.config.mailRetentionDays, { dryRun })

      // 计算截止日期用于展示
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - this.config.mailRetentionDays)

      return {
        dryRun,
        count,
        cutoffDate: cutoffDate.toISOString(),
      }
    })

    // 清理所有邮件
    this.addListener('mail-manager/cleanup/all', async (confirm: boolean = false) => {
      if (!confirm) {
        const count = await this.ctx.database.eval('mail_manager.mails', row => $.count(row.id)) as number
        return { needConfirm: true, count: count || 0 }
      }

      const count = await this.batchDeleteAllMails()
      return { needConfirm: false, count }
    })
  }

  /**
   * 辅助方法：批量删除所有邮件
   * 添加最大批次限制，防止运行时间过长
   */
  private async batchDeleteAllMails(maxBatches: number = 10000): Promise<number> {
    const BATCH_SIZE = 100
    let totalDeleted = 0
    let batchCount = 0

    while (true) {
      const batch = await this.ctx.database
        .select('mail_manager.mails', ['id'])
        .limit(BATCH_SIZE)
        .execute()

      if (batch.length === 0) break

      const batchIds = batch.map(m => m.id)
      await this.ctx.database.remove('mail_manager.mails', {
        id: { $in: batchIds },
      })

      totalDeleted += batch.length
      batchCount++

      // 达到最大批次限制时停止
      if (batchCount >= maxBatches) {
        logger.warn('已达到最大批次限制 (%d 批)，停止删除', maxBatches)
        break
      }

      // 让出事件循环，避免阻塞
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    return totalDeleted
  }

  /**
   * 封装 addListener，提供类型提示并简化调用
   */
  private addListener(name: string, callback: (...args: any[]) => any) {
    // 使用 as any 绕过 Koishi Console 的类型限制，因为我们是在动态注册
    this.ctx.console.addListener(name as any, callback)
  }
}
