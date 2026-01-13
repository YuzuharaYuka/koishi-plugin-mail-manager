import { Context } from 'koishi'
import { resolve } from 'path'
import { } from '@koishijs/plugin-console'
import { } from '@koishijs/plugin-server'

import { extendDatabase } from './database'
import { initCore, setDebugMode } from './core'
import { registerConsoleApi } from './api'
import { createLogger, setGlobalLogger } from './logger'
import { Config } from './config'
import { registerCommands } from './commands'
import { scheduleAutoCleanup } from './cleanup'

export const name = 'mail-manager'

export const inject = {
  required: ['database', 'console', 'server'],
}

export const usage = `
## 邮件管理插件

本插件用于监听邮箱收件，并支持将邮件内容转发到指定的聊天频道。

### 功能特性

- 📧 **多账号管理**：支持同时监听多个邮箱账户
- 💾 **邮件存储**：自动保存接收到的邮件到数据库
- 🔄 **自动转发**：根据规则自动将邮件转发到指定频道
- 🎨 **自定义样式**：支持自定义 CSS 渲染邮件内容
- 🖼️ **多种渲染模式**：支持纯文本、HTML 图片、Markdown 图片
- ✨ **元素选择**：自定义选择要转发的邮件元素（主题、发件人、正文等）
- 🔁 **邮件同步**：支持从邮箱服务器重新获取已删除的邮件
- 🗑️ **批量清理**：支持批量删除指定时间范围的邮件

### 使用说明

1. 在控制台中打开「邮件管理」页面
2. 添加邮箱账号（需要 IMAP 支持）
3. 配置转发规则
4. 启用账号即可开始监听

### 邮件同步功能

当邮件被删除后,你可以通过「同步」功能重新从邮箱服务器获取邮件：
- 点击账号的「同步」按钮
- 可选择同步最近 N 天的邮件，或同步所有邮件
- 系统会自动去重，只保存新邮件

### HTML 转图片功能

插件支持将邮件 HTML 内容转换为图片，方便转发到不支持富文本的平台：
- 使用 @napi-rs/canvas 原生渲染，无需外部依赖
- 在转发规则中选择「HTML 图片」渲染模式
- 自动处理邮件样式，优化显示效果

### 配置说明

- **邮件保留天数**：默认为 0（永久保留）。设置大于 0 的值后，系统会自动清理过期邮件
- **自动清理**：默认关闭。启用后会按照保留天数定期清理过期邮件
`

// Re-export Config for external use
export * from './config'
export * from './types'

/**
 * Plugin entry point.
 * Orchestrates the initialization of all plugin components.
 */
export function apply(ctx: Context, config: Config) {
  // 1. Initialize Logging
  const logger = createLogger(ctx)
  setGlobalLogger(logger)
  setDebugMode(config.debug)

  // 2. Setup Database
  extendDatabase(ctx)

  // 3. Initialize Core Logic
  // We start this asynchronously to not block the plugin loading
  initCore(ctx, config).catch(err => {
    logger.error('', `Initialization failed: ${err.message}`)
  })

  // 4. Register Console API & UI
  registerConsoleApi(ctx, config)
  ctx.console.addEntry({
    dev: resolve(__dirname, '../client/index.ts'),
    prod: resolve(__dirname, '../dist'),
  })

  // 5. Register Commands
  registerCommands(ctx, config)

  // 6. Schedule Background Tasks
  scheduleAutoCleanup(ctx, config)
}
