import { Context, h, Logger } from 'koishi'
import type { } from '@koishijs/plugin-puppeteer'
import type {
  StoredMail,
  ForwardRule,
  ForwardElement,
  RenderConfig,
  ForwardPreviewResponse,
  MailAddress,
  MailAttachment,
  ForwardMode,
  RegexConfig,
} from './types'
import { DEFAULT_CSS } from './styles'
import { htmlToImage } from './html2image'

const logger = new Logger('mail-manager/render')

/**
 * Default configuration for rendering.
 */
export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  imageWidth: 800,
  backgroundColor: '#ffffff',
  textColor: '#333333',
  fontSize: 14,
  padding: 0, // 移除白边
  showBorder: true,
  borderColor: '#e0e0e0',
}

/**
 * 默认转发元素配置（用于 text 和 hybrid 模式）
 */
export const DEFAULT_FORWARD_ELEMENTS: ForwardElement[] = [
  { type: 'subject', enabled: true, label: '主题：', order: 1 },
  { type: 'from', enabled: true, label: '发件人：', order: 2 },
  { type: 'date', enabled: true, label: '时间：', order: 3 },
  { type: 'separator', enabled: true, order: 4 },
  { type: 'body', enabled: true, label: '', order: 5 },
]

/**
 * 摘要元素配置（用于 hybrid 模式的文字部分）
 */
export const SUMMARY_ELEMENTS: ForwardElement[] = [
  { type: 'subject', enabled: true, label: '主题：', order: 1 },
  { type: 'from', enabled: true, label: '发件人：', order: 2 },
  { type: 'date', enabled: true, label: '时间：', order: 3 },
]

/**
 * Helper class for formatting mail data.
 */
