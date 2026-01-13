/**
 * HTML 转图片工具 - 使用 @napi-rs/canvas
 *
 * 用于将邮件 HTML 内容转换为图片，方便转发到不支持富文本的平台
 */

import { Context, Logger, h } from 'koishi'
import { createCanvas, loadImage, SKRSContext2D, Image } from '@napi-rs/canvas'
import { parseHTML } from 'linkedom'

const logger = new Logger('mail-manager/html2image')

// --- 配置与接口定义 (Configuration & Interfaces) ---

export interface Html2ImageOptions {
  /** 最大宽度（像素） */
  maxWidth?: number
  /** 背景色 */
  backgroundColor?: string
  /** 内边距（像素） */
  padding?: number
  /** 图片质量 (0-100) */
  quality?: number
  /** 输出格式 */
  format?: 'png' | 'jpeg' | 'webp'
  /** 字体大小 */
  fontSize?: number
  /** 行高倍数 */
  lineHeight?: number
}

/** 内部使用的完整配置对象 */
interface RenderConfig {
  maxWidth: number
  backgroundColor: string
  padding: number
  quality: number
  format: 'png' | 'jpeg' | 'webp'
  baseStyle: TextStyle
}

interface TextStyle {
  fontSize: number
  fontWeight: string
  fontFamily: string
  color: string
  lineHeight: number
}

/** 内容块的基础接口 */
interface BaseBlock {
  style: TextStyle
  marginBottom: number
}

interface TextBlock extends BaseBlock {
  type: 'text' | 'heading'
  content: string
}

interface ImageBlock extends BaseBlock {
  type: 'image'
  url: string
  image?: Image // 加载后的图片对象
  width?: number
  height?: number
}

interface DividerBlock extends BaseBlock {
  type: 'divider'
}

type ContentBlock = TextBlock | ImageBlock | DividerBlock

/** 布局计算后的渲染项 */
interface RenderItem {
  block: ContentBlock
  y: number
  height: number
  lines?: string[] // 缓存文本行
}

// --- 主入口函数 (Main Entry Point) ---

/**
 * 将 HTML 转换为图片 Buffer
 *
 * @param ctx Koishi Context
 * @param html 原始 HTML 内容
 * @param options 配置项
 */
export async function htmlToImage(
  ctx: Context,
  html: string,
  options: Html2ImageOptions = {}
): Promise<Buffer> {
  const converter = new HtmlToImageConverter(html, options)
  return await converter.convert()
}

/**
 * 将邮件 HTML 转换为 Koishi 元素（图片）
 */
export async function mailHtmlToElement(
  ctx: Context,
  html: string,
  options: Html2ImageOptions = {}
): Promise<any> {
  const buffer = await htmlToImage(ctx, html, options)
  const mimeType = options.format === 'png' ? 'image/png' :
                   options.format === 'webp' ? 'image/webp' : 'image/jpeg'
  const base64 = buffer.toString('base64')
  return h('img', { src: `data:${mimeType};base64,${base64}` })
}

/**
 * 批量转换多个 HTML
 */
export async function batchHtmlToImage(
  ctx: Context,
  htmlList: string[],
  options: Html2ImageOptions = {}
): Promise<Buffer[]> {
  return Promise.all(htmlList.map(html =>
    htmlToImage(ctx, html, options).catch(err => {
      logger.error(`Batch conversion failed: ${err.message}`)
      // 返回空 Buffer 或处理错误，这里为了类型兼容返回 null (需调用方处理)
      // 但 Buffer[] 类型不允许 null，所以我们返回空 Buffer
      return Buffer.alloc(0)
    })
  ))
}

/**
 * 将 HTML 保存为图片文件
 */
export async function saveHtmlAsImage(
  ctx: Context,
  html: string,
  filepath: string,
  options: Html2ImageOptions = {}
): Promise<void> {
  const fs = await import('fs/promises')
  const buffer = await htmlToImage(ctx, html, options)
  await fs.writeFile(filepath, buffer)
  logger.info(`Saved HTML as image: ${filepath}`)
}

// --- 核心转换类 (Core Converter Class) ---

class HtmlToImageConverter {
  private config: RenderConfig
  private document: Document

  constructor(html: string, options: Html2ImageOptions) {
    this.config = this.normalizeConfig(options)
    this.document = this.parseHtml(html)
  }

