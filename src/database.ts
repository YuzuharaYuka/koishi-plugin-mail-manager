/**
 * 数据库模型定义
 */

import { Context } from 'koishi'

/** 扩展数据库模型 */
export function extendDatabase(ctx: Context): void {
  // 邮箱账号表
  ctx.model.extend('mail_manager.accounts', {
    id: 'unsigned',
    name: 'string',
    email: 'string',
    password: 'string',
    imapHost: 'string',
    imapPort: 'unsigned',
    imapTls: 'boolean',
    enabled: 'boolean',
    sendImapId: 'boolean',
    proxyUrl: 'string',
    status: 'string',
    lastError: 'text',
    createdAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    autoInc: true,
  })

  // 邮件表
  ctx.model.extend('mail_manager.mails', {
    id: 'unsigned',
    accountId: 'unsigned',
    messageId: 'string',
    from: 'json',
    to: 'json',
    cc: 'json',
    subject: 'string',
    textContent: 'text',
    htmlContent: 'text',
    attachments: 'json',
    receivedAt: 'timestamp',
    isRead: 'boolean',
    isForwarded: 'boolean',
    forwardedAt: 'timestamp',
    createdAt: 'timestamp',
  }, {
    autoInc: true,
  })

  // 转发规则表
  ctx.model.extend('mail_manager.rules', {
    id: 'unsigned',
    name: 'string',
    description: 'text',
    enabled: 'boolean',
    accountId: 'unsigned',
    conditions: 'json',
    targets: 'json',
    elements: 'json',
    customCss: 'text',
    renderConfig: 'json',
    createdAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    autoInc: true,
  })
}
