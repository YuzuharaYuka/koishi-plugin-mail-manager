/**
 * 高性能邮件解析适配器
 *
 * 策略：
 * 1. 优先使用 postal-mime（快速路径，速度提升 10-20 倍）
 * 2. 遇到错误时回退到 mailparser（兼容性路径）
 * 3. 使用 linkedom 处理 HTML（支持 DOM API，可转换为图片）
 */

import PostalMime from 'postal-mime'
import { simpleParser, ParsedMail as MailparserParsedMail } from 'mailparser'
import { parseHTML } from 'linkedom'
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
    logger.warn('postal-mime 解析失败，回退到 mailparser:', err.message)
    stats.postalMimeFailed++
    stats.mailparserFallback++
    return await parseWithMailparser(source)
  }
}

/** 使用 postal-mime 解析（快速） */
async function parseWithPostalMime(source: Buffer | Uint8Array): Promise<ParsedMail> {
  const parser = new PostalMime()
  const email = await parser.parse(source)

  let parsedDate = email.date ? new Date(email.date) : undefined

  // 如果 postal-mime 没有解析到日期，尝试手动从原始数据中提取
  if (!parsedDate) {
    const rawString = source.toString('utf-8', 0, Math.min(source.length, 2000))
    const dateMatch = rawString.match(/^Date:\s*(.+?)$/mi)

    if (dateMatch) {
      const dateStr = dateMatch[1].trim()
      logger.warn('postal-mime: No date parsed, trying manual extraction. Subject: %s', email.subject || '(no subject)')
      logger.warn('  → Raw Date header: %s', dateStr)

      try {
        // 尝试解析原始日期字符串
        parsedDate = new Date(dateStr)

        // 验证日期是否有效
        if (isNaN(parsedDate.getTime())) {
          logger.warn('  → Manual parse failed: Invalid date')
          parsedDate = undefined
        } else {
          logger.info('  → Manual parse succeeded: %s', parsedDate.toISOString())
        }
      } catch (err) {
        logger.warn('  → Manual parse error: %s', err.message)
      }
    } else {
      logger.warn('postal-mime: No Date header in raw email. Subject: %s', email.subject || '(no subject)')
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
function parsePostalAddress(addr: any): MailAddress | undefined {
  if (!addr || !addr.address) return undefined
  return {
    name: addr.name || undefined,
    address: addr.address,
  }
}

/** 解析 postal-mime 的地址列表 */
function parsePostalAddressList(addrs: any[]): MailAddress[] | undefined {
  if (!addrs || !Array.isArray(addrs) || addrs.length === 0) return undefined
  return addrs
    .filter(a => a && a.address)
    .map(a => ({
      name: a.name || undefined,
      address: a.address,
    }))
}

/** 解析 postal-mime 的附件 */
function parsePostalAttachments(attachments: any[]): MailAttachment[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined

  return attachments
    .map(att => ({
      filename: att.filename || 'unnamed',
      contentType: att.mimeType || 'application/octet-stream',
      size: att.content?.length || 0,
      content: att.content,
      contentId: att.contentId || undefined,
    }))
    .filter(att => {
      // 只保留小于 500KB 的图片附件
      if (!att.contentType.startsWith('image/')) return false
      if (att.size > 500 * 1024) return false
      return true
    })
}

/** 解析 mailparser 的单个地址 */
function parseMailparserAddress(addr: any): MailAddress | undefined {
  if (!addr) return undefined
  if (typeof addr === 'object' && 'value' in addr && Array.isArray(addr.value)) {
    const first = addr.value[0]
    if (first && first.address) {
      return {
        name: first.name || undefined,
        address: first.address,
      }
    }
  }
  return undefined
}

/** 解析 mailparser 的地址列表 */
function parseMailparserAddressList(addrs: any): MailAddress[] | undefined {
  if (!addrs) return undefined
  if (typeof addrs === 'object' && 'value' in addrs && Array.isArray(addrs.value)) {
    const list = addrs.value
      .filter((a: any) => a && a.address)
      .map((a: any) => ({
        name: a.name || undefined,
        address: a.address,
      }))
    return list.length > 0 ? list : undefined
  }
  return undefined
}

/** 解析 mailparser 的附件 */
function parseMailparserAttachments(attachments: any[]): MailAttachment[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined

  return attachments
    .map(att => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || att.content?.length || 0,
      content: att.content,
      contentId: att.contentId || att.cid || undefined,
    }))
    .filter(att => {
      // 只保留小于 500KB 的图片附件
      if (!att.contentType.startsWith('image/')) return false
      if (att.size > 500 * 1024) return false
      return true
    })
}

/**
 * 清理和美化 HTML（使用 linkedom）
 *
 * @param html 原始 HTML
 * @returns 清理后的 HTML
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''

  try {
    const { document } = parseHTML(html)

    // 移除危险标签
    const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'link']
    dangerousTags.forEach(tag => {
      const elements = document.querySelectorAll(tag)
      elements.forEach(el => el.remove())
    })

    // 移除危险属性
    const dangerousAttrs = ['onclick', 'onerror', 'onload', 'onmouseover', 'onmouseout']
    const allElements = document.querySelectorAll('*')
    allElements.forEach(el => {
      dangerousAttrs.forEach(attr => {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr)
        }
      })
    })

    // 返回清理后的 HTML
    return document.toString()
  } catch (err) {
    logger.warn('HTML 清理失败:', err.message)
    return html // 失败时返回原始内容
  }
}

/**
 * 将 HTML 转换为纯文本（使用 linkedom）
 *
 * @param html 原始 HTML
 * @returns 纯文本内容
 */
export function htmlToText(html: string): string {
  if (!html) return ''

  try {
    const { document } = parseHTML(html)

    // 移除不显示的标签
    const hiddenTags = ['script', 'style', 'head']
    hiddenTags.forEach(tag => {
      const elements = document.querySelectorAll(tag)
      elements.forEach(el => el.remove())
    })

    // 提取文本内容
    return document.body?.textContent?.trim() || ''
  } catch (err) {
    logger.warn('HTML 转文本失败:', err.message)
    // 简单的正则替换作为回退
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

/**
 * 预处理 HTML 用于截图（添加样式、限制宽度等）
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

  try {
    const { document } = parseHTML(html)

    // 创建样式
    const style = document.createElement('style')
    style.textContent = `
      * {
        max-width: 100%;
        word-wrap: break-word;
      }
      body {
        max-width: ${maxWidth}px;
        margin: 0 auto;
        padding: ${padding}px;
        background-color: ${backgroundColor};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #333;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      table td, table th {
        border: 1px solid #ddd;
        padding: 8px;
      }
    `

    // 插入样式到 head
    if (!document.head) {
      const head = document.createElement('head')
      document.documentElement.insertBefore(head, document.body)
    }
    document.head.appendChild(style)

    return document.toString()
  } catch (err) {
    logger.warn('HTML 预处理失败:', err.message)
    // 回退：包裹在基础样式中
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { max-width: ${maxWidth}px; margin: 0 auto; padding: ${padding}px; background: ${backgroundColor}; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `
  }
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
