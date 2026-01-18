/**
 * HTML 转图片工具 - 使用 Puppeteer
 *
 * 使用 Koishi 的 puppeteer 服务将邮件 HTML 内容转换为图片
 * 支持完整的 CSS 渲染，保留邮件原始样式
 */

import { Context, Logger, h } from 'koishi'
import type { } from '@koishijs/plugin-puppeteer'

const logger = new Logger('mail-manager/html2image')

// --- 配置接口 ---

export interface Html2ImageOptions {
  /** 视口宽度（像素） */
  width?: number
  /** 背景色 */
  backgroundColor?: string
  /** 内边距（像素） */
  padding?: number
  /** 图片质量 (0-100)，仅 jpeg 有效 */
  quality?: number
  /** 输出格式 */
  format?: 'png' | 'jpeg' | 'webp'
  /** 等待时间（毫秒），用于等待图片加载 */
  waitTime?: number
  /** 最大高度限制（像素） */
  maxHeight?: number
}

const DEFAULT_OPTIONS: Required<Html2ImageOptions> = {
  width: 800,
  backgroundColor: '#ffffff',
  padding: 0, // 移除白边
  quality: 90,
  format: 'png',
  waitTime: 2000, // 增加到2秒，给图片更多加载时间
  maxHeight: 10000,
}

// --- 并发控制与缓存 ---

let activeConversions = 0
const MAX_CONCURRENT_CONVERSIONS = 3

const imageCache = new Map<string, { buffer: Buffer; timestamp: number }>()
const CACHE_TTL = 3600000 // 1小时
const MAX_CACHE_SIZE = 30

/**
 * 生成简单的字符串 hash
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

/**
 * 清理过期缓存
 */
function cleanupCache(): void {
  const now = Date.now()
  for (const [key, value] of imageCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      imageCache.delete(key)
    }
  }

  if (imageCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(imageCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE)
    for (const [key] of toRemove) {
      imageCache.delete(key)
    }
  }
}

// --- 主入口函数 ---

/**
 * 将 HTML 转换为图片 Buffer
 *
 * 使用 Koishi 的 puppeteer 服务进行渲染
 * 如果 puppeteer 服务不可用，将抛出错误
 *
 * @param ctx Koishi Context（必须注入了 puppeteer 服务）
 * @param html 原始 HTML 内容
 * @param options 配置项
 */
export async function htmlToImage(
  ctx: Context,
  html: string,
  options: Html2ImageOptions = {}
): Promise<Buffer> {
  // 检查 puppeteer 服务
  if (!ctx.puppeteer) {
    throw new Error('puppeteer 服务不可用，请安装 koishi-plugin-puppeteer')
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }

  // 生成缓存 key
  const cacheKey = simpleHash(html + JSON.stringify(opts))

  // 检查缓存
  const cached = imageCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('HTML to image: cache hit')
    return cached.buffer
  }

  // 并发限制
  while (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    logger.debug(`Waiting for conversion slot (${activeConversions}/${MAX_CONCURRENT_CONVERSIONS})`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  activeConversions++
  let page: any = null

  try {
    // 创建新页面
    page = await ctx.puppeteer.page()

    // 设置视口
    await page.setViewport({
      width: opts.width,
      height: 800, // 初始高度，后续根据内容调整
      deviceScaleFactor: 2, // 2x 分辨率，提高清晰度
    })

    // 构建完整的 HTML 文档
    const fullHtml = buildFullHtml(html, opts)

    // 设置页面内容
    // 使用 domcontentloaded 而不是 networkidle0
    // networkidle0 要求完全没有网络请求，对于外链图片可能永远等不到
    await page.setContent(fullHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 60000, // 增加到60秒
    })

    // 智能等待图片加载
    // 使用单一的全局超时而不是分散的等待
    const imageLoadTimeout = Math.max(opts.waitTime, 3000) // 至少 3 秒
    const imageLoadStart = Date.now()

    try {
      // 检查是否有图片
      const imageCount = await page.evaluate(() => document.images.length)

      if (imageCount > 0) {
        logger.debug(`Found ${imageCount} images, waiting for load (timeout: ${imageLoadTimeout}ms)`)

        // 使用 Promise.race 实现带总体超时的图片加载等待
        await Promise.race([
          // 等待所有图片加载或失败
          page.evaluate(() => {
            return new Promise<void>((resolve) => {
              const images = Array.from(document.images)
              let pending = images.filter(img => !img.complete).length

              if (pending === 0) {
                resolve()
                return
              }

              const checkDone = () => {
                pending--
                if (pending <= 0) resolve()
              }

              images.forEach(img => {
                if (!img.complete) {
                  img.onload = checkDone
                  img.onerror = checkDone
                }
              })
            })
          }),
          // 总体超时
          new Promise<void>(resolve => setTimeout(resolve, imageLoadTimeout))
        ])

        const loadTime = Date.now() - imageLoadStart
        logger.debug(`Image loading completed in ${loadTime}ms`)
      } else {
        logger.debug('No images found in email')
      }
    } catch (err) {
      logger.debug('Image loading check failed:', err.message)
    }

    // 获取内容实际高度
    const bodyHandle = await page.$('body')
    const boundingBox = await bodyHandle?.boundingBox()
    const contentHeight = Math.min(
      Math.ceil(boundingBox?.height || 800),
      opts.maxHeight
    )

    // 调整视口高度以匹配内容
    await page.setViewport({
      width: opts.width,
      height: contentHeight,
      deviceScaleFactor: 2,
    })

    // 截图
    const screenshotOptions: any = {
      type: opts.format,
      fullPage: true,
      omitBackground: false,
    }

    if (opts.format === 'jpeg') {
      screenshotOptions.quality = opts.quality
    }

    const buffer = await page.screenshot(screenshotOptions)

    // 存入缓存
    imageCache.set(cacheKey, { buffer, timestamp: Date.now() })

    // 清理缓存 - 只在接近满时触发，避免频繁清理
    if (imageCache.size >= MAX_CACHE_SIZE) {
      cleanupCache()
    }

    logger.debug(`渲染图片: ${opts.width}x${contentHeight}`)
    return buffer

  } catch (error) {
    logger.error('HTML to Image conversion failed:', error)
    throw error
  } finally {
    // 确保页面被关闭
    if (page) {
      try {
        await page.close()
      } catch (e) {
        // 忽略关闭错误
      }
    }
    activeConversions--
  }
}

