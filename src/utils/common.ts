/**
 * 通用工具函数模块
 *
 * 提供与业务无关的纯函数工具
 */

/**
 * 异步休眠
 * @param ms 毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 将数组分割成固定大小的块
 * @param array 原数组
 * @param size 每块的大小
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * 带超时的 Promise 包装器
 * @param promise 原始 Promise
 * @param timeoutMs 超时时间(毫秒)
 * @param fallback 超时后返回的值
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), timeoutMs))
  ])
}

/**
 * 生成随机 ID
 * @param prefix 可选前缀
 */
export function generateRandomId(prefix?: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).substring(7)}`
  return prefix ? `${prefix}-${id}` : id
}

/**
 * 格式化字符串模板
 * 将 %s 和 %d 占位符替换为对应参数
 * @param template 模板字符串
 * @param args 参数列表
 */
export function formatString(template: string, args: any[]): string {
  if (args.length === 0) return template
  let result = template
  for (const arg of args) {
    result = result.replace(/%[sd]/, String(arg))
  }
  return result
}

/**
 * 安全地执行异步操作，捕获错误并返回 null
 * @param fn 异步函数
 * @param onError 可选的错误处理回调
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  onError?: (err: Error) => void
): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    onError?.(err as Error)
    return null
  }
}

/**
 * 创建带有最大尝试次数的重试包装器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      onRetry?.(attempt, lastError)

      if (attempt < maxAttempts) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}
