/**
 * 高性能邮件解析适配器
 *
 * 策略：
 * 1. 优先使用 postal-mime（快速路径，速度提升 10-20 倍）
 * 2. 遇到错误时回退到 mailparser（兼容性路径）
 */

import PostalMime from 'postal-mime'
import { simpleParser, ParsedMail as MailparserParsedMail } from 'mailparser'
import { Logger } from 'koishi'
import type { MailAddress, MailAttachment } from './types'

const logger = new Logger('mail-manager/parser')

/** 统一的邮件解析接口 */
export interface ParsedMail {
  messageId?: string
  date?: Date
  subject?: string
  from?: MailAddress
  to?: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  replyTo?: MailAddress[]
  text?: string
  html?: string
  attachments?: MailAttachment[]
}

/** 解析统计 */
const stats = {
  postalMimeSuccess: 0,
  postalMimeFailed: 0,
  mailparserFallback: 0,
}

/**
 * 混合邮件解析器
 *
 * @param source 邮件原始数据
 * @returns 解析后的邮件对象
 */
export async function parseMail(source: Buffer | Uint8Array): Promise<ParsedMail> {
  // 快速路径：postal-mime（处理 80% 的常规邮件）
  try {
    const result = await parseWithPostalMime(source)
    stats.postalMimeSuccess++
    return result
  } catch (err) {
    // 回退路径：mailparser（处理特殊编码、复杂结构）
    logger.warn('postal-mime 解析失败，回退到 mailparser: %s', (err as Error)?.message || String(err))
    stats.postalMimeFailed++
    stats.mailparserFallback++
    return await parseWithMailparser(source)
  }
}

/**
 * 解析邮件日期字符串
 * 支持多种常见日期格式，增强兼容性
 *
 * @param dateStr 原始日期字符串
 * @returns 解析后的 Date 对象，解析失败返回 undefined
 */
export function parseMailDate(dateStr: string | undefined | null): Date | undefined {
  if (!dateStr || typeof dateStr !== 'string') return undefined

  const trimmed = dateStr.trim()
  if (trimmed.length === 0) return undefined

  // 首先尝试原生 Date 解析
  let date = new Date(trimmed)
  if (!isNaN(date.getTime())) {
    return date
  }

  // 尝试常见的非标准格式
  const patterns: Array<{ regex: RegExp; parser: (match: RegExpMatchArray) => Date | null }> = [
    // RFC 2822: "Mon, 01 Jan 2024 12:00:00 +0800"
    {
      regex: /^\w{3},\s*(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/i,
      parser: (m) => {
        const months: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        }
        const month = months[m[2].toLowerCase()]
        if (month === undefined) return null
        return new Date(Date.UTC(
          parseInt(m[3]), month, parseInt(m[1]),
          parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
        ))
      }
    },
    // ISO 8601: "2024-01-01T12:00:00Z" 或 "2024-01-01T12:00:00+08:00"
    {
      regex: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/i,
      parser: (m) => new Date(m[0])
    },
    // 中文日期格式: "2024年1月1日 12:00:00" 或 "2024年01月01日 12:00"
    {
      regex: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})?:?(\d{2})?:?(\d{2})?/,
      parser: (m) => new Date(
        parseInt(m[1]),
        parseInt(m[2]) - 1,
        parseInt(m[3]),
        m[4] ? parseInt(m[4]) : 0,
        m[5] ? parseInt(m[5]) : 0,
        m[6] ? parseInt(m[6]) : 0
      )
    },
    // 斜杠日期: "01/01/2024 12:00:00" 或 "2024/01/01 12:00"
    {
      regex: /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})\s*(\d{1,2})?:?(\d{2})?:?(\d{2})?/,
      parser: (m) => {
        // 判断是 MM/DD/YYYY 还是 YYYY/MM/DD
        const first = parseInt(m[1])
        const second = parseInt(m[2])
        const third = parseInt(m[3])
        let year: number, month: number, day: number
        if (first > 1000) {
          // YYYY/MM/DD
          year = first
          month = second - 1
          day = third
        } else {
          // MM/DD/YYYY
          year = third
          month = first - 1
          day = second
        }
        return new Date(
          year, month, day,
          m[4] ? parseInt(m[4]) : 0,
          m[5] ? parseInt(m[5]) : 0,
          m[6] ? parseInt(m[6]) : 0
        )
      }
    }
  ]

  for (const { regex, parser } of patterns) {
    const match = trimmed.match(regex)
    if (match) {
      try {
        const result = parser(match)
        if (result && !isNaN(result.getTime())) {
          return result
        }
      } catch {
        // 继续尝试下一个模式
      }
    }
  }

  // 所有尝试都失败
  logger.debug('无法解析日期字符串: %s', trimmed)
  return undefined
}

