/**
 * 核心模块入口
 *
 * 统一导出所有核心功能，提供初始化接口
 */

import type { Context } from 'koishi'
import type { Config } from '../config'
import { MailManagerLogger, createLogger } from '../logger'
import { MailRenderer } from '../render'
import { initState, clearState } from './state'
import { registerRulesCacheListener } from './rules'
import { startAllConnections, stopAllConnections } from './forward'

// ============ 初始化 ============

export async function initCore(ctx: Context, config: Config): Promise<void> {
  const logger = createLogger(ctx)
  const mailRenderer = new MailRenderer(ctx)

  initState(ctx, config, logger, mailRenderer)

  // 注册规则缓存监听器（用于多实例同步）
  registerRulesCacheListener()

  // 启动已启用账户的连接
  await startAllConnections()

  // 注册清理回调
  ctx.on('dispose', async () => {
    await stopAllConnections()
    clearState()
  })
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
