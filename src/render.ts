import { Context, h, Logger } from 'koishi'
import type {
  StoredMail,
  ForwardRule,
  ForwardElement,
  RenderConfig,
  ForwardPreviewResponse,
  MailAddress,
  MailAttachment,
} from './types'
import { DEFAULT_CSS } from './styles'

const logger = new Logger('mail-listener/render')

/**
 * Default configuration for rendering.
 */
export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  imageWidth: 800,
  backgroundColor: '#ffffff',
  textColor: '#333333',
  fontSize: 14,
  padding: 20,
  showBorder: true,
  borderColor: '#e0e0e0',
}

/**
 * Default elements to include in a forwarded message.
 */
export const DEFAULT_FORWARD_ELEMENTS: ForwardElement[] = [
  { type: 'subject', enabled: true, label: '📧 主题：', order: 1 },
  { type: 'from', enabled: true, label: '👤 发件人：', order: 2 },
  { type: 'date', enabled: true, label: '📅 时间：', order: 3 },
  { type: 'separator', enabled: true, order: 4 },
  { type: 'text', enabled: true, label: '', order: 5 },
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
 * Handles the generation of text previews.
 */
class TextGenerator {
  static generate(mail: StoredMail, elements: ForwardElement[]): string {
    const sortedElements = this.sortElements(elements)
    const lines: string[] = []

    for (const element of sortedElements) {
      const content = this.generateElementContent(element, mail)
      if (content) {
        lines.push(content)
      }
    }

    return lines.join('\n')
  }

  private static sortElements(elements: ForwardElement[]): ForwardElement[] {
    return [...elements]
      .filter(e => e.enabled)
      .sort((a, b) => a.order - b.order)
  }

  private static generateElementContent(element: ForwardElement, mail: StoredMail): string | null {
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
      case 'text':
        return mail.textContent ? `\n${mail.textContent.trim()}` : null
      case 'attachments':
        if (mail.attachments.length === 0) return null
        const attachmentLines = mail.attachments.map(
          att => `  • ${att.filename} (${MailFormatter.formatSize(att.size)})`
        )
        return `\n📎 附件 (${mail.attachments.length})：\n${attachmentLines.join('\n')}`
      case 'custom':
        return element.template ? MailFormatter.applyTemplate(element.template, mail) : null
      default:
        return null
    }
  }
}

/**
 * Handles the generation of HTML previews.
 */
class HtmlGenerator {
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
      case 'text':
        return mail.textContent
          ? `<div class="mail-body"><pre>${escape(mail.textContent)}</pre></div>`
          : null
      case 'html':
        return this.processHtmlContent(mail)
      case 'markdown':
        // TODO: Implement Markdown rendering
        return mail.textContent
          ? `<div class="mail-body"><pre>${escape(mail.textContent)}</pre></div>`
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

  private static processHtmlContent(mail: StoredMail): string | null {
    if (mail.htmlContent) {
      let html = mail.htmlContent
      // Replace CID images with Base64 data
      for (const att of mail.attachments) {
        if (att.cid && att.content) {
          // Escape special regex characters in CID
          const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          html = html.replace(
            new RegExp(`cid:${escapedCid}`, 'g'),
            `data:${att.contentType};base64,${att.content}`
          )
        }
      }
      return `<div class="mail-body">${html}</div>`
    } else if (mail.textContent) {
      return `<div class="mail-body"><pre>${MailFormatter.escapeHtml(mail.textContent)}</pre></div>`
    }
    return null
  }

  private static generateAttachmentsHtml(attachments: MailAttachment[]): string | null {
    if (attachments.length === 0) return null

    const items = attachments.map(att =>
      `<div class="mail-attachment">
        <span class="mail-attachment-icon">📎</span>
        ${MailFormatter.escapeHtml(att.filename)} (${MailFormatter.formatSize(att.size)})
      </div>`
    ).join('')

    return `<div class="mail-attachments">${items}</div>`
  }
}

/**
 * Handles rendering HTML to images using Puppeteer.
 */
class ImageRenderer {
  constructor(private ctx: Context) {}

