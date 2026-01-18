/**
 * 核心模块重新导出
 *
 * 此文件保持向后兼容性，将所有功能重新导出自 ./core/ 模块。
 * 新代码应直接从 './core' 或 './core/index' 导入。
 *
 * @deprecated 优先使用 './core' 直接导入
 */

// 从新的模块化核心重新导出所有功能
export {
  // 初始化
  initCore,

  // 状态管理
  getContext,
  getConfig,
  getLogger,
  getMailRenderer,
  invalidateRulesCache,

  // 账户管理
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  testConnection,
  connectAccount,
  disconnectAccount,
  updateAccountStatus,

  // 邮件管理
  getMails,
  getMail,
  deleteMail,
  batchDeleteMails,
  markAsRead,
  markAsForwarded,
  syncAccountMails,
  createMail,

  // 规则管理
  getRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  testRule,
  matchConditions,
  checkSingleCondition,
  safeRegexTest,
  getForwardPreview,
  getAvailableTargets,
  findMatchingRule,

  // 转发功能
  handleNewMail,
  forwardMail,
  executeForward,
  broadcastToTargets,
  processAutoForwardingAsync,
  startAllConnections,
  stopAllConnections,
} from './core/index'

// 类型重新导出
export type {
  MailAccount,
  StoredMail,
  ForwardRule,
  ForwardCondition,
  ForwardTarget,
  ForwardPreviewRequest,
  ForwardPreviewResponse,
  MailAccountStatus,
  RuleTestResult,
  ForwardResult,
} from './core/index'

// 从 logger 导出 setDebugMode 以保持向后兼容
export { setDebugMode } from './logger'
