/**
 * 邮件监听插件 - 前端类型定义
 */

/** 邮箱账号状态 */
export type MailAccountStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

/** 邮箱账号 */
export interface MailAccount {
  id: number
  name: string
  email: string
  password: string
  imapHost: string
  imapPort: number
  imapTls: boolean
  /** 是否发送 IMAP ID 命令（部分邮件服务商如网易需要） */
  sendImapId?: boolean
  enabled: boolean
  proxyUrl?: string
  status: MailAccountStatus
  lastError?: string
  createdAt: string
  updatedAt: string
}

/** 邮件地址 */
export interface MailAddress {
  name?: string
  address: string
}

/** 邮件附件 */
export interface MailAttachment {
  filename: string
  contentType: string
  size: number
  content?: string
  cid?: string
}

/** 存储的邮件 */
export interface StoredMail {
  id: number
  accountId: number
  messageId: string
  from: MailAddress
  to: MailAddress[]
  cc?: MailAddress[]
  subject: string
  textContent?: string
  htmlContent?: string
  attachments: MailAttachment[]
  receivedAt: string
  isRead: boolean
  isForwarded: boolean
  forwardedAt?: string
  createdAt: string
}

/** 转发元素类型 */
export type ForwardElementType =
  | 'subject'
  | 'from'
  | 'to'
  | 'date'
  | 'body'
  | 'text'
  | 'html'
  | 'markdown'
  | 'attachments'
  | 'separator'
  | 'custom'

/** 转发模式 */
export type ForwardMode = 'text' | 'image' | 'hybrid'

/** 转发元素配置 */
export interface ForwardElement {
  type: ForwardElementType
  enabled: boolean
  label?: string
  template?: string
  order: number
}

/** 匹配条件类型 */
export type ConditionType =
  | 'subject_contains'
  | 'subject_regex'
  | 'from_contains'
  | 'from_regex'
  | 'to_contains'
  | 'body_contains'
  | 'body_regex'
  | 'all'

/** 匹配条件 */
export interface ForwardCondition {
  type: ConditionType
  value: string
  negate?: boolean
}

/** 转发目标 */
export interface ForwardTarget {
  platform: string
  selfId: string
  channelId: string
  displayName?: string
}

/** 渲染配置 */
export interface RenderConfig {
  imageWidth: number
  backgroundColor: string
  textColor: string
  fontSize: number
  padding: number
  showBorder: boolean
  borderColor: string
}

/** 正则内容提取配置 */
export interface RegexConfig {
  /** 正则表达式模式 */
  pattern: string
  /** 正则标志 (i, g, gi 等) */
  flags?: string
  /** 输出模板，使用 $1, $2 等引用捕获组 */
  template?: string
}

/** 转发规则 */
export interface ForwardRule {
  id: number
  name: string
  description?: string
  enabled: boolean
  accountId?: number
  conditions: ForwardCondition[]
  targets: ForwardTarget[]
  forwardMode?: ForwardMode
  elements: ForwardElement[]
  regexConfig?: RegexConfig
  customCss?: string
  renderConfig: RenderConfig
  createdAt: string
  updatedAt: string
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** 转发预览响应 */
export interface ForwardPreviewResponse {
  textPreview: string
  htmlPreview: string
  imagePreview?: string
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  success: boolean
  message: string
  details?: {
    host: string
    port: number
    tls: boolean
    mailboxCount?: number
  }
}

/** 统计信息 */
export interface Stats {
  accountCount: number
  connectedCount: number
  mailCount: number
  unreadCount: number
  ruleCount: number
  enabledRuleCount: number
}

/** 转发结果 */
export interface ForwardResult {
  /** 是否全部成功 */
  success: boolean
  /** 成功发送的目标数量 */
  successCount: number
  /** 总目标数量 */
  totalTargets: number
  /** 错误消息列表 */
  errors?: string[]
}
