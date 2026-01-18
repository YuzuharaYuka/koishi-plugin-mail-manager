/**
 * 错误处理工具模块
 *
 * 提供 IMAP 连接相关的错误匹配和友好错误消息转换
 */

/**
 * 错误匹配规则接口
 */
export interface ErrorMatcher {
  /** 匹配模式（正则或字符串） */
  pattern: RegExp | string
  /** 友好的错误提示 */
  message: string
  /** 是否应该重试 */
  retryable: boolean
}

/**
 * 用户友好的错误消息映射表
 * 将技术错误转换为易于理解的中文提示
 */
export const USER_FRIENDLY_ERRORS: Record<string, string> = {
  'ENOTFOUND': '无法找到邮件服务器，请检查服务器地址是否正确',
  'ECONNREFUSED': '服务器拒绝连接，请检查端口配置',
  'ETIMEDOUT': '连接超时，请检查网络或尝试使用代理',
  'ECONNRESET': '连接被重置，请稍后重试',
  'ENETUNREACH': '网络不可达，请检查网络连接',
  'authentication failed': '登录失败，请检查邮箱密码或授权码',
  'Invalid credentials': '认证失败，请检查账号密码',
  'AUTHENTICATIONFAILED': '认证失败，部分邮箱需要使用专用授权码',
  'certificate': 'SSL证书验证失败，请尝试关闭TLS或检查服务器配置',
  'SSL': 'SSL连接错误，请检查TLS设置',
  'TLS': 'TLS连接错误，请检查加密设置',
  'too many': '请求过于频繁，请稍后再试',
  'rate limit': '已达到请求限制，请稍后再试',
  'mailbox not found': '收件箱未找到，请检查邮箱配置',
  'LOGIN disabled': '登录被禁用，请检查是否需要开启IMAP访问',
}

/**
 * 根据错误消息获取用户友好的提示
 */
export function getUserFriendlyError(errorMessage: string): string {
  const lowerMsg = errorMessage.toLowerCase()

  for (const [key, friendlyMsg] of Object.entries(USER_FRIENDLY_ERRORS)) {
    if (lowerMsg.includes(key.toLowerCase())) {
      return friendlyMsg
    }
  }

  return errorMessage
}

/**
 * 通用 IMAP 错误匹配规则
 * 按照优先级排序，越靠前的规则越优先匹配
 */
export const COMMON_ERROR_MATCHERS: ErrorMatcher[] = [
  {
    pattern: /ENOTFOUND|getaddrinfo/,
    message: '无法解析服务器地址。请检查：1) 服务器地址是否正确；2) 网络连接；3) DNS 设置。',
    retryable: true,
  },
  {
    pattern: 'ECONNREFUSED',
    message: '服务器拒绝连接。请检查端口是否正确，或服务器是否运行。',
    retryable: true,
  },
  {
    pattern: /ETIMEDOUT|timeout/i,
    message: '连接超时。请检查网络连接或服务器状态。',
    retryable: true,
  },
  {
    pattern: /Invalid credentials|authentication failed|AUTHENTICATIONFAILED/i,
    message: '认证失败。请检查账号密码。注意：部分邮箱需使用专用授权码。',
    retryable: false,
  },
  {
    pattern: /SSL|TLS|certificate/i,
    message: 'SSL/TLS 连接错误。请检查 TLS 设置或证书。',
    retryable: false,
  },
  {
    pattern: /ENETUNREACH|network/i,
    message: '网络不可达。请检查网络连接。',
    retryable: true,
  },
  {
    pattern: /too many|rate limit/i,
    message: '请求过于频繁，请稍后再试。',
    retryable: true,
  },
]

/**
 * 匹配错误信息
 * @param error 错误对象
 * @param matchers 错误匹配规则列表
 * @returns 匹配的规则，如果没有匹配则返回 null
 */
export function matchError(error: Error, matchers: ErrorMatcher[]): ErrorMatcher | null {
  const msg = error.message || String(error)

  for (const matcher of matchers) {
    const isMatch = typeof matcher.pattern === 'string'
      ? msg.includes(matcher.pattern)
      : matcher.pattern.test(msg)

    if (isMatch) {
      return matcher
    }
  }

  return null
}

/**
 * 获取用户友好的错误提示
 * @param error 错误对象
 * @param host 服务器主机名（用于上下文信息）
 * @param customMatchers 自定义的错误匹配规则（可选）
 */
export function getFriendlyErrorMessage(
  error: Error,
  host?: string,
  customMatchers?: ErrorMatcher[]
): string {
  const matchers = customMatchers
    ? [...customMatchers, ...COMMON_ERROR_MATCHERS]
    : COMMON_ERROR_MATCHERS

  const matched = matchError(error, matchers)

  if (matched) {
    return matched.message
  }

  return error.message || String(error)
}

/**
 * 判断错误是否应该触发重试
 * @param error 错误对象
 * @param customMatchers 自定义的错误匹配规则（可选）
 */
export function isRetryableError(error: Error, customMatchers?: ErrorMatcher[]): boolean {
  const matchers = customMatchers
    ? [...customMatchers, ...COMMON_ERROR_MATCHERS]
    : COMMON_ERROR_MATCHERS

  const matched = matchError(error, matchers)

  // 如果匹配到规则，使用规则的 retryable 属性
  // 如果没有匹配到，默认认为可以重试（未知错误可能是临时性的）
  return matched ? matched.retryable : true
}

/**
 * 创建带有上下文的错误
 */
export class ImapConnectionError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly email: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'ImapConnectionError'
  }

  /**
   * 获取友好的错误消息
   */
  getFriendlyMessage(): string {
    return getFriendlyErrorMessage(this.cause || this, this.host)
  }
}