  /**
   * 执行转换流程：解析 -> 预加载 -> 布局 -> 绘制
   *
   * 这种 "Pipeline" 风格的代码读起来像散文一样，清晰地展示了处理步骤。
   */
  async convert(): Promise<Buffer> {
    try {
      // 1. 提取内容块 (Extract)
      const blocks = this.extractBlocks()

      // 2. 预加载资源 (Load)
      // 必须先加载图片才能知道其尺寸，从而计算布局
      await this.preloadResources(blocks)

      // 3. 计算布局 (Layout)
      // 确定每个元素的位置和总高度
      const layout = this.calculateLayout(blocks)

      // 4. 绘制到 Canvas (Render)
      const buffer = this.render(layout)

      logger.info(`Converted HTML to image: ${layout.width}x${layout.height} (${this.config.format})`)
      return buffer
    } catch (error) {
      logger.error('HTML to Image conversion failed:', error)
      throw error
    }
  }

  /**
   * 标准化配置，填充默认值
   */
  private normalizeConfig(options: Html2ImageOptions): RenderConfig {
    return {
      maxWidth: options.maxWidth ?? 800,
      backgroundColor: options.backgroundColor ?? '#ffffff',
      padding: options.padding ?? 20,
      quality: options.quality ?? 90,
      format: options.format ?? 'jpeg',
      baseStyle: {
        fontSize: options.fontSize ?? 14,
        fontWeight: 'normal',
        fontFamily: 'Arial, sans-serif',
        color: '#333333',
        lineHeight: options.lineHeight ?? 1.6,
      }
    }
  }

  /**
   * 解析 HTML 并清理无用标签
   */
  private parseHtml(html: string): Document {
    const { document } = parseHTML(html)
    // 移除干扰元素，保持 DOM 树干净
    const removeTags = ['script', 'style', 'head', 'meta', 'link']
    removeTags.forEach(tag => document.querySelectorAll(tag).forEach(el => el.remove()))
    return document as unknown as Document
  }

  /**
   * 遍历 DOM 树提取内容块
   *
   * 将复杂的 DOM 结构扁平化为线性的 Block 列表，便于后续布局。
   */
  private extractBlocks(): ContentBlock[] {
    const blocks: ContentBlock[] = []

    const traverse = (node: Element) => {
      if (!node) return
      const nodeName = node.nodeName.toLowerCase()

      // 处理标题 (h1-h6)
      if (/^h[1-6]$/.test(nodeName)) {
        const level = parseInt(nodeName[1])
        const text = node.textContent?.trim()
        if (text) {
          blocks.push({
            type: 'heading',
            content: text,
            style: {
              ...this.config.baseStyle,
              fontSize: this.config.baseStyle.fontSize + (7 - level) * 2,
              fontWeight: 'bold'
            },
            marginBottom: 10
          })
        }
        return // 标题内部不再递归
      }

      // 处理段落 (p, div)
      if (nodeName === 'p' || nodeName === 'div') {
        const text = node.textContent?.trim()
        if (text) {
          blocks.push({
            type: 'text',
            content: text,
            style: this.config.baseStyle,
            marginBottom: 10
          })
        }
        // 注意：这里简化处理，不再递归 p/div 内部。
        // 如果需要支持 p 内部的 img，需要修改此处逻辑。
        // 目前假设 p 内部只有文本。
        return
      }

      // 处理图片 (img)
      if (nodeName === 'img') {
        const src = node.getAttribute('src')
        if (src) {
          blocks.push({
            type: 'image',
            url: src,
            style: this.config.baseStyle,
            marginBottom: 10
          })
        }
        return
      }

      // 处理分隔线 (hr)
      if (nodeName === 'hr') {
        blocks.push({
          type: 'divider',
          style: this.config.baseStyle,
          marginBottom: 20
        })
        return
      }

      // 递归处理子节点
      // 使用 Array.from 防止 live collection 问题
      if (node.children) {
        for (const child of Array.from(node.children)) {
          traverse(child)
        }
      }
    }

    traverse(this.document.body)
    return blocks
  }

  /**
   * 预加载所有图片资源
   *
   * 并行加载以提高性能。加载完成后，我们就能知道图片的真实尺寸。
   */
  private async preloadResources(blocks: ContentBlock[]) {
    const imageBlocks = blocks.filter(b => b.type === 'image') as ImageBlock[]

    if (imageBlocks.length === 0) return

    await Promise.all(imageBlocks.map(async (block) => {
      try {
        const image = await loadImage(block.url)
        block.image = image

        // 计算适应宽度的尺寸 (保持纵横比)
        const contentWidth = this.config.maxWidth
        const aspectRatio = image.height / image.width
        block.width = Math.min(image.width, contentWidth)
        block.height = block.width * aspectRatio
      } catch (e) {
        logger.warn(`Failed to load image: ${block.url}`)
        // 加载失败时设置默认占位尺寸
        block.width = this.config.maxWidth
        block.height = 100
      }
    }))
  }