/** 使用 postal-mime 解析（快速） */
async function parseWithPostalMime(source: Buffer | Uint8Array): Promise<ParsedMail> {
  const parser = new PostalMime()
  const email = await parser.parse(source)

  let parsedDate = email.date ? parseMailDate(email.date) : undefined

  // 如果 postal-mime 没有解析到日期，尝试手动从原始数据中提取
  if (!parsedDate) {
    const rawString = source.toString('utf-8', 0, Math.min(source.length, 2000))
    const dateMatch = rawString.match(/^Date:\s*(.+?)$/mi)

    if (dateMatch) {
      const dateStr = dateMatch[1].trim()
      logger.debug('postal-mime 未解析到日期，尝试手动提取。Subject: %s', email.subject || '(no subject)')
      logger.debug('  → 原始 Date 头: %s', dateStr)

      // 使用增强的日期解析函数
      parsedDate = parseMailDate(dateStr)

      if (parsedDate) {
        logger.debug('  → 手动解析成功: %s', parsedDate.toISOString())
      } else {
        logger.debug('  → 手动解析失败')
      }
    } else {
      logger.debug('postal-mime: 原始邮件无 Date 头。Subject: %s', email.subject || '(no subject)')
    }
  }

  return {
    messageId: email.messageId || undefined,
    date: parsedDate,
    subject: email.subject || undefined,
    from: parsePostalAddress(email.from),
    to: parsePostalAddressList(email.to),
    cc: parsePostalAddressList(email.cc),
    bcc: parsePostalAddressList(email.bcc),
    replyTo: parsePostalAddressList(email.replyTo),
    text: email.text || undefined,
    html: email.html || undefined,
    attachments: parsePostalAttachments(email.attachments),
  }
}

/** 使用 mailparser 解析（兼容） */
async function parseWithMailparser(source: Buffer | Uint8Array): Promise<ParsedMail> {
  // simpleParser 只接受 Buffer 类型
  const buffer = source instanceof Buffer ? source : Buffer.from(source)
  const parsed = await simpleParser(buffer, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  })

  return {
    messageId: parsed.messageId || undefined,
    date: parsed.date || undefined,
    subject: parsed.subject || undefined,
    from: parseMailparserAddress(parsed.from),
    to: parseMailparserAddressList(parsed.to),
    cc: parseMailparserAddressList(parsed.cc),
    bcc: parseMailparserAddressList(parsed.bcc),
    replyTo: parseMailparserAddressList(parsed.replyTo),
    text: parsed.text || undefined,
    html: parsed.html || undefined,
    attachments: parseMailparserAttachments(parsed.attachments),
  }
}

/** 解析 postal-mime 的单个地址 */
function parsePostalAddress(addr: unknown): MailAddress | undefined {
  if (!addr || typeof addr !== 'object') return undefined
  const obj = addr as { address?: unknown; name?: unknown }
  if (typeof obj.address !== 'string' || !obj.address) return undefined
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    address: obj.address,
  }
}

/** 解析 postal-mime 的地址列表 */
function parsePostalAddressList(addrs: unknown): MailAddress[] | undefined {
  if (!addrs || !Array.isArray(addrs) || addrs.length === 0) return undefined
  const parsed = addrs.map(parsePostalAddress).filter((a): a is MailAddress => !!a)
  return parsed.length > 0 ? parsed : undefined
}

/** 解析 postal-mime 的附件 */
function parsePostalAttachments(attachments: unknown): MailAttachment[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined

  return attachments
    .map((att) => {
      const item = att as {
        filename?: unknown
        mimeType?: unknown
        content?: unknown
        contentId?: unknown
      }
      const contentType = typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream'
      const size = Buffer.isBuffer(item.content) ? item.content.length : 0
      return {
        filename: typeof item.filename === 'string' ? item.filename : 'unnamed',
        contentType,
        size,
        content: Buffer.isBuffer(item.content) ? item.content.toString('base64') : undefined,
        cid: typeof item.contentId === 'string' ? item.contentId : undefined,
      }
    })
    .filter(att => {
      // 只保留小于 500KB 的图片附件
      if (!att.contentType.startsWith('image/')) return false
      if (att.size > 500 * 1024) return false
      return true
    })
}

/** 解析 mailparser 的单个地址 */
function parseMailparserAddress(addr: unknown): MailAddress | undefined {
  if (!addr) return undefined
  if (typeof addr === 'object' && 'value' in addr && Array.isArray((addr as { value?: unknown[] }).value)) {
    const first = (addr as { value: Array<{ address?: unknown; name?: unknown }> }).value[0]
    if (first && typeof first.address === 'string' && first.address) {
      return {
        name: typeof first.name === 'string' ? first.name : undefined,
        address: first.address,
      }
    }
  }
  return undefined
}

/** 解析 mailparser 的地址列表 */
function parseMailparserAddressList(addrs: unknown): MailAddress[] | undefined {
  if (!addrs) return undefined
  if (typeof addrs === 'object' && 'value' in addrs && Array.isArray((addrs as { value?: unknown[] }).value)) {
    const list = (addrs as { value: Array<{ address?: unknown; name?: unknown }> }).value
      .filter((a) => a && typeof a.address === 'string' && a.address)
      .map((a) => ({
        name: typeof a.name === 'string' ? a.name : undefined,
        address: a.address as string,
      }))
    return list.length > 0 ? list : undefined
  }
  return undefined
}