  async render(html: string, config: RenderConfig = DEFAULT_RENDER_CONFIG): Promise<string | undefined> {
    // Safe access to puppeteer service
    const puppeteer = this.ctx.get('puppeteer')
    if (!puppeteer) {
      logger.warn('Puppeteer service not available, skipping image render')
      return undefined
    }

    let page: any
    try {
      page = await puppeteer.page()

      // Set initial viewport
      await page.setViewport({
        width: config.imageWidth,
        height: 600,
        deviceScaleFactor: 2,
      })

      // Load HTML content
      // Using 'networkidle0' can be slow if there are external resources.
      // 'domcontentloaded' is faster but might miss some styles/images.
      // We use a timeout to prevent hanging.
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000
      })

      // Calculate content height
      const bodyHandle = await page.$('body')
      const boundingBox = await bodyHandle?.boundingBox()
      const contentHeight = boundingBox?.height || 600

      // Limit max height to prevent huge images
      const height = Math.min(Math.ceil(contentHeight) + config.padding * 2, 5000)

      // Resize viewport to fit content
      await page.setViewport({
        width: config.imageWidth,
        height: height,
        deviceScaleFactor: 2,
      })

      // Take screenshot
      const screenshot = await page.screenshot({
        type: 'png',
        encoding: 'base64',
        fullPage: true,
      })

      return screenshot as string
    } catch (error) {
      logger.error('Failed to render image: %s', error)
      return undefined
    } finally {
      if (page) {
        await page.close().catch((err: Error) => logger.warn('Failed to close page: %s', err))
      }
    }
  }
}

/**
 * Main class for rendering mails.
 * Orchestrates text, HTML, and image generation.
 */
export class MailRenderer {
  private imageRenderer: ImageRenderer

  constructor(private ctx: Context) {
    this.imageRenderer = new ImageRenderer(ctx)
  }

  /**
   * Generates a complete preview (text, HTML, and optionally image) for a mail.
   */
  async generatePreview(
    mail: StoredMail,
    elements: ForwardElement[],
    customCss?: string,
    renderConfig?: Partial<RenderConfig>
  ): Promise<ForwardPreviewResponse> {
    const config = { ...DEFAULT_RENDER_CONFIG, ...renderConfig }

    const textPreview = TextGenerator.generate(mail, elements)
    const htmlPreview = HtmlGenerator.generate(mail, elements, customCss)

    let imagePreview: string | undefined

    // Check if image rendering is required (HTML or Markdown elements present)
    const requiresImage = elements.some(e => e.enabled && (e.type === 'html' || e.type === 'markdown'))

    if (requiresImage) {
      imagePreview = await this.imageRenderer.render(htmlPreview, config)
    }

    return {
      textPreview,
      htmlPreview,
      imagePreview,
    }
  }

  /**
   * Generates Koishi message elements for forwarding.
   *
   * Note: This method is async to allow for potential image rendering.
   */
  async generateForwardElements(
    mail: StoredMail,
    rule: ForwardRule
  ): Promise<h[]> {
    const elements = rule.elements.length > 0 ? rule.elements : DEFAULT_FORWARD_ELEMENTS
    const result: h[] = []

    // Check if we need to render the mail body as an image
    const requiresImage = elements.some(e => e.enabled && (e.type === 'html' || e.type === 'markdown'))

    if (requiresImage) {
      // Generate HTML and render to image
      const html = HtmlGenerator.generate(mail, elements, rule.customCss)
      const imageBase64 = await this.imageRenderer.render(html, rule.renderConfig)

      if (imageBase64) {
        result.push(h.image(`data:image/png;base64,${imageBase64}`))
      } else {
        // Fallback to text if image rendering fails
        result.push(h.text(TextGenerator.generate(mail, elements)))
      }
    } else {
      // Text-only mode
      result.push(h.text(TextGenerator.generate(mail, elements)))
    }

    // Append attachments (images only)
    // Note: Non-image attachments are listed in the text summary but not sent as files here
    // to avoid spamming or file size limits.
    for (const att of mail.attachments) {
      if (att.content && att.contentType.startsWith('image/')) {
        result.push(h.image(`data:${att.contentType};base64,${att.content}`))
      }
    }

    return result
  }
}
