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
  getCurrentInstanceId,
  getContext,
  getConfig,
  getNewMailHandler,
  getLogger,
} from './state'

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

  logger.debug(LogModule.SYSTEM, `创建账号 ${account.email}`)

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
  logger.debug(LogModule.SYSTEM, `删除账号 #${id}`)
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
      message: `密码解密失败，请重新配置`,
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

export async function testConnectionWithConfig(data: Partial<CreateMailAccountRequest>): Promise<ConnectionTestResult> {
  const email = data.email?.trim() || ''
  const password = data.password || ''
  const imapHost = data.imapHost?.trim() || ''

  if (!email || !password || !imapHost) {
    return { success: false, message: '测试连接需要邮箱地址、授权码/密码和 IMAP 服务器' }
  }

  const tempAccount: Partial<MailAccount> = {
    name: data.name || '临时测试账号',
    email,
    password,
    imapHost,
    imapPort: data.imapPort ?? 993,
    imapTls: data.imapTls ?? true,
    proxyUrl: data.proxyUrl || undefined,
  }

  const result = await ImapConnection.testConnection(tempAccount)

  return {
    ...result,
    details: {
      host: imapHost,
      port: tempAccount.imapPort!,
      tls: tempAccount.imapTls!,
    },
  }
}

export async function connectAccount(id: number): Promise<void> {
  const ctx = getContext()
  const config = getConfig()
  const logger = getLogger()
  const ownerInstanceId = getCurrentInstanceId()

  const account = await getAccount(id)
  if (!account) {
    throw new Error(`账号不存在: ${id}`)
  }

  account.imapHost = account.imapHost.trim()
  account.email = account.email.trim()

  try {
    account.password = decryptPassword(account.password)
  } catch (e) {
    const errorMsg = `${account.email} 密码解密失败，请重新配置`
    logger.error(LogModule.CONNECT, errorMsg)
    await updateAccountStatus(id, 'error', errorMsg)
    throw new Error(errorMsg)
  }

  // 检查旧连接是否已达到终止状态，如果是则清理
  const existingConnection = activeConnections.get(id)
  if (existingConnection && existingConnection.isTerminallyFailed()) {
    logger.debug(LogModule.CONNECT, `账号 ${id} 的旧连接已终止，将其从 map 中移除并创建新连接`)
    activeConnections.delete(id)
  }

  if (activeConnections.has(id)) {
    logger.debug(LogModule.CONNECT, `账号 ${id} 已连接或正在重连`)
    return
  }

  const connection = new ImapConnection(
    ctx,
    account,
    {
      mailRetentionDays: config.mailRetentionDays,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectBaseInterval: config.reconnectBaseInterval,
      fastReconnectAttempts: config.fastReconnectAttempts,
      fastReconnectInterval: config.fastReconnectInterval,
      reconnectMaxInterval: config.reconnectMaxInterval,
      reconnectJitterRatio: config.reconnectJitterRatio,
      connectionTimeout: config.connectionTimeout,
      healthCheckInterval: config.healthCheckInterval,
      connectivityTestTimeout: config.connectivityTestTimeout,
    },
    // 通过 state 注入的处理器转发新邮件，避免与 forward 静态循环依赖
    async (mail) => {
      if (getCurrentInstanceId() !== ownerInstanceId) {
        return
      }
      const handler = getNewMailHandler()
      if (!handler) {
        logger.warn(LogModule.MAIL, `新邮件处理器未初始化，跳过邮件: ${account.email}`)
        return
      }
      await handler(id, mail)
    },
    (status, error) => {
      if (getCurrentInstanceId() !== ownerInstanceId) {
        return
      }
      updateAccountStatus(id, status, error)
    }
  )

  activeConnections.set(id, connection)

  try {
    await connection.connect()
  } catch (error) {
    // 注意：不要删除连接！
    // ImapConnection 会内部管理重连逻辑，即使初始连接失败，
    // 它还会尝试自动重连。删除它会导致：
    // 1. 后续 connectAccount() 调用会创建新实例（重复连接）
    // 2. 重连计数重置，导致日志中出现"第 1/10 次"而不是递增
    //
    // 只有当连接达到终止状态（disposed 或超过最大重连次数）时才删除。
    // 在下次调用 connectAccount() 时，会通过 isTerminallyFailed() 检查来清理。
    logger.debug(LogModule.CONNECT, `账号 ${id} 初始连接失败，由内部重连逻辑接管: ${(error as Error).message}`)
    // 连接实例会通过 handleConnectionFailure() 触发内部重连
    // 不再 throw error，让调用者知道连接已在处理状态中
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
  let ctx: ReturnType<typeof getContext>
  let logger: ReturnType<typeof getLogger>

  try {
    ctx = getContext()
    logger = getLogger()
  } catch {
    // 卸载/热重载窗口期允许静默跳过，避免旧实例回调抛错。
    return
  }

  try {
    await ctx.database.set(TABLE_ACCOUNTS, { id }, {
      status,
      lastError: error || null,
      updatedAt: new Date(),
    })

    logger.debug(LogModule.SYSTEM, `账号 #${id} -> ${status}${error ? ` (${error})` : ''}`)

    if (!ctx.console) {
      logger.debug(LogModule.SYSTEM, `console 不可用，跳过广播`)
      return
    }

    ctx.console.broadcast('mail-manager/account-status-changed', {
      accountId: id,
      status,
      error: error || null,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    logger.error(LogModule.SYSTEM, `更新状态失败: ${(e as Error).message}`)
  }
}
