/**
 * 邮件管理器类型定义文件
 *
 * 本文件包含了插件核心的领域模型、数据传输对象(DTO)以及模块扩展定义。
 * 遵循 Clean Code 原则，强调代码的可读性与自解释性。
 */

import { Context } from 'koishi'

// 重新导出配置类型，保持模块对外接口的统一性
export type { Config } from './config'

// ============================================================================
// 1. 基础枚举与联合类型 (Enums & Union Types)
// ============================================================================

/**
 * 邮箱账号的连接状态
 *
 * - `connected`: 已成功连接到服务器
 * - `connecting`: 正在尝试建立连接
 * - `disconnected`: 连接已断开（主动或被动）
 * - `error`: 连接发生错误（如认证失败、网络超时）
 */
export type MailAccountStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

/**
 * 转发模式
 *
 * - `text`: 纯文本模式 - 将邮件内容转换为纯文本格式发送，可筛选元素
 * - `image`: 图片模式 - 将邮件原始 HTML 内容渲染为图片，保持原格式
 * - `hybrid`: 混合模式 - 摘要信息用文本，正文渲染为图片
 */
export type ForwardMode = 'text' | 'image' | 'hybrid'

/**
 * 转发消息中包含的元素类型
 *
 * 用于定义转发消息的构成部分，如标题、发件人、正文等。
 */
export type ForwardElementType =
  | 'subject'      // 邮件主题
  | 'from'         // 发件人信息
  | 'to'           // 收件人信息
  | 'date'         // 接收日期
  | 'body'         // 邮件正文（自动选择最佳格式）
  | 'attachments'  // 附件列表
  | 'separator'    // 分隔线
  | 'custom'       // 自定义模板内容
  // 以下类型保留用于向后兼容，已废弃
  | 'text'         // @deprecated 使用 body + text 模式代替
  | 'html'         // @deprecated 使用 body + image 模式代替
  | 'markdown'     // @deprecated 使用 body + image 模式代替

/**
 * 转发规则的匹配条件类型
 *
 * 格式通常为 `{字段}_{操作}`，用于指定过滤逻辑。
 */
export type ConditionType =
  | 'subject_contains' // 主题包含特定文本
  | 'subject_regex'    // 主题匹配正则表达式
  | 'from_contains'    // 发件人包含特定文本
  | 'from_regex'       // 发件人匹配正则表达式
  | 'to_contains'      // 收件人包含特定文本
  | 'body_contains'    // 正文包含特定文本
  | 'body_regex'       // 正文匹配正则表达式
  | 'all'              // 匹配所有邮件（无条件）

/**
 * 规则匹配策略
 *
 * - `first-match`: 匹配第一个符合条件的规则后停止（默认）
 * - `all-match`: 匹配所有符合条件的规则并依次执行
 */
export type RuleMatchStrategy = 'first-match' | 'all-match'

/**
 * 条件组合逻辑
 *
 * - `and`: 所有条件必须同时满足（默认）
 * - `or`: 满足任一条件即可
 */
export type ConditionLogic = 'and' | 'or'

/**
 * 转发失败处理策略
 *
 * - `mark-partial`: 部分成功也标记为已转发（默认）
 * - `require-all`: 所有目标成功才标记为已转发
 * - `retry-failed`: 记录失败目标，后续可重试
 */
export type FailureStrategy = 'mark-partial' | 'require-all' | 'retry-failed'

// ============================================================================
// 2. 核心领域模型 (Domain Models)
// ============================================================================

/**
 * 邮箱账号实体
 *
 * 代表一个配置好的 IMAP 邮箱账号，用于接收邮件。
 * 对应数据库表: `mail_manager.accounts`
 */
export interface MailAccount {
  /** 唯一标识符 (自增主键) */
  id: number

  /** 账号别名（用于在界面上区分不同账号，如 "工作邮箱"） */
  name: string

  /** 邮箱地址 (e.g., "user@example.com") */
  email: string

  /**
   * 登录凭证
   *
   * 通常是密码或应用专用授权码。
   * @security 建议在存储前进行加密处理。
   */
  password: string

  /** IMAP 服务器主机名 (e.g., "imap.gmail.com") */
  imapHost: string

  /** IMAP 服务器端口 (通常为 993 或 143) */
  imapPort: number

  /** 是否启用 TLS 加密连接 */
  imapTls: boolean

  /**
   * 是否发送 IMAP ID 命令
   *
   * 部分服务商（如网易 163/126）可能需要此命令来避免连接被拒，
   * 但在其他服务商上可能会导致兼容性问题。
   */
  sendImapId?: boolean

