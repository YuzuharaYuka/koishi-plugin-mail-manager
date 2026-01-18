/**
 * 密码加密工具模块
 *
 * 使用 AES-256-GCM 加密算法保护敏感数据
 * - 支持密码加密存储
 * - 支持数据迁移（明文 -> 密文）
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const AUTH_TAG_LENGTH = 16 // 128 bits
const SALT_LENGTH = 32

// 加密数据前缀标识
const ENCRYPTED_PREFIX = '$ENC$'

/**
 * 密码管理器
 *
 * 提供密码的加密、解密功能
 * 使用 scrypt 从主密钥派生加密密钥
 */
export class PasswordManager {
  private readonly masterKey: string
  private keyCache: Map<string, Buffer> = new Map()

  constructor(masterKey: string) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error('加密密钥长度不足，至少需要 16 个字符')
    }
    this.masterKey = masterKey
  }

  /**
   * 派生加密密钥
   * 使用 scrypt 算法从主密钥和盐派生
   */
  private deriveKey(salt: Buffer): Buffer {
    const cacheKey = salt.toString('hex')
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!
    }

    const key = scryptSync(this.masterKey, salt, KEY_LENGTH)
    this.keyCache.set(cacheKey, key)
    return key
  }

  /**
   * 加密密码
   *
   * @param plaintext 明文密码
   * @returns 加密后的字符串（包含盐、IV、认证标签和密文）
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return ''

    // 如果已经加密，直接返回
    if (this.isEncrypted(plaintext)) {
      return plaintext
    }

    const salt = randomBytes(SALT_LENGTH)
    const iv = randomBytes(IV_LENGTH)
    const key = this.deriveKey(salt)

    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // 格式: $ENC$<salt>.<iv>.<authTag>.<ciphertext>
    // 全部使用 base64 编码
    const result = [
      ENCRYPTED_PREFIX,
      salt.toString('base64'),
      '.',
      iv.toString('base64'),
      '.',
      authTag.toString('base64'),
      '.',
      encrypted.toString('base64'),
    ].join('')

    return result
  }

  /**
   * 解密密码
   *
   * @param ciphertext 加密的字符串
   * @returns 明文密码
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) return ''

    // 如果不是加密格式，假定为明文（兼容旧数据）
    if (!this.isEncrypted(ciphertext)) {
      return ciphertext
    }

    try {
      // 移除前缀并解析
      const data = ciphertext.slice(ENCRYPTED_PREFIX.length)
      const parts = data.split('.')

      if (parts.length !== 4) {
        throw new Error('加密数据格式无效')
      }

      const [saltB64, ivB64, authTagB64, encryptedB64] = parts
      const salt = Buffer.from(saltB64, 'base64')
      const iv = Buffer.from(ivB64, 'base64')
      const authTag = Buffer.from(authTagB64, 'base64')
      const encrypted = Buffer.from(encryptedB64, 'base64')

      const key = this.deriveKey(salt)
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ])

      return decrypted.toString('utf8')
    } catch (error) {
      throw new Error(`解密失败: ${(error as Error).message}`)
    }
  }

  /**
   * 检查字符串是否已加密
   */
  isEncrypted(text: string): boolean {
    return text?.startsWith(ENCRYPTED_PREFIX) || false
  }

  /**
   * 安全比较两个密码是否相同
   * 用于验证场景
   */
  compare(plaintext: string, encrypted: string): boolean {
    try {
      const decrypted = this.decrypt(encrypted)
      // 使用恒定时间比较防止时序攻击
      if (plaintext.length !== decrypted.length) {
        return false
      }
      let result = 0
      for (let i = 0; i < plaintext.length; i++) {
        result |= plaintext.charCodeAt(i) ^ decrypted.charCodeAt(i)
      }
      return result === 0
    } catch {
      return false
    }
  }
}

// 全局密码管理器实例
let globalPasswordManager: PasswordManager | null = null

/**
 * 初始化密码管理器
 *
 * @param encryptionKey 加密密钥（建议从环境变量或配置读取）
 */
export function initPasswordManager(encryptionKey: string): void {
  globalPasswordManager = new PasswordManager(encryptionKey)
}

/**
 * 获取密码管理器实例
 */
export function getPasswordManager(): PasswordManager | null {
  return globalPasswordManager
}

/**
 * 加密密码（使用全局管理器）
 *
 * @param plaintext 明文密码
 * @returns 加密后的字符串，如果未初始化则返回原文
 */
export function encryptPassword(plaintext: string): string {
  if (!globalPasswordManager) {
    return plaintext
  }
  return globalPasswordManager.encrypt(plaintext)
}

/**
 * 解密密码（使用全局管理器）
 *
 * @param ciphertext 加密的字符串
 * @returns 明文密码
 */
export function decryptPassword(ciphertext: string): string {
  if (!globalPasswordManager) {
    return ciphertext
  }
  return globalPasswordManager.decrypt(ciphertext)
}

/**
 * 检查密码是否已加密（使用全局管理器）
 */
export function isPasswordEncrypted(text: string): boolean {
  if (!globalPasswordManager) {
    return false
  }
  return globalPasswordManager.isEncrypted(text)
}