/** 解析 mailparser 的附件 */
function parseMailparserAttachments(attachments: unknown): MailAttachment[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined

  return attachments
    .map((att) => {
      const item = att as {
        filename?: unknown
        contentType?: unknown
        size?: unknown
        content?: unknown
        contentId?: unknown
        cid?: unknown
      }
      const contentType = typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
      const size = typeof item.size === 'number'
        ? item.size
        : (Buffer.isBuffer(item.content) ? item.content.length : 0)
      return {
        filename: typeof item.filename === 'string' ? item.filename : 'unnamed',
        contentType,
        size,
        content: Buffer.isBuffer(item.content) ? item.content.toString('base64') : undefined,
        cid: (typeof item.contentId === 'string' ? item.contentId : undefined)
          || (typeof item.cid === 'string' ? item.cid : undefined),
      }
    })
    .filter(att => {
      // 只保留小于 500KB 的图片附件
      if (!att.contentType.startsWith('image/')) return false
      if (att.size > 500 * 1024) return false
      return true
    })
}

/**
 * 清理 HTML 中的危险标签和属性
 * 使用简单的正则替换，无外部依赖
 *
 * @param html 原始 HTML
 * @returns 清理后的 HTML
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''

  try {
    let result = html

    // 移除危险标签及其内容
    const dangerousTags = ['script', 'iframe', 'object', 'embed']
    for (const tag of dangerousTags) {
      result = result.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
      result = result.replace(new RegExp(`<${tag}[^>]*\\/?>`, 'gi'), '')
    }

    // 移除 style 和 link 标签（可选，保留邮件样式可能更好）
    // result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // result = result.replace(/<link[^>]*\/?>/gi, '')

    // 移除危险事件属性
    const dangerousAttrs = ['onclick', 'onerror', 'onload', 'onmouseover', 'onmouseout', 'onfocus', 'onblur']
    for (const attr of dangerousAttrs) {
      result = result.replace(new RegExp(`\\s${attr}\\s*=\\s*["'][^"']*["']`, 'gi'), '')
      result = result.replace(new RegExp(`\\s${attr}\\s*=\\s*[^\\s>]+`, 'gi'), '')
    }

    return result
  } catch (err) {
    logger.warn('HTML 清理失败:', err)
    return html
  }
}

/**
 * 将 HTML 转换为纯文本
 * 使用简单的正则替换，无外部依赖
 *
 * @param html 原始 HTML
 * @returns 纯文本内容
 */
export function htmlToText(html: string): string {
  if (!html) return ''

  try {
    let result = html

    // 移除 script 和 style 标签及其内容
    result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

    // 将换行标签转换为换行符
    result = result.replace(/<br\s*\/?>/gi, '\n')
    result = result.replace(/<\/p>/gi, '\n\n')
    result = result.replace(/<\/div>/gi, '\n')
    result = result.replace(/<\/tr>/gi, '\n')
    result = result.replace(/<\/li>/gi, '\n')

    // 移除所有 HTML 标签
    result = result.replace(/<[^>]+>/g, '')

    // 解码常见 HTML 实体
    result = result.replace(/&nbsp;/g, ' ')
    result = result.replace(/&lt;/g, '<')
    result = result.replace(/&gt;/g, '>')
    result = result.replace(/&amp;/g, '&')
    result = result.replace(/&quot;/g, '"')
    result = result.replace(/&#39;/g, "'")

    // 清理多余空白
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n')
    result = result.trim()

    return result
  } catch (err) {
    logger.warn('HTML 转文本失败:', err)
    return html.replace(/<[^>]+>/g, '').trim()
  }
}

/**
 * 预处理 HTML 用于截图（保留用于兼容）
 *
 * @param html 原始 HTML
 * @param options 配置项
 * @returns 处理后的 HTML
 */
export function prepareHtmlForScreenshot(
  html: string,
  options: {
    maxWidth?: number
    backgroundColor?: string
    padding?: number
  } = {}
): string {
  const {
    maxWidth = 800,
    backgroundColor = '#ffffff',
    padding = 20,
  } = options

  // 检查是否已经是完整的 HTML 文档
  if (/<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)) {
    return html
  }

  // 包裹在基础样式中
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      max-width: ${maxWidth}px;
      margin: 0 auto;
      padding: ${padding}px;
      background: ${backgroundColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
    }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 8px; }
  </style>
</head>
<body>${html}</body>
</html>`
}

/** 获取解析器统计信息 */
export function getParserStats() {
  const total = stats.postalMimeSuccess + stats.mailparserFallback
  return {
    total,
    postalMimeSuccess: stats.postalMimeSuccess,
    postalMimeFailed: stats.postalMimeFailed,
    mailparserFallback: stats.mailparserFallback,
    postalMimeSuccessRate: total > 0 ? (stats.postalMimeSuccess / total * 100).toFixed(2) + '%' : 'N/A',
  }
}

/** 重置统计信息 */
export function resetParserStats() {
  stats.postalMimeSuccess = 0
  stats.postalMimeFailed = 0
  stats.mailparserFallback = 0
}
