/**
 * 核心模块 - 邮件管理
 *
 * 负责邮件的 CRUD 操作、查询和同步
 */

import { $ } from 'koishi'
import type { ParsedMail } from '../parser'
import type {
  StoredMail,
  MailListQuery,
  PaginatedResponse,
} from '../types'
import { convertParsedMail } from '../imap'
import { LogModule } from '../logger'
import {
  TABLE_MAILS,
  activeConnections,
  getContext,
  getLogger,
} from './state'
import { getAccount } from './accounts'

// ============ 类型定义 ============

/** 邮件查询条件类型 */
export interface MailQueryConditions {
  accountId?: number
  isRead?: boolean
  isForwarded?: boolean
  receivedAt?: { $gte?: Date; $lte?: Date; $lt?: Date }
  $or?: Array<{
    subject?: { $regex: string; $options: string }
    'from.address'?: { $regex: string; $options: string }
    textContent?: { $regex: string; $options: string }
  }>
}

// ============ 邮件查询 ============

export async function getMails(query: MailListQuery): Promise<PaginatedResponse<StoredMail>> {
  const ctx = getContext()
  const page = query.page || 1
  const pageSize = query.pageSize || 20
  const conditions = buildMailQueryConditions(query)

  // 统计总数
  const total = await ctx.database
    .eval(TABLE_MAILS, row => $.count(row.id), conditions) as number

  const totalPages = Math.ceil(total / pageSize)

  // 查询数据
  const items = await ctx.database
    .select(TABLE_MAILS)
    .where(conditions)
    .orderBy('receivedAt', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute()

  return { items, total, page, pageSize, totalPages }
}

export async function getMail(id: number): Promise<StoredMail | null> {
  const ctx = getContext()
  const [mail] = await ctx.database.get(TABLE_MAILS, { id })
  return mail || null
}

// ============ 邮件操作 ============

export async function deleteMail(id: number): Promise<void> {
  const ctx = getContext()
  await ctx.database.remove(TABLE_MAILS, { id })
}

export async function batchDeleteMails(accountId?: number, days?: number): Promise<{ deleted: number }> {
  const ctx = getContext()
  const logger = getLogger()
  const conditions: MailQueryConditions = {}

  if (accountId !== undefined) {
    conditions.accountId = accountId
  }

  if (days !== undefined && days > 0) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    conditions.receivedAt = { $lt: cutoffDate }
  }

  try {
    const result = await ctx.database.remove(TABLE_MAILS, conditions)
    logger.info(LogModule.CLEANUP, `删除 ${result.matched} 封邮件`)
    return { deleted: result.matched }
  } catch (err) {
    logger.error(LogModule.CLEANUP, `删除失败`)
    throw err
  }
}

export async function markAsRead(id: number): Promise<void> {
  const ctx = getContext()
  await ctx.database.set(TABLE_MAILS, { id }, { isRead: true })
}

export async function markAsForwarded(mailId: number): Promise<void> {
  const ctx = getContext()
  await ctx.database.set(TABLE_MAILS, { id: mailId }, {
    isForwarded: true,
    forwardedAt: new Date(),
  })
}

/**
 * 创建新邮件记录
 * 用于将新收到的邮件保存到数据库
 */
export async function createMail(accountId: number, parsedMail: ParsedMail): Promise<StoredMail> {
  const ctx = getContext()
  const logger = getLogger()

  if (!validateParsedMail(parsedMail)) {
    throw new Error('无效的邮件数据')
  }

  const converted = convertParsedMail(accountId, parsedMail)

  if (!validateMailData(converted)) {
    throw new Error('邮件数据验证失败')
  }

  const mail = await ctx.database.create(TABLE_MAILS, {
    ...converted,
    createdAt: new Date(),
  })

  logger.debug(LogModule.MAIL, `创建邮件记录: ${mail.subject} (ID: ${mail.id})`)
  return mail
}

// ============ 邮件同步 ============

export async function syncAccountMails(accountId: number, days?: number): Promise<{ total: number; new: number; existing: number }> {
  const logger = getLogger()
  const account = await getAccount(accountId)
  if (!account) throw new Error(`账号不存在: ${accountId}`)

  const connection = activeConnections.get(accountId)
  if (!connection) throw new Error('账号未连接，请先连接账号')

  logger.info(LogModule.SYNC, `同步账号 ${accountId} (${account.email})`)

  const existingMessageIds = await fetchExistingMessageIds(accountId)

  let totalCount = 0
  let newCount = 0
  let existingCount = 0

  try {
    const result = await connection.syncMails(days, async (batchMails) => {
      const { saved, skipped } = await processMailBatch(accountId, batchMails, existingMessageIds)
      newCount += saved
      existingCount += skipped
    })

    totalCount = result.total
    logger.info(LogModule.SYNC, `已同步邮件 ${totalCount} 封 (新增 ${newCount}, 已有 ${existingCount})`)

    return { total: totalCount, new: newCount, existing: existingCount }
  } catch (err) {
    logger.error(LogModule.SYNC, `同步失败`)
    throw err
  }
}

