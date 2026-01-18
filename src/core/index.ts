/**
 * 核心模块入口
 *
 * 统一导出所有核心功能，提供初始化接口
 */

import type { Context } from 'koishi'
import type { Config } from '../config'
import { MailManagerLogger, createLogger, LogModule } from '../logger'
import { MailRenderer } from '../render'
import {
  initState,
  clearState,
  generateInstanceId,
  setCurrentInstanceId,
  getCurrentInstanceId,
  activeConnections,
} from './state'
import { registerRulesCacheListener } from './rules'
import { startAllConnections, stopAllConnections } from './forward'
import type { ImapConnection } from '../imap'

// ============ 初始化 ============

export async function initCore(ctx: Context, config: Config): Promise<void> {
  const logger = createLogger(ctx)
  const mailRenderer = new MailRenderer(ctx)

  // 生成新的实例 ID，用于隔离热重载
  const instanceId = generateInstanceId()
  setCurrentInstanceId(instanceId)

  initState(ctx, config, logger, mailRenderer)

  // 注册规则缓存监听器（用于多实例同步）
  registerRulesCacheListener()

  // 启动已启用账户的连接
  await startAllConnections()

  // 捕获当前实例拥有的连接（用于 dispose 时安全断开）
  // 这确保热重载时旧实例只断开自己创建的连接
  const ownedConnections = new Map<number, ImapConnection>(activeConnections)

  // 注册清理回调
  ctx.on('dispose', async () => {
    // 检查是否是当前活跃实例，避免旧实例清理新实例的连接
    const isCurrentInstance = getCurrentInstanceId() === instanceId

    if (!isCurrentInstance) {
      logger.debug(LogModule.SYSTEM, `实例 #${instanceId} 已被新实例取代，跳过清理`)
      return
    }

    logger.info(LogModule.SYSTEM, '正在停止邮件服务...')
    try {
      // 只断开当前实例拥有的连接
      await stopOwnedConnections(ownedConnections, logger)
    } catch (e) {
      logger.error(LogModule.SYSTEM, `停止失败: ${(e as Error).message}`)
    } finally {
      clearState()
      logger.debug(LogModule.SYSTEM, '清理完成')
    }
  })
}

/**
 * 断开指定的连接集合
 */
async function stopOwnedConnections(
  connections: Map<number, ImapConnection>,
  logger: MailManagerLogger
): Promise<void> {
  const count = connections.size
  if (count === 0) {
    logger.debug(LogModule.SYSTEM, '无活跃连接')
    return
  }

  logger.debug(LogModule.SYSTEM, `断开 ${count} 个连接...`)

  for (const [accountId, connection] of connections.entries()) {
    try {
      await connection.disconnect()
      activeConnections.delete(accountId)
    } catch (e) {
      logger.warn(LogModule.SYSTEM, `账号 #${accountId} 断开失败`)
    }
  }
}

// ============ 重新导出 ============

// 状态管理
export {
  getContext,
  getConfig,
  getLogger,
  getMailRenderer,
  invalidateRulesCache,
} from './state'

// 账户管理
export {
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  testConnection,
  connectAccount,
  disconnectAccount,
  updateAccountStatus,
} from './accounts'

// 邮件管理
export {
  getMails,
  getMail,
  deleteMail,
  batchDeleteMails,
  markAsRead,
  markAsForwarded,
  syncAccountMails,
  createMail,
} from './mails'

// 规则管理
export {
  getRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  testRule,
  matchConditions,
  matchRule,
  getMatchingRules,
  checkSingleCondition,
  safeRegexTest,
  getForwardPreview,
  getAvailableTargets,
  findMatchingRule,
} from './rules'
export type { RuleTestResult } from './rules'

// 转发功能
export {
  handleNewMail,
  forwardMail,
  executeForward,
  broadcastToTargets,
  processAutoForwardingAsync,
  startAllConnections,
  stopAllConnections,
} from './forward'
export type { ForwardResult } from './forward'

// ============ 类型重新导出 ============

export type {
  MailAccount,
  StoredMail,
  ForwardRule,
  ForwardCondition,
  ForwardTarget,
  ForwardPreviewRequest,
  ForwardPreviewResponse,
  MailAccountStatus,
  RuleMatchStrategy,
  ConditionLogic,
  FailureStrategy,
} from '../types'
