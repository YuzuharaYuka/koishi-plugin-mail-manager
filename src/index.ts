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
import { initPasswordManager } from './utils/crypto'

export const name = 'mail-manager'

export const inject = {
  required: ['database', 'console', 'server'],
  optional: ['puppeteer'],
}

export const usage = `
## 邮件监听与转发

监听邮箱收件并自动转发到聊天频道。

### 快速开始
1. 打开控制台「邮件管理」页面
2. 添加邮箱账号（需 IMAP 支持）
3. 配置转发规则
4. 启用账号开始监听

### 主要功能
- **多账号**：同时监听多个邮箱
- **自动转发**：规则匹配后转发到指定频道
- **多种渲染**：纯文本/图片/混合模式
- **邮件同步**：重新获取已删除的邮件

> 图片渲染需安装 \`puppeteer\` 插件
`

// Re-export Config for external use
export * from './config'
export * from './types'

/**
 * 插件入口
 */
export function apply(ctx: Context, config: Config) {
  const logger = createLogger(ctx)
  setGlobalLogger(logger)
  setDebugMode(config.debug)

  logger.info('', '正在启动...')

  initPasswordManager(config.encryptionKey)
  extendDatabase(ctx)

  ctx.on('ready', async () => {
    try {
      await initCore(ctx, config)
      logger.info('', '启动完成')
    } catch (err) {
      logger.error('', `启动失败: ${(err as Error).message}`)
    }
  })

  registerConsoleApi(ctx, config)
  ctx.console.addEntry({
    dev: resolve(__dirname, '../client/index.ts'),
    prod: resolve(__dirname, '../dist'),
  })

  registerCommands(ctx, config)
  scheduleAutoCleanup(ctx, config)
}