class MailFormatter {
  static formatDate(date: Date): string {
    return new Date(date).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  static formatAddress(addr: MailAddress): string {
    if (addr.name) {
      return `${addr.name} <${addr.address}>`
    }
    return addr.address
  }

  static formatAddressList(addrs: MailAddress[]): string {
    return addrs.map(a => this.formatAddress(a)).join(', ')
  }

  static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  static escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return text.replace(/[&<>"']/g, char => htmlEntities[char])
  }

  static applyTemplate(template: string, mail: StoredMail): string {
    return template
      .replace(/\{\{subject\}\}/g, mail.subject)
      .replace(/\{\{from\}\}/g, this.formatAddress(mail.from))
      .replace(/\{\{to\}\}/g, this.formatAddressList(mail.to))
      .replace(/\{\{date\}\}/g, this.formatDate(mail.receivedAt))
      .replace(/\{\{text\}\}/g, mail.textContent || '')
      .replace(/\{\{attachmentCount\}\}/g, String(mail.attachments.length))
  }
}

/**
 * 文本生成器 - 用于纯文本模式
 */
class TextGenerator {
  /**
   * 生成纯文本格式的邮件摘要
   * @param mail 邮件数据
   * @param elements 元素配置
   * @param regexConfig 可选的正则提取配置
   */
  static generate(mail: StoredMail, elements: ForwardElement[], regexConfig?: RegexConfig): string {
    const sortedElements = this.sortElements(elements)
    const lines: string[] = []

    for (const element of sortedElements) {
      const content = this.generateElementContent(element, mail, regexConfig)
      if (content) {
        lines.push(content)
      }
    }

    return lines.join('\n')
  }

  /**
   * 使用正则表达式提取文本内容
   */
  static extractWithRegex(text: string, regexConfig: RegexConfig): string | null {
    if (!regexConfig.pattern || !text) return null

    try {
      const regex = new RegExp(regexConfig.pattern, regexConfig.flags || '')
      const match = text.match(regex)

      if (!match) return null

      // 如果提供了模板，使用模板替换捕获组
      if (regexConfig.template) {
        let result = regexConfig.template
        // 替换 $0 或 $& 为完整匹配
        result = result.replace(/\$0|\$&/g, match[0])
        // 替换 $1, $2, ... 为捕获组
        for (let i = 1; i < match.length; i++) {
          result = result.replace(new RegExp(`\\$${i}`, 'g'), match[i] || '')
        }
        return result
      }

      // 没有模板时，返回第一个捕获组或完整匹配
      return match[1] || match[0]
    } catch (e) {
      logger.warn(`Invalid regex pattern: ${regexConfig.pattern}`, e)
      return null
    }
  }

  private static sortElements(elements: ForwardElement[]): ForwardElement[] {
    return [...elements]
      .filter(e => e.enabled)
      .sort((a, b) => a.order - b.order)
  }

  private static generateElementContent(element: ForwardElement, mail: StoredMail, regexConfig?: RegexConfig): string | null {
    const label = element.label || ''

    switch (element.type) {
      case 'subject':
        return `${label || '主题：'}${mail.subject}`
      case 'from':
        return `${label || '发件人：'}${MailFormatter.formatAddress(mail.from)}`
      case 'to':
        return `${label || '收件人：'}${MailFormatter.formatAddressList(mail.to)}`
      case 'date':
        return `${label || '时间：'}${MailFormatter.formatDate(mail.receivedAt)}`
      case 'separator':
        return '─'.repeat(30)
      case 'body':
      case 'text': // 向后兼容
        // 如果有正则配置，尝试提取内容
        if (regexConfig && regexConfig.pattern && mail.textContent) {
          const extracted = TextGenerator.extractWithRegex(mail.textContent, regexConfig)
          if (extracted) {
            return `\n${extracted}`
          }
          // 正则未匹配到，返回完整内容
        }
        return mail.textContent ? `\n${mail.textContent.trim()}` : null
      case 'attachments':
        if (mail.attachments.length === 0) return null
        const attachmentLines = mail.attachments.map(
          att => `  - ${att.filename} (${MailFormatter.formatSize(att.size)})`
        )
        return `\n附件 (${mail.attachments.length})：\n${attachmentLines.join('\n')}`
      case 'custom':
        return element.template ? MailFormatter.applyTemplate(element.template, mail) : null
      default:
        return null
    }
  }
}

/**
 * HTML 生成器 - 用于图片渲染
 */
class HtmlGenerator {
  /**
   * 生成用于渲染的 HTML（保持邮件原始格式）
   * 这是 image 模式使用的方法
   */
  static generateOriginalHtml(mail: StoredMail, customCss?: string): string {
    let bodyHtml = ''

    // 优先使用 HTML 内容
    if (mail.htmlContent) {
      bodyHtml = this.processHtmlContent(mail)
    } else if (mail.textContent) {
      // 纯文本邮件：将换行转换为 <br>，保持格式
      bodyHtml = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit;">${MailFormatter.escapeHtml(mail.textContent)}</pre>`
    }

    const css = customCss || DEFAULT_CSS
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  <div class="mail-container">
    <div class="mail-body">${bodyHtml}</div>
  </div>
</body>
</html>`
  }

  /**
   * 生成带元素选择的 HTML（用于预览或 hybrid 模式）
   */
  static generate(mail: StoredMail, elements: ForwardElement[], customCss?: string): string {
    const sortedElements = this.sortElements(elements)
    const htmlParts: string[] = []

    for (const element of sortedElements) {
      const content = this.generateElementHtml(element, mail)
      if (content) {
        htmlParts.push(content)
      }
    }

    const css = customCss || DEFAULT_CSS
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  <div class="mail-container">
    ${htmlParts.join('\n    ')}
  </div>
</body>
</html>`
  }

  private static sortElements(elements: ForwardElement[]): ForwardElement[] {
    return [...elements]
      .filter(e => e.enabled)
      .sort((a, b) => a.order - b.order)
  }

  private static generateElementHtml(element: ForwardElement, mail: StoredMail): string | null {
    const label = element.label || ''
    const escape = MailFormatter.escapeHtml

    switch (element.type) {
      case 'subject':
        return `<div class="mail-subject">${label}${escape(mail.subject)}</div>`
      case 'from':
        return this.createFieldHtml(label || '发件人：', MailFormatter.formatAddress(mail.from))
      case 'to':
        return this.createFieldHtml(label || '收件人：', MailFormatter.formatAddressList(mail.to))
      case 'date':
        return this.createFieldHtml(label || '时间：', MailFormatter.formatDate(mail.receivedAt))
      case 'separator':
        return '<div class="mail-separator"></div>'
      case 'body':
      case 'html': // 向后兼容
        return this.processHtmlContentForBody(mail)
      case 'text': // 向后兼容
        return mail.textContent
          ? `<div class="mail-body"><pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit;">${escape(mail.textContent)}</pre></div>`
          : null
      case 'markdown':
        // Markdown 渲染（简单处理）
        return mail.textContent
          ? `<div class="mail-body"><pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit;">${escape(mail.textContent)}</pre></div>`
          : null
      case 'attachments':
        return this.generateAttachmentsHtml(mail.attachments)
      case 'custom':
        return element.template ? MailFormatter.applyTemplate(element.template, mail) : null
      default:
        return null
    }
  }

  private static createFieldHtml(label: string, value: string): string {
    return `<div class="mail-field">
      <span class="mail-field-label">${label}</span>
      <span class="mail-field-value">${MailFormatter.escapeHtml(value)}</span>
    </div>`
  }

  private static processHtmlContent(mail: StoredMail): string {
    if (mail.htmlContent) {
      let html = mail.htmlContent
      // Replace CID images with Base64 data
      for (const att of mail.attachments) {
        if (att.cid && att.content) {
          const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          html = html.replace(
            new RegExp(`cid:${escapedCid}`, 'g'),
            `data:${att.contentType};base64,${att.content}`
          )
        }
      }
      return html
    }
    return ''
  }

  private static processHtmlContentForBody(mail: StoredMail): string | null {
    if (mail.htmlContent) {
      let html = mail.htmlContent
      // Replace CID images with Base64 data
      for (const att of mail.attachments) {
        if (att.cid && att.content) {
          const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          html = html.replace(
            new RegExp(`cid:${escapedCid}`, 'g'),
            `data:${att.contentType};base64,${att.content}`
          )
        }
      }
      return `<div class="mail-body">${html}</div>`
    } else if (mail.textContent) {
      return `<div class="mail-body"><pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit;">${MailFormatter.escapeHtml(mail.textContent)}</pre></div>`
    }
    return null
  }

  private static generateAttachmentsHtml(attachments: MailAttachment[]): string | null {
    if (attachments.length === 0) return null

    const items = attachments.map(att =>
      `<div class="mail-attachment">
        <span class="mail-attachment-icon">&#128206;</span>
        ${MailFormatter.escapeHtml(att.filename)} (${MailFormatter.formatSize(att.size)})
      </div>`
    ).join('')

    return `<div class="mail-attachments">${items}</div>`
  }
}

/**
 * 图片渲染器
 */
class ImageRenderer {
  constructor(private ctx: Context) {}

  async render(html: string, config: RenderConfig = DEFAULT_RENDER_CONFIG): Promise<string | undefined> {
    // 检查 puppeteer 服务是否可用
    if (!this.ctx.puppeteer) {
      logger.warn('puppeteer 服务不可用，无法渲染图片。请安装 koishi-plugin-puppeteer')
      return undefined
    }

    try {
      const buffer = await htmlToImage(this.ctx, html, {
        width: config.imageWidth,
        backgroundColor: config.backgroundColor,
        padding: config.padding,
        format: 'png',
        waitTime: 3000, // 等待 3 秒以确保图片加载
      })
      return buffer.toString('base64')
    } catch (error) {
      logger.error('Failed to render image: %s', error)
      return undefined
    }
  }
}

/**
 * 邮件渲染器主类
 * 根据不同模式生成转发内容
 */
export class MailRenderer {
  private imageRenderer: ImageRenderer

  constructor(private ctx: Context) {
    this.imageRenderer = new ImageRenderer(ctx)
  }

  /**
   * 检测转发模式
   * 处理向后兼容：旧规则可能没有 forwardMode 字段
   */
  private detectForwardMode(rule: ForwardRule): ForwardMode {
    // 如果明确设置了 forwardMode，直接使用
    if (rule.forwardMode) {
      return rule.forwardMode
    }

    // 向后兼容：检查旧版元素配置
    const hasHtmlOrMd = rule.elements.some(
      e => e.enabled && (e.type === 'html' || e.type === 'markdown')
    )

    if (hasHtmlOrMd) {
      return 'image' // 旧配置中启用了 html/markdown，使用图片模式
    }

    return 'text' // 默认使用文本模式
  }

  /**
   * 生成预览内容
   */
  async generatePreview(
    mail: StoredMail,
    elements: ForwardElement[],
    customCss?: string,
    renderConfig?: Partial<RenderConfig>,
    forwardMode?: ForwardMode
  ): Promise<ForwardPreviewResponse> {
    const config = { ...DEFAULT_RENDER_CONFIG, ...renderConfig }
    const mode = forwardMode || 'text'

    let textPreview = ''
    let htmlPreview = ''
    let imagePreview: string | undefined

    switch (mode) {
      case 'text':
        // 纯文本模式：只生成文本
        textPreview = TextGenerator.generate(mail, elements)
        htmlPreview = HtmlGenerator.generate(mail, elements, customCss)
        break

      case 'image':
        // 图片模式：渲染原始邮件 HTML 为图片
        htmlPreview = HtmlGenerator.generateOriginalHtml(mail, customCss)
        textPreview = `[邮件图片] ${mail.subject}`
        imagePreview = await this.imageRenderer.render(htmlPreview, config)
        break

      case 'hybrid':
        // 混合模式：文字摘要 + 正文图片
        textPreview = TextGenerator.generate(mail, elements.filter(e => e.type !== 'body' && e.type !== 'text' && e.type !== 'html'))
        htmlPreview = HtmlGenerator.generateOriginalHtml(mail, customCss)
        imagePreview = await this.imageRenderer.render(htmlPreview, config)
        break
    }

    return {
      textPreview,
      htmlPreview,
      imagePreview,
    }
  }

  /**
   * 生成用于转发的 Koishi 消息元素
   */
  async generateForwardElements(
    mail: StoredMail,
    rule: ForwardRule
  ): Promise<h[]> {
    const elements = rule.elements.length > 0 ? rule.elements : DEFAULT_FORWARD_ELEMENTS
    const mode = this.detectForwardMode(rule)
    const result: h[] = []

    // 从规则中提取正则配置
    const regexConfig: RegexConfig | undefined = (rule as any).regexConfig

    logger.debug(`Generating forward elements for mail "${mail.subject}" with mode: ${mode}`)

    switch (mode) {
      case 'text':
        // 纯文本模式：按元素配置生成文本消息，支持正则提取
        result.push(h.text(TextGenerator.generate(mail, elements, regexConfig)))
        break

      case 'image':
        // 图片模式：将邮件原始内容渲染为图片
        const imageHtml = HtmlGenerator.generateOriginalHtml(mail, rule.customCss)
        const imageBase64 = await this.imageRenderer.render(imageHtml, rule.renderConfig)

        if (imageBase64) {
          result.push(h.image(`data:image/png;base64,${imageBase64}`))
        } else {
          // 图片渲染失败时回退到文本
          result.push(h.text('[!] 图片渲染失败，以下为纯文本内容：\n\n'))
          result.push(h.text(TextGenerator.generate(mail, DEFAULT_FORWARD_ELEMENTS)))
        }
        break

      case 'hybrid':
        // 混合模式：先发送文字摘要，再发送正文图片
        // 筛选出摘要元素（排除正文相关）
        const summaryElements = elements.filter(
          e => e.enabled && !['body', 'text', 'html', 'markdown'].includes(e.type)
        )

        if (summaryElements.length > 0) {
          result.push(h.text(TextGenerator.generate(mail, summaryElements)))
        }

        // 渲染正文为图片
        const bodyHtml = HtmlGenerator.generateOriginalHtml(mail, rule.customCss)
        const bodyImageBase64 = await this.imageRenderer.render(bodyHtml, rule.renderConfig)

        if (bodyImageBase64) {
          result.push(h.image(`data:image/png;base64,${bodyImageBase64}`))
        } else {
          // 图片渲染失败，发送纯文本正文
          if (mail.textContent) {
            result.push(h.text('\n' + mail.textContent.trim()))
          }
        }
        break
    }

    // 附加图片附件（所有模式都支持）
    const shouldIncludeAttachments = elements.some(e => e.enabled && e.type === 'attachments')
    if (shouldIncludeAttachments || mode === 'image') {
      for (const att of mail.attachments) {
        if (att.content && att.contentType.startsWith('image/') && !att.cid) {
          // 只附加非内嵌的图片附件
          result.push(h.image(`data:${att.contentType};base64,${att.content}`))
        }
      }
    }

    return result
  }
}