  /**
   * 代理服务器 URL（可选）
   *
   * 格式：http://host:port 或 socks5://host:port
   * 留空则使用全局代理设置。
   * 某些邮件服务（如 Gmail）在中国大陆需要代理访问。
   */
  proxyUrl?: string

  /** 账号当前的全局启用状态 */
  enabled: boolean

  /** 当前的连接状态（运行时状态，非持久化字段） */
  status: MailAccountStatus

  /** 最近一次发生的错误信息（用于调试和状态展示） */
  lastError?: string

  /** 记录创建时间 */
  createdAt: Date

  /** 记录最后更新时间 */
  updatedAt: Date
}

/**
 * 邮件消息实体
 *
 * 代表一封已存储在本地数据库中的邮件。
 * 对应数据库表: `mail_manager.mails`
 */
export interface StoredMail {
  /** 本地存储 ID (自增主键) */
  id: number

  /** 所属邮箱账号 ID */
  accountId: number

  /**
   * 服务器端的邮件唯一标识 (Message-ID)
   * 用于去重和引用。
   */
  messageId: string

  /** 发件人信息 */
  from: MailAddress

  /** 收件人列表 */
  to: MailAddress[]

  /** 抄送 (CC) 列表 */
  cc?: MailAddress[]

  /** 邮件主题 */
  subject: string

  /**
   * 邮件纯文本内容
   * 用于快速预览或文本匹配。
   */
  textContent?: string

  /**
   * 邮件 HTML 内容
   * 用于完整渲染或生成图片。
   */
  htmlContent?: string

  /**
   * 附件列表
   *
   * 注意：如果包含 Base64 内容，可能会占用较大存储空间。
   */
  attachments: MailAttachment[]

  /** 邮件接收时间（服务器时间） */
  receivedAt: Date

  /** 阅读状态标记 */
  isRead: boolean

  /** 转发状态标记 */
  isForwarded: boolean

  /** 最近一次转发的时间 */
  forwardedAt?: Date

  /** 本地入库时间 */
  createdAt: Date
}

/**
 * 转发规则实体
 *
 * 定义了如何筛选邮件以及将其转发到何处。
 * 对应数据库表: `mail_manager.rules`
 */
export interface ForwardRule {
  /** 规则 ID (自增主键) */
  id: number

  /** 规则名称 */
  name: string

  /** 规则描述/备注 */
  description?: string

  /** 规则启用状态 */
  enabled: boolean

  /**
   * 规则优先级 (数值越小优先级越高)
   * 默认为 100，用于控制规则匹配顺序
   */
  priority: number

  /**
   * 关联的邮箱账号 ID
   *
   * - 指定 ID: 仅对该账号生效
   * - `null` 或 `undefined`: 对所有账号生效
   */
  accountId?: number

  /**
   * 条件组合逻辑
   * - `and`: 所有条件必须满足（默认）
   * - `or`: 满足任一条件即可
   */
  conditionLogic: ConditionLogic

  /**
   * 匹配条件列表
   *
   * 根据 conditionLogic 决定是 AND 还是 OR 逻辑
   */
  conditions: ForwardCondition[]

  /** 转发目标列表（发送到哪些平台/群组） */
  targets: ForwardTarget[]

  /**
   * 转发模式
   * - `text`: 纯文本模式，按元素筛选发送文字消息
   * - `image`: 图片模式，将邮件原始 HTML 渲染为图片
   * - `hybrid`: 混合模式，摘要文本 + 正文图片
   *
   * 如未设置，默认为 `text` 以向后兼容。
   */
  forwardMode?: ForwardMode

  /**
   * 转发内容构成（仅在 text/hybrid 模式下使用）
   * 定义了转发消息中包含哪些元素以及它们的顺序。
   */
  elements: ForwardElement[]

  /**
   * 正则内容提取配置（仅在 text 模式下使用）
   * 用于从邮件正文中提取特定内容
   */
  regexConfig?: RegexConfig

  /**
   * 自定义 CSS 样式
   * 用于 image/hybrid 模式下的 HTML 渲染。
   */
  customCss?: string

  /** 图片渲染配置 */
  renderConfig: RenderConfig

  /**
   * 转发失败处理策略
   * 默认为 'mark-partial'
   */
  failureStrategy: FailureStrategy

  /**
   * 转发延迟（毫秒）
   * 用于避免过快发送导致的限流问题
   * 默认为 0（立即发送）
   */
  delayMs: number

  /**
   * 防止重复转发同一邮件
   * 如果邮件已被此规则转发过，则跳过
   * 默认为 true
   */
  skipForwarded: boolean

  /**
   * 失败重试次数
   * 默认为 0（不重试）
   */
  retryCount: number

  /**
   * 重试间隔（毫秒）
   * 默认为 5000
   */
  retryIntervalMs: number

