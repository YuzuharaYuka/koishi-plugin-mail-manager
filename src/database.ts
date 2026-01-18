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
    unique: [['accountId', 'messageId']], // 组合唯一索引，防止竞态条件导致的重复插入
    indexes: [
      // 优化常用查询的索引
      ['accountId'],
      ['receivedAt'],
      ['isRead'],
      ['isForwarded'],
    ],
  })

  // 转发规则表
  ctx.model.extend('mail_manager.rules', {
    id: 'unsigned',
    name: 'string',
    description: 'text',
    enabled: 'boolean',
    priority: 'unsigned',        // 新增：规则优先级
    accountId: 'unsigned',
    conditionLogic: 'string',    // 新增：条件组合逻辑 (and/or)
    conditions: 'json',
    targets: 'json',
    forwardMode: 'string',
    elements: 'json',
    regexConfig: 'json',
    customCss: 'text',
    renderConfig: 'json',
    failureStrategy: 'string',   // 新增：失败处理策略
    delayMs: 'unsigned',         // 新增：转发延迟
    skipForwarded: 'boolean',    // 新增：跳过已转发
    retryCount: 'unsigned',      // 新增：重试次数
    retryIntervalMs: 'unsigned', // 新增：重试间隔
    createdAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    autoInc: true,
    indexes: [
      ['priority'],  // 优化按优先级排序的查询
      ['enabled'],
    ],
  })
}