/**
 * 构建完整的 HTML 文档
 */
function buildFullHtml(content: string, opts: Required<Html2ImageOptions>): string {
  // 检查内容是否已经是完整的 HTML 文档
  const hasHtmlTag = /<html[\s>]/i.test(content)
  const hasBodyTag = /<body[\s>]/i.test(content)

  if (hasHtmlTag && hasBodyTag) {
    // 已经是完整文档，注入基础样式和图片处理脚本
    let result = content.replace(
      /<head[^>]*>/i,
      `$&
      <style>
        html, body {
          margin: 0;
          padding: ${opts.padding}px;
          background-color: ${opts.backgroundColor};
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        img {
          max-width: 100%;
          height: auto;
          display: inline-block;
        }
        img.img-error {
          border: 1px dashed #ccc;
          background: #f5f5f5;
          padding: 10px;
          text-align: center;
          color: #999;
        }
        table {
          border-collapse: collapse;
          max-width: 100%;
        }
        pre, code {
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      </style>`
    )

    // 在 </body> 前注入图片错误处理脚本
    result = result.replace(
      /<\/body>/i,
      `<script>
        // 为所有图片添加错误处理
        document.querySelectorAll('img').forEach(img => {
          img.onerror = function() {
            this.classList.add('img-error');
            this.alt = '[图片加载失败: ' + (this.alt || this.src.substring(0, 50)) + ']';
          };
        });
      </script>
      $&`
    )

    return result
  }

  // 不是完整文档，包装一下
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: ${opts.padding}px;
      background-color: ${opts.backgroundColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    img {
      max-width: 100%;
      height: auto;
      display: inline-block;
    }
    img.img-error {
      border: 1px dashed #ccc;
      background: #f5f5f5;
      padding: 10px;
      text-align: center;
      color: #999;
    }
    table {
      border-collapse: collapse;
      max-width: 100%;
    }
    td, th {
      padding: 8px;
      border: 1px solid #ddd;
    }
    pre, code {
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    a {
      color: #1a73e8;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    blockquote {
      margin: 10px 0;
      padding: 10px 20px;
      border-left: 4px solid #ddd;
      background: #f9f9f9;
    }
    hr {
      border: none;
      border-top: 1px solid #e0e0e0;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  ${content}
  <script>
    // 为所有图片添加错误处理
    document.querySelectorAll('img').forEach(img => {
      img.onerror = function() {
        this.classList.add('img-error');
        this.alt = '[图片加载失败: ' + (this.alt || this.src.substring(0, 50)) + ']';
      };
    });
  </script>
</body>
</html>`
}

/**
 * 将邮件 HTML 转换为 Koishi 图片元素
 */
export async function mailHtmlToElement(
  ctx: Context,
  html: string,
  options: Html2ImageOptions = {}
): Promise<any> {
  const buffer = await htmlToImage(ctx, html, options)
  const format = options.format || 'png'
  const mimeType = format === 'png' ? 'image/png' :
                   format === 'webp' ? 'image/webp' : 'image/jpeg'
  const base64 = buffer.toString('base64')
  return h.image(`data:${mimeType};base64,${base64}`)
}

/**
 * 检查 puppeteer 服务是否可用
 */
export function isPuppeteerAvailable(ctx: Context): boolean {
  return !!ctx.puppeteer
}