  /** 创建时间 */
  createdAt: Date

  /** 更新时间 */
  updatedAt: Date
}

/**
 * 正则内容提取配置
 */
export interface RegexConfig {
  /** 正则表达式模式 */
  pattern: string
  /** 正则标志 (i, g, gi 等) */
  flags?: string
  /** 输出模板，使用 $1, $2 等引用捕获组 */
  template?: string
}

// ============================================================================
// 3. 值对象与组件 (Value Objects & Components)
// ============================================================================

/** 邮件地址信息 */
export interface MailAddress {
  /** 显示名称 (e.g., "GitHub Notification") */
  name?: string
  /** 实际邮箱地址 (e.g., "noreply@github.com") */
  address: string
}

/** 邮件附件信息 */
export interface MailAttachment {
  /** 文件名 */
  filename: string
  /** MIME 类型 (e.g., "image/png") */
  contentType: string
  /** 文件大小 (字节) */
  size: number
  /**
   * 文件内容 (Base64 编码)
   * 仅在需要持久化存储小文件时使用。
   */
  content?: string
  /** Content-ID，用于 HTML 内嵌图片引用 */
  cid?: string
}

/** 转发内容元素配置 */
export interface ForwardElement {
  /** 元素类型 */
  type: ForwardElementType
  /** 是否启用该元素 */
  enabled: boolean
  /** 自定义显示标签（例如将 "From" 显示为 "发件人："） */
  label?: string
  /** 自定义模板字符串（仅当 type 为 'custom' 时有效） */
  template?: string
  /** 排序权重（数值越小越靠前） */
  order: number
}

/** 转发匹配条件 */
export interface ForwardCondition {
  /** 匹配类型 */
  type: ConditionType
  /** 匹配值（关键词或正则表达式） */
  value: string
  /** 是否取反（即“不包含”或“不匹配”） */
  negate?: boolean
}

/** 转发目标配置 */
export interface ForwardTarget {
  /** 目标平台 (e.g., "onebot", "discord") */
  platform: string
  /** 机器人自身的 ID (用于多账号区分) */
  selfId: string
  /** 目标频道或群组 ID */
  channelId: string
  /** 目标显示名称（用于 UI 展示，非逻辑字段） */
  displayName?: string
}

/** 图片渲染配置参数 */
export interface RenderConfig {
  /** 图片最大宽度 (px) */
  imageWidth: number
  /** 背景颜色 (CSS 颜色值) */
  backgroundColor: string
  /** 文本颜色 (CSS 颜色值) */
  textColor: string
  /** 基础字体大小 (px) */
  fontSize: number
  /** 内边距 (px) */
  padding: number
  /** 是否显示外边框 */
  showBorder: boolean
  /** 边框颜色 (CSS 颜色值) */
  borderColor: string
}

// ============================================================================
// 4. 数据传输对象 (DTOs) - 请求与响应
// ============================================================================

/** 创建邮箱账号请求参数 */
export interface CreateMailAccountRequest {
  name: string
  email: string
  password: string
  imapHost: string
  imapPort?: number
  imapTls?: boolean
  proxyUrl?: string
  enabled?: boolean
}

/** 更新邮箱账号请求参数 */
export interface UpdateMailAccountRequest {
  name?: string
  email?: string
  password?: string
  imapHost?: string
  imapPort?: number
  imapTls?: boolean
  proxyUrl?: string
  enabled?: boolean
  sendImapId?: boolean
}

/** 邮件列表查询参数 */
export interface MailListQuery {
  accountId?: number
  page?: number
  pageSize?: number
  isRead?: boolean
  isForwarded?: boolean
  keyword?: string
  startDate?: string
  endDate?: string
}

/** 通用分页响应结构 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** 转发效果预览请求 */
export interface ForwardPreviewRequest {
  /** 目标邮件 ID */
  mailId: number
  /** 使用的规则 ID（可选，若不提供则使用默认或临时配置） */
  ruleId?: number
  /** 临时覆盖的转发模式 */
  forwardMode?: ForwardMode
  /** 临时覆盖的元素配置 */
  elements?: ForwardElement[]
  /** 临时覆盖的 CSS */
  customCss?: string
  /** 临时覆盖的渲染配置 */
  renderConfig?: Partial<RenderConfig>
}

/** 转发效果预览响应 */
export interface ForwardPreviewResponse {
  /** 纯文本格式预览 */
  textPreview: string
  /** HTML 格式预览 */
  htmlPreview: string
  /** 图片格式预览 (Base64) */
  imagePreview?: string
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  /** 测试是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
  /** 详细连接信息（仅在成功时提供） */
  details?: {
    host: string
    port: number
    tls: boolean
    mailboxCount?: number
  }
}

