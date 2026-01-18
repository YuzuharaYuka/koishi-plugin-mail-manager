/**
 * 核心模块 - 账号管理
 *
 * 负责邮箱账号的 CRUD 操作和连接管理
 */

import type {
  MailAccount,
  CreateMailAccountRequest,
  UpdateMailAccountRequest,
  ConnectionTestResult,
} from '../types'
import { ImapConnection } from '../imap'
import { LogModule } from '../logger'
import { encryptPassword, decryptPassword } from '../utils/crypto'
import {
  TABLE_ACCOUNTS,
  TABLE_MAILS,
  activeConnections,
  accountOperationLocks,
  getContext,
  getConfig,
  getLogger,
} from './state'
import { handleNewMail } from './forward'

// ============ 账号查询 ============

export async function getAccounts(): Promise<MailAccount[]> {
  const ctx = getContext()
  const accounts = await ctx.database.get(TABLE_ACCOUNTS, {})
  return accounts.map(account => ({
    ...account,
    status: activeConnections.get(account.id)?.status || account.status,
  }))
}

export async function getAccount(id: number): Promise<MailAccount | null> {
  const ctx = getContext()
  const [account] = await ctx.database.get(TABLE_ACCOUNTS, { id })
  if (!account) return null
  return {
    ...account,
    status: activeConnections.get(id)?.status || account.status,
  }
}

// ============ 账号 CRUD ============

export async function createAccount(data: CreateMailAccountRequest): Promise<MailAccount> {
  const ctx = getContext()
  const logger = getLogger()
  const now = new Date()

  const account = await ctx.database.create(TABLE_ACCOUNTS, {
    name: data.name,
    email: data.email.trim(),
    password: encryptPassword(data.password),
    imapHost: data.imapHost.trim(),
    imapPort: data.imapPort ?? 993,
    imapTls: data.imapTls ?? true,
    proxyUrl: data.proxyUrl || undefined,
    enabled: data.enabled ?? false,
    sendImapId: false,
    status: 'disconnected',
    createdAt: now,
    updatedAt: now,
  })

  logger.info(LogModule.RULE, `创建账号 ${account.email}`)

  if (account.enabled) {
    connectAccount(account.id).catch((error) => {
      logger.error(LogModule.CONNECT, `连接账号 ${account.id} 失败: ${error.message}`)
    })
  }

  return account
}

export async function updateAccount(id: number, data: UpdateMailAccountRequest): Promise<MailAccount> {
  const existing = await fetchAccountById(id)
  if (!existing) {
    throw new Error(`账号不存在: ${id}`)
  }

  const wasEnabled = existing.enabled
  const isEnabled = data.enabled ?? existing.enabled

  await updateAccountInDatabase(id, data)
  await handleAccountStateChange(id, wasEnabled, isEnabled, data)

  return (await fetchAccountById(id))!
}

export async function deleteAccount(id: number): Promise<void> {
  const ctx = getContext()
  const logger = getLogger()

  await disconnectAccount(id)
  await ctx.database.remove(TABLE_MAILS, { accountId: id })
  await ctx.database.remove(TABLE_ACCOUNTS, { id })
  logger.info(LogModule.RULE, `删除账号 ${id}`)
}

// ============ 连接管理 ============

export async function testConnection(id: number): Promise<ConnectionTestResult> {
  const account = await getAccount(id)
  if (!account) {
    return { success: false, message: '账号不存在' }
  }

  account.imapHost = account.imapHost.trim()
  account.email = account.email.trim()

  try {
    account.password = decryptPassword(account.password)
  } catch (e) {
    return {
      success: false,
      message: `无法解密账号密码。如果您更改了加密密钥，请重新配置账号密码。`,
    }
  }

  const result = await ImapConnection.testConnection(account)
  return {
    ...result,
    details: {
      host: account.imapHost,
      port: account.imapPort,
      tls: account.imapTls,
    },
  }
}

export async function connectAccount(id: number): Promise<void> {
  const ctx = getContext()
  const config = getConfig()
  const logger = getLogger()

  const account = await getAccount(id)
  if (!account) {
    throw new Error(`账号不存在: ${id}`)
  }

  account.imapHost = account.imapHost.trim()
  account.email = account.email.trim()

  try {
    account.password = decryptPassword(account.password)
  } catch (e) {
    const errorMsg = `无法解密账号 ${account.email} 的密码。如果您更改了加密密钥，请重新配置账号密码。`
    logger.error(LogModule.CONNECT, errorMsg)
    await updateAccountStatus(id, 'error', errorMsg)
    throw new Error(errorMsg)
  }

  if (activeConnections.has(id)) {
    logger.debug(LogModule.CONNECT, `账号 ${id} 已连接`)
    return
  }

  const connection = new ImapConnection(
    ctx,
    account,
    {
      mailRetentionDays: config.mailRetentionDays,
      autoReconnect: config.autoReconnect,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectInterval: config.reconnectInterval,
      connectionTimeout: config.connectionTimeout,
      healthCheckEnabled: config.healthCheckEnabled,
      healthCheckInterval: config.healthCheckInterval,
      enableConnectivityTest: config.enableConnectivityTest,
      connectivityTestTimeout: config.connectivityTestTimeout,
    },
    // 直接使用导入的 handleNewMail，esbuild 打包后循环依赖会被解决
    (mail) => handleNewMail(id, mail),
    (status, error) => updateAccountStatus(id, status, error)
  )

  activeConnections.set(id, connection)

  try {
    await connection.connect()
  } catch (error) {
    activeConnections.delete(id)
    throw error
  }
}