// ============ 辅助函数 ============

function buildMailQueryConditions(query: MailListQuery): MailQueryConditions {
  const conditions: MailQueryConditions = {}

  if (query.accountId) conditions.accountId = query.accountId
  if (typeof query.isRead === 'boolean') conditions.isRead = query.isRead
  if (typeof query.isForwarded === 'boolean') conditions.isForwarded = query.isForwarded

  if (query.startDate || query.endDate) {
    conditions.receivedAt = {}
    if (query.startDate) conditions.receivedAt.$gte = new Date(query.startDate)
    if (query.endDate) conditions.receivedAt.$lte = new Date(query.endDate)
  }

  if (query.keyword) {
    const kw = `%${query.keyword}%`
    conditions.$or = [
      { subject: { $regex: kw, $options: 'i' } },
      { 'from.address': { $regex: kw, $options: 'i' } },
      { textContent: { $regex: kw, $options: 'i' } }
    ]
  }

  return conditions
}

async function fetchExistingMessageIds(accountId: number): Promise<Set<string>> {
  const ctx = getContext()
  const logger = getLogger()

  logger.debug(LogModule.SYNC, '正在加载已有邮件 ID...')
  const existingMails = await ctx.database
    .select(TABLE_MAILS, ['messageId'])
    .where({ accountId })
    .execute()

  const ids = new Set(existingMails.map(m => m.messageId))
  logger.debug(LogModule.SYNC, `已加载 ${ids.size} 个已有邮件`)
  return ids
}

export async function processMailBatch(
  accountId: number,
  batchMails: ParsedMail[],
  existingMessageIds: Set<string>
): Promise<{ saved: number; skipped: number }> {
  const ctx = getContext()
  const logger = getLogger()

  const newMails: Omit<StoredMail, 'id'>[] = []
  let skipped = 0

  for (const mail of batchMails) {
    const converted = convertParsedMail(accountId, mail)

    if (existingMessageIds.has(converted.messageId)) {
      skipped++
      continue
    }

    newMails.push({
      ...converted,
      createdAt: new Date(),
    })
    existingMessageIds.add(converted.messageId)
  }

  if (newMails.length === 0) return { saved: 0, skipped }

  try {
    await ctx.database.upsert(TABLE_MAILS, newMails)
    const saved = newMails.length
    logger.debug(LogModule.SYNC, `已批量插入 ${saved} 封邮件`)
    return { saved, skipped }
  } catch (err) {
    logger.warn(LogModule.SYNC, `批量插入失败，切换到分批插入: ${(err as Error).message}`)

    const CONCURRENT_LIMIT = 10
    let totalSaved = 0
    let totalFailed = 0

    for (let i = 0; i < newMails.length; i += CONCURRENT_LIMIT) {
      const batch = newMails.slice(i, i + CONCURRENT_LIMIT)

      const results = await Promise.allSettled(
        batch.map(mail => ctx.database.create(TABLE_MAILS, mail))
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          totalSaved++
        } else {
          totalFailed++
          const errorMsg = result.reason?.message || ''
          if (!errorMsg.includes('UNIQUE') && !errorMsg.includes('unique') && !errorMsg.includes('duplicate')) {
            logger.warn(LogModule.SYNC, `保存邮件失败: ${errorMsg}`)
          }
        }
      }
    }

    if (totalFailed > 0) {
      logger.info(LogModule.SYNC, `分批插入完成: ${totalSaved} 成功, ${totalFailed} 失败/跳过`)
    }

    return { saved: totalSaved, skipped: skipped + totalFailed }
  }
}

// ============ 邮件验证 ============

export function validateParsedMail(mail: ParsedMail): boolean {
  const logger = getLogger()

  if (!mail) {
    logger.debug(LogModule.SYNC, '邮件对象为空')
    return false
  }

  if (!mail.from || (Array.isArray(mail.from) && mail.from.length === 0)) {
    logger.debug(LogModule.SYNC, '邮件缺少发件人信息')
    return false
  }

  const hasContent = mail.subject || mail.text || mail.html
  if (!hasContent) {
    logger.debug(LogModule.SYNC, '邮件缺少内容（主题/正文/HTML）')
    return false
  }

  return true
}

export function validateMailData(mailData: Omit<StoredMail, 'id' | 'createdAt'>): boolean {
  const logger = getLogger()

  if (!mailData.messageId || mailData.messageId.length === 0) {
    logger.debug(LogModule.SYNC, '邮件缺少 messageId')
    return false
  }

  if (!mailData.from || !mailData.from.address) {
    logger.debug(LogModule.SYNC, '邮件发件人数据无效')
    return false
  }

  // 主题可以为空（某些邮件确实没有主题），但必须是字符串类型
  if (typeof mailData.subject !== 'string') {
    logger.debug(LogModule.SYNC, '邮件主题类型无效')
    return false
  }

  if (!mailData.receivedAt || !(mailData.receivedAt instanceof Date)) {
    logger.debug(LogModule.SYNC, '邮件接收时间无效')
    return false
  }

  return true
}