// ============================================================================
// 5. 模块扩展 (Module Augmentation)
// ============================================================================

declare module 'koishi' {
  interface Tables {
    'mail_manager.accounts': MailAccount
    'mail_manager.mails': StoredMail
    'mail_manager.rules': ForwardRule
  }
}

/** 规则测试结果 */
export interface RuleTestResult {
  /** 是否匹配成功 */
  matched: boolean
  /** 匹配成功的条件描述列表 */
  matchedConditions: string[]
  /** 匹配失败的条件描述列表 */
  unmatchedConditions: string[]
  /** 预览内容（仅在匹配成功时提供） */
  previewContent?: ForwardPreviewResponse
}

/** 规则导出数据结构 */
export interface RuleExport {
  /** 导出格式版本 */
  version: string
  /** 导出时间 */
  exportedAt: string
  /** 规则列表 */
  rules: Partial<ForwardRule>[]
}

/** 规则导入结果 */
export interface RuleImportResult {
  /** 成功导入的规则数量 */
  imported: number
  /** 跳过的规则数量（重复或无效） */
  skipped: number
}

declare module '@koishijs/plugin-console' {
  interface Events {
    // --- 账号管理 ---
    'mail-manager/accounts/list'(): Promise<MailAccount[]>
    'mail-manager/accounts/get'(id: number): Promise<MailAccount | null>
    'mail-manager/accounts/create'(data: CreateMailAccountRequest): Promise<MailAccount>
    'mail-manager/accounts/update'(id: number, data: UpdateMailAccountRequest): Promise<MailAccount>
    'mail-manager/accounts/delete'(id: number): Promise<void>
    'mail-manager/accounts/test'(id: number): Promise<ConnectionTestResult>
    'mail-manager/accounts/connect'(id: number): Promise<void>
    'mail-manager/accounts/disconnect'(id: number): Promise<void>
    'mail-manager/accounts/sync'(id: number, days?: number): Promise<{ total: number; new: number; existing: number }>

    // --- 邮件管理 ---
    'mail-manager/mails/list'(query: MailListQuery): Promise<PaginatedResponse<StoredMail>>
    'mail-manager/mails/get'(id: number): Promise<StoredMail | null>
    'mail-manager/mails/delete'(id: number): Promise<void>
    'mail-manager/mails/read'(id: number): Promise<void>
    'mail-manager/mails/forward'(mailId: number, ruleId?: number): Promise<void>
    'mail-manager/mails/batch-delete'(accountId?: number, days?: number): Promise<{ deleted: number }>

    // --- 规则管理 ---
    'mail-manager/rules/list'(): Promise<ForwardRule[]>
    'mail-manager/rules/get'(id: number): Promise<ForwardRule | null>
    'mail-manager/rules/create'(data: Partial<ForwardRule>): Promise<ForwardRule>
    'mail-manager/rules/update'(id: number, data: Partial<ForwardRule>): Promise<ForwardRule>
    'mail-manager/rules/delete'(id: number): Promise<void>
    'mail-manager/rules/test'(ruleId: number, mailId: number): Promise<RuleTestResult>
    'mail-manager/rules/export'(): Promise<RuleExport>
    'mail-manager/rules/import'(data: RuleExport): Promise<RuleImportResult>

    // --- 其他功能 ---
    'mail-manager/preview'(request: ForwardPreviewRequest): Promise<ForwardPreviewResponse>
    'mail-manager/targets'(): Promise<ForwardTarget[]>
    'mail-manager/stats'(): Promise<{
      accountCount: number
      connectedCount: number
      mailCount: number
      unreadCount: number
      ruleCount: number
      enabledRuleCount: number
    }>

    // --- 清理功能 ---
    'mail-manager/cleanup/expired'(dryRun?: boolean): Promise<{ dryRun: boolean; count: number; cutoffDate: string }>
    'mail-manager/cleanup/all'(confirm?: boolean): Promise<{ needConfirm: boolean; count: number }>

    // --- 健康监控 ---
    'mail-manager/health'(): Promise<{
      status: 'healthy' | 'degraded'
      timestamp: string
      accounts: { total: number; connected: number; error: number; errorDetails: any[] }
      memory: { heapUsed: number; heapTotal: number; rss: number; external: number }
      uptime: number
    }>
    'mail-manager/metrics'(): Promise<{
      timestamp: string
      accounts: { total: number; byStatus: Record<string, number> }
      mails: { total: number; last24h: number; forwardedLast24h: number }
      rules: { total: number; enabled: number }
      memory: { heapUsedMB: number; rssMB: number }
    }>
  }
}