export async function disconnectAccount(id: number): Promise<void> {
  const connection = activeConnections.get(id)
  if (connection) {
    await connection.disconnect()
    activeConnections.delete(id)
  }

  await updateAccountStatus(id, 'disconnected')
}

// ============ 辅助函数 ============

async function fetchAccountById(id: number): Promise<MailAccount | undefined> {
  const ctx = getContext()
  const [account] = await ctx.database.get(TABLE_ACCOUNTS, { id })
  return account
}

async function updateAccountInDatabase(id: number, data: UpdateMailAccountRequest): Promise<void> {
  const ctx = getContext()
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined && data.name !== '') updateData.name = data.name
  if (data.email !== undefined && data.email !== '') updateData.email = data.email.trim()
  if (data.password !== undefined && data.password !== '') {
    updateData.password = encryptPassword(data.password)
  }
  if (data.imapHost !== undefined && data.imapHost !== '') updateData.imapHost = data.imapHost.trim()
  if (data.imapPort !== undefined) updateData.imapPort = data.imapPort
  if (data.imapTls !== undefined) updateData.imapTls = data.imapTls
  if (data.proxyUrl !== undefined) updateData.proxyUrl = data.proxyUrl || null
  if (data.enabled !== undefined) updateData.enabled = data.enabled
  if (data.sendImapId !== undefined) updateData.sendImapId = data.sendImapId

  await ctx.database.set(TABLE_ACCOUNTS, { id }, updateData)
}

async function handleAccountStateChange(
  id: number,
  wasEnabled: boolean,
  isEnabled: boolean,
  data: UpdateMailAccountRequest
): Promise<void> {
  const logger = getLogger()
  const hasConfigChanged = data.imapHost || data.imapPort || data.password || data.proxyUrl !== undefined || data.sendImapId !== undefined

  // 获取前序锁（如果存在）
  const previousLock = accountOperationLocks.get(id) || Promise.resolve()

  // 创建当前操作的 Promise
  const operation = (async () => {
    // 等待前序操作完成
    await previousLock.catch(() => {})

    // 执行实际操作
    try {
      if (wasEnabled && !isEnabled) {
        await disconnectAccount(id).catch(e =>
          logger.error(LogModule.CONNECT, `断开账号 ${id} 失败: ${e.message}`)
        )
      } else if (!wasEnabled && isEnabled) {
        await connectAccount(id).catch(e =>
          logger.error(LogModule.CONNECT, `连接账号 ${id} 失败: ${e.message}`)
        )
      } else if (isEnabled && hasConfigChanged) {
        await disconnectAccount(id).catch(() => {})
        await connectAccount(id).catch(e =>
          logger.error(LogModule.CONNECT, `重连账号 ${id} 失败: ${e.message}`)
        )
      }
    } catch (e) {
      logger.error(LogModule.CONNECT, `账号 ${id} 状态变更处理失败: ${(e as Error).message}`)
    }
  })()

  // 在 await 之前设置锁
  accountOperationLocks.set(id, operation)

  try {
    await operation
  } finally {
    // 只有当锁仍然是当前操作时才删除，防止删除新操作的锁
    const currentLock = accountOperationLocks.get(id)
    if (currentLock === operation) {
      accountOperationLocks.delete(id)
    }
  }
}

export async function updateAccountStatus(id: number, status: MailAccount['status'], error?: string): Promise<void> {
  const ctx = getContext()
  const logger = getLogger()

  try {
    await ctx.database.set(TABLE_ACCOUNTS, { id }, {
      status,
      lastError: error || null,
      updatedAt: new Date(),
    })

    logger.info(LogModule.SYSTEM, `[状态更新] 账号 ${id} 状态变更为: ${status}${error ? ` (错误: ${error})` : ''}`)

    if (!ctx.console) {
      logger.warn(LogModule.SYSTEM, `[状态更新] console 服务不可用，无法广播事件`)
      return
    }

    ctx.console.broadcast('mail-manager/account-status-changed', {
      accountId: id,
      status,
      error: error || null,
      timestamp: new Date().toISOString(),
    })

    logger.debug(LogModule.SYSTEM, `[状态更新] 已广播状态变更事件: accountId=${id}, status=${status}`)
  } catch (e) {
    logger.error(LogModule.SYSTEM, `更新账号状态失败: ${(e as Error).message}`)
  }
}
