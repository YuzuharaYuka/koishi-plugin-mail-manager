/**
 * 邮件管理插件 - API 封装
 */

import { send } from '@koishijs/client'
import type {
  MailAccount,
  StoredMail,
  ForwardRule,
  ForwardElement,
  ForwardTarget,
  RenderConfig,
  PaginatedResponse,
  ForwardPreviewResponse,
  ConnectionTestResult,
  Stats,
} from './types'

/** 通用 API 调用封装 */
function call<T>(event: string, ...args: unknown[]): Promise<T> {
  // @ts-ignore - send 函数的类型声明不完整，但实际可以传递多个参数
  return send(event, ...args) as Promise<T>
}

// ============ 账号 API ============

export const accountApi = {
  /** 获取所有账号 */
  list: () => call<MailAccount[]>('mail-manager/accounts/list'),

  /** 获取单个账号 */
  get: (id: number) => call<MailAccount>('mail-manager/accounts/get', id),

  /** 创建账号 */
  create: (data: Partial<MailAccount>) => call<MailAccount>('mail-manager/accounts/create', data),

  /** 更新账号 */
  update: (id: number, data: Partial<MailAccount>) =>
    call<MailAccount>('mail-manager/accounts/update', id, data),

  /** 删除账号 */
  delete: (id: number) => call<void>('mail-manager/accounts/delete', id),

  /** 测试连接 */
  test: (id: number) => call<ConnectionTestResult>('mail-manager/accounts/test', id),

  /** 连接账号 */
  connect: (id: number) => call<void>('mail-manager/accounts/connect', id),

  /** 断开账号 */
  disconnect: (id: number) => call<void>('mail-manager/accounts/disconnect', id),

  /** 同步邮件 */
  sync: (id: number, days?: number) =>
    call<{ total: number; new: number; existing: number }>('mail-manager/accounts/sync', id, days),
}

// ============ 邮件 API ============

export interface MailListParams {
  accountId?: number
  page?: number
  pageSize?: number
  isRead?: boolean
  isForwarded?: boolean
  keyword?: string
  startDate?: string
  endDate?: string
}

export const mailApi = {
  /** 获取邮件列表 */
  list: (params: MailListParams = {}) =>
    call<PaginatedResponse<StoredMail>>('mail-manager/mails/list', params),

  /** 获取邮件详情 */
  get: (id: number) => call<StoredMail>('mail-manager/mails/get', id),

  /** 删除邮件 */
  delete: (id: number) => call<void>('mail-manager/mails/delete', id),

  /** 标记已读 */
  markAsRead: (id: number) => call<void>('mail-manager/mails/read', id),

  /** 手动转发 */
  forward: (mailId: number, ruleId?: number) =>
    call<void>('mail-manager/mails/forward', mailId, ruleId),

  /** 批量删除邮件 */
  batchDelete: (accountId?: number, days?: number) =>
    call<{ deleted: number }>('mail-manager/mails/batch-delete', accountId, days),
}

// ============ 规则 API ============

export const ruleApi = {
  /** 获取所有规则 */
  list: () => call<ForwardRule[]>('mail-manager/rules/list'),

  /** 获取规则详情 */
  get: (id: number) => call<ForwardRule>('mail-manager/rules/get', id),

  /** 创建规则 */
  create: (data: Partial<ForwardRule>) => call<ForwardRule>('mail-manager/rules/create', data),

  /** 更新规则 */
  update: (id: number, data: Partial<ForwardRule>) =>
    call<ForwardRule>('mail-manager/rules/update', id, data),

  /** 删除规则 */
  delete: (id: number) => call<void>('mail-manager/rules/delete', id),
}

// ============ 预览 API ============

export interface PreviewParams {
  mailId: number
  ruleId?: number
  elements?: ForwardElement[]
  customCss?: string
  renderConfig?: Partial<RenderConfig>
}

export const previewApi = {
  /** 获取转发预览 */
  generate: (params: PreviewParams) =>
    call<ForwardPreviewResponse>('mail-manager/preview', params),
}

// ============ 其他 API ============

export const commonApi = {
  /** 获取可用转发目标 */
  getTargets: () => call<ForwardTarget[]>('mail-manager/targets'),

  /** 获取统计信息 */
  getStats: () => call<Stats>('mail-manager/stats'),
}