  /**
   * 计算布局
   *
   * 遍历所有块，计算它们的高度和 Y 轴位置。
   * 对于文本块，需要进行自动换行计算。
   */
  private calculateLayout(blocks: ContentBlock[]) {
    // 创建一个临时 Canvas 用于测量文本宽度
    // 这是一个轻量级的操作，不需要真实的像素数据
    const tempCanvas = createCanvas(1, 1)
    const ctx = tempCanvas.getContext('2d')

    let currentY = this.config.padding
    const contentWidth = this.config.maxWidth
    const renderItems: RenderItem[] = []

    for (const block of blocks) {
      const item: RenderItem = {
        block,
        y: currentY,
        height: 0
      }

      if (block.type === 'text' || block.type === 'heading') {
        // 计算文本换行
        const lines = this.wrapText(ctx, block.content, contentWidth, block.style)
        const lineHeightPx = block.style.fontSize * block.style.lineHeight
        item.height = lines.length * lineHeightPx
        item.lines = lines // 保存计算好的行，避免渲染时重复计算
      } else if (block.type === 'image') {
        // 图片高度已经在 preload 阶段计算好了
        item.height = (block as ImageBlock).height || 100
      } else if (block.type === 'divider') {
        item.height = 20
      }

      renderItems.push(item)
      currentY += item.height + block.marginBottom
    }

    const totalHeight = Math.max(currentY + this.config.padding, 100)

    return {
      width: this.config.maxWidth + this.config.padding * 2,
      height: totalHeight,
      items: renderItems
    }
  }

  /**
   * 文本自动换行算法
   *
   * 使用 measureText 确保精确的宽度计算。
   */
  private wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, style: TextStyle): string[] {
    ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`

    // 简单的字符分割，适用于中英文混排
    // 优化：如果需要更完美的英文换行，可以按单词分割，但这里为了兼容性选择按字符
    const chars = text.split('')
    const lines: string[] = []
    let currentLine = ''

    for (const char of chars) {
      const testLine = currentLine + char
      const metrics = ctx.measureText(testLine)

      if (metrics.width > maxWidth && currentLine !== '') {
        lines.push(currentLine)
        currentLine = char
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)

    return lines.length > 0 ? lines : ['']
  }

  /**
   * 渲染最终图片
   */
  private render(layout: { width: number, height: number, items: RenderItem[] }): Buffer {
    const canvas = createCanvas(layout.width, layout.height)
    const ctx = canvas.getContext('2d')

    // 1. 绘制背景
    ctx.fillStyle = this.config.backgroundColor
    ctx.fillRect(0, 0, layout.width, layout.height)

    // 2. 绘制内容
    const startX = this.config.padding

    for (const item of layout.items) {
      const { block, y, lines } = item

      if (block.type === 'text' || block.type === 'heading') {
        ctx.font = `${block.style.fontWeight} ${block.style.fontSize}px ${block.style.fontFamily}`
        ctx.fillStyle = block.style.color
        ctx.textBaseline = 'top' // 统一使用顶部对齐，方便计算

        const lineHeightPx = block.style.fontSize * block.style.lineHeight
        lines?.forEach((line, index) => {
          ctx.fillText(line, startX, y + (index * lineHeightPx))
        })
      }
      else if (block.type === 'image') {
        const imgBlock = block as ImageBlock
        if (imgBlock.image) {
          ctx.drawImage(imgBlock.image, startX, y, imgBlock.width!, imgBlock.height!)
        } else {
          this.drawPlaceholder(ctx, startX, y, imgBlock.width!, imgBlock.height!)
        }
      }
      else if (block.type === 'divider') {
        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(startX, y + 10)
        ctx.lineTo(startX + this.config.maxWidth, y + 10)
        ctx.stroke()
      }
    }

    // 3. 导出 Buffer
    if (this.config.format === 'png') {
      // PNG 是无损格式，不需要 quality 参数
      return canvas.toBuffer('image/png')
    } else if (this.config.format === 'webp') {
      return canvas.toBuffer('image/webp', this.config.quality)
    } else {
      return canvas.toBuffer('image/jpeg', this.config.quality)
    }
  }

  /**
   * 绘制图片加载失败时的占位符
   */
  private drawPlaceholder(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = '#f0f0f0'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#999999'
    ctx.font = '12px Arial'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText('Image Load Failed', x + w / 2, y + h / 2)
    // 恢复 Context 状态
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
  }
}
