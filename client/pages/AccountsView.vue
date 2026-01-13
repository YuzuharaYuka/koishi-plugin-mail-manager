<template>
  <div class="accounts-view">
    <!-- 工具栏 -->
    <div class="ml-card">
      <div class="toolbar">
        <button class="ml-btn primary" @click="openCreateModal">
          <Icon name="add" /> 添加账号
        </button>
        <button class="ml-btn" @click="loadAccounts">
          <Icon name="refresh" /> 刷新
        </button>
      </div>
    </div>

    <!-- 账号列表 -->
    <div class="ml-card">
      <div v-if="loading" class="ml-loading">加载中...</div>
      <div v-else-if="accounts.length === 0" class="ml-empty">
        <div class="empty-icon"><Icon name="inbox" /></div>
        <div class="empty-text">暂无邮箱账号，点击上方按钮添加</div>
      </div>
      <div v-else class="account-table-wrapper">
        <table class="ml-table">
          <thead>
            <tr>
              <th style="width: 120px;">名称</th>
              <th style="width: 180px;">邮箱地址</th>
              <th style="width: 140px;">服务器</th>
              <th style="width: 100px;">状态</th>
              <th style="width: 80px;">启用</th>
              <th style="width: 130px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td data-label="名称">{{ account.name }}</td>
              <td data-label="邮箱地址">{{ account.email }}</td>
              <td data-label="服务器">{{ account.imapHost }}:{{ account.imapPort }}</td>
              <td data-label="状态">
                <div class="status-cell">
                  <span class="ml-badge" :class="account.status">
                    {{ statusLabels[account.status] }}
                  </span>
                  <span
                    v-if="account.lastError"
                    class="error-hint"
                    :title="account.lastError"
                    @click="showAccountError(account.lastError)"
                  >
                    <Icon name="warning" />
                  </span>
                </div>
              </td>
              <td data-label="启用">
                <div class="switch-cell">
                  <label class="ml-switch">
                    <input
                      type="checkbox"
                      v-model="account.enabled"
                      @change="toggleEnabled(account)"
                    />
                    <span class="slider"></span>
                  </label>
                </div>
              </td>
              <td data-label="操作">
                <div class="action-btns">
                  <button class="ml-btn small" @click="testConnection(account)" title="测试连接">
                    <Icon name="test" />
                  </button>
                  <button
                    class="ml-btn small"
                    @click="openSyncModal(account)"
                    title="同步邮件"
                    :disabled="account.status !== 'connected'"
                  >
                    <Icon name="refresh" />
                  </button>
                  <button class="ml-btn small" @click="openEditModal(account)" title="编辑">
                    <Icon name="edit" />
                  </button>
                  <button class="ml-btn small danger" @click="deleteAccount(account)" title="删除">
                    <Icon name="delete" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <div v-if="showModal" class="ml-modal-mask">
      <div class="ml-modal account-modal">
        <div class="ml-modal-header">
          <span class="ml-modal-title">{{ isEditing ? '编辑账号' : '添加账号' }}</span>
          <button class="ml-modal-close" @click="closeModal"><Icon name="close" /></button>
        </div>
        <div class="ml-modal-body">
          <!-- 错误提示 -->
          <div v-if="formError" class="form-error">
            <Icon name="alert" /> {{ formError }}
          </div>

          <div class="ml-form-group">
            <label class="ml-label">名称 <span class="required">*</span></label>
            <input
              v-model="formData.name"
              class="ml-input"
              :class="{ 'has-error': !formData.name && formTouched.name }"
              placeholder="用于标识的名称（如：工作邮箱）"
              @blur="formTouched.name = true"
            />
          </div>
          <div class="ml-form-group">
            <label class="ml-label">邮箱地址 <span class="required">*</span></label>
            <input
              v-model="formData.email"
              class="ml-input"
              :class="{ 'has-error': !formData.email && formTouched.email }"
              type="email"
              placeholder="example@mail.com"
              @blur="formTouched.email = true"
              @input="autoFillImapHost"
            />
          </div>
          <div class="ml-form-group">
            <label class="ml-label">密码/授权码 <span v-if="!isEditing" class="required">*</span></label>
            <div class="password-input-wrapper">
              <input
                v-model="formData.password"
                class="ml-input"
                :class="{ 'has-error': !isEditing && !formData.password && formTouched.password }"
                :type="showPassword ? 'text' : 'password'"
                placeholder="邮箱密码或授权码"
                @blur="formTouched.password = true"
              />
              <button class="toggle-password-btn" @click="showPassword = !showPassword" tabindex="-1">
                <Icon :name="showPassword ? 'eye' : 'eye-off'" />
              </button>
            </div>
            <div class="ml-help"><Icon name="lightbulb" /> QQ/网易等邮箱请使用授权码，非登录密码</div>
          </div>
          <div class="ml-form-group">
            <label class="ml-label">代理服务器（可选）</label>
            <input
              v-model="formData.proxyUrl"
              class="ml-input"
              placeholder="如: socks5://127.0.0.1:6780"
            />
            <div class="ml-help">
              <Icon name="network" />
              访问 Gmail 等国际邮箱时需要配置代理
            </div>
          </div>
          <div class="ml-form-group">
            <label class="ml-label">IMAP 服务器 <span class="required">*</span></label>
            <input
              v-model="formData.imapHost"
              class="ml-input"
              :class="{ 'has-error': !formData.imapHost && formTouched.imapHost }"
              placeholder="imap.qq.com / imap.163.com / imap.gmail.com"
              @blur="formTouched.imapHost = true"
            />
            <div class="ml-help">常用服务器：QQ: imap.qq.com | 网易: imap.163.com | Gmail: imap.gmail.com</div>
          </div>
          <div class="ml-form-row">
            <div class="ml-form-group" style="flex: 1;">
              <label class="ml-label">端口</label>
              <input v-model.number="formData.imapPort" class="ml-input" type="number" placeholder="993" />
            </div>
            <div class="ml-form-group">
              <label class="ml-label">TLS 加密</label>
              <div class="switch-wrapper">
                <label class="ml-switch">
                  <input v-model="formData.imapTls" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div class="ml-form-group">
              <label class="ml-label">启用</label>
              <div class="switch-wrapper">
                <label class="ml-switch">
                  <input v-model="formData.enabled" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div class="ml-modal-footer">
          <button class="ml-btn" @click="closeModal">取消</button>
          <button class="ml-btn primary" @click="saveAccount" :disabled="saving || !isFormValid">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 同步邮件弹窗 -->
    <div v-if="showSyncModal" class="ml-modal-mask">
      <div class="ml-modal sync-modal">
        <div class="ml-modal-header">
          <span class="ml-modal-title">同步邮件 - {{ syncAccount?.name }}</span>
          <button class="ml-modal-close" @click="closeSyncModal"><Icon name="close" /></button>
        </div>
        <div class="ml-modal-body">
          <div v-if="syncing" class="ml-loading">同步中，请稍候...</div>
          <div v-else-if="syncResult">
            <div class="sync-result success">
              <Icon name="check" />
              <div>
                <div class="result-title">同步完成</div>
                <div class="result-detail">共找到 {{ syncResult.total }} 封邮件，新增 {{ syncResult.new }} 封，已存在 {{ syncResult.existing }} 封</div>
              </div>
            </div>
          </div>
          <div v-else>
            <p class="sync-tip">
              <Icon name="lightbulb" />
              从邮箱服务器重新获取邮件。可用于恢复被删除的邮件。
            </p>
            <div class="sync-warning">
              <Icon name="info" />
              同步大量邮件需要较长时间，请耐心等待。建议首次同步时选择最近 7-30 天的邮件。
            </div>
            <div class="ml-form-group">
              <label class="ml-label">同步范围</label>
              <div class="sync-options">
                <label class="radio-label">
                  <input type="radio" v-model="syncDaysOption" value="all" />
                  <span>同步所有邮件</span>
                </label>
                <label class="radio-label">
                  <input type="radio" v-model="syncDaysOption" value="recent" />
                  <span>同步最近</span>
                </label>
                <input
                  v-if="syncDaysOption === 'recent'"
                  v-model.number="syncDays"
                  class="ml-input"
                  type="number"
                  placeholder="天数"
                  min="1"
                  style="width: 100px; margin-left: 8px;"
                />
                <span v-if="syncDaysOption === 'recent'" style="margin-left: 4px;">天</span>
              </div>
            </div>
            <div class="ml-help">
              <Icon name="info" />
              系统会自动去重，只保存新邮件。同步期间请勿关闭页面。
            </div>
          </div>
        </div>
        <div class="ml-modal-footer">
          <button class="ml-btn" @click="closeSyncModal">{{ syncResult ? '关闭' : '取消' }}</button>
          <button
            v-if="!syncResult"
            class="ml-btn primary"
            @click="syncMails"
            :disabled="syncing || (syncDaysOption === 'recent' && !syncDays)"
          >
            {{ syncing ? '同步中...' : '开始同步' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { send, receive } from '@koishijs/client'
import { accountApi } from '../api'
import type { MailAccount } from '../types'
import Icon from '../components/Icon.vue'

const emit = defineEmits(['refresh'])

const statusLabels: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  error: '错误',
}

// 常见邮箱的 IMAP 服务器映射
const imapHostMap: Record<string, string> = {
  'qq.com': 'imap.qq.com',
  'foxmail.com': 'imap.qq.com',
  '163.com': 'imap.163.com',
  '126.com': 'imap.126.com',
  'yeah.net': 'imap.yeah.net',
  'gmail.com': 'imap.gmail.com',
  'outlook.com': 'outlook.office365.com',
  'hotmail.com': 'outlook.office365.com',
  'live.com': 'outlook.office365.com',
  'sina.com': 'imap.sina.com',
  'sohu.com': 'imap.sohu.com',
  'aliyun.com': 'imap.aliyun.com',
}

const loading = ref(false)
const saving = ref(false)
const accounts = ref<MailAccount[]>([])
const showModal = ref(false)
const isEditing = ref(false)
const editingId = ref<number | null>(null)
const formError = ref('')

const formTouched = reactive({
  name: false,
  email: false,
  password: false,
  imapHost: false,
})

const formData = reactive({
  name: '',
  email: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapTls: true,
  enabled: false,
  proxyUrl: '',  // 添加代理配置字段
})

// 计算表单是否有效
const isFormValid = computed(() => {
  if (!formData.name || !formData.email || !formData.imapHost) return false
  if (!isEditing.value && !formData.password) return false
  return true
})

// 根据邮箱地址自动填充 IMAP 服务器
const autoFillImapHost = () => {
  if (formData.imapHost) return // 已填写则不覆盖
  const email = formData.email
  if (!email.includes('@')) return
  const domain = email.split('@')[1]?.toLowerCase()
  if (domain && imapHostMap[domain]) {
    formData.imapHost = imapHostMap[domain]
  }
}

// 重置表单触碰状态
const resetFormTouched = () => {
  formTouched.name = false
  formTouched.email = false
  formTouched.password = false
  formTouched.imapHost = false
  formError.value = ''
}

const showAccountError = (msg: string) => alert(msg)

const loadAccounts = async () => {
  loading.value = true
  try {
    accounts.value = await accountApi.list()
  } catch (e) {
    console.error('Failed to load accounts:', e)
    alert(`加载失败: ${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

// 处理账号状态变化事件
const handleStatusChange = (data: { accountId: number; status: string; error?: string }) => {
  console.log('[AccountsView] ========== 收到状态变更事件 ==========')
  console.log('[AccountsView] 原始数据:', JSON.stringify(data, null, 2))
  console.log('[AccountsView] 当前账号列表:', accounts.value.map(a => ({ id: a.id, email: a.email, status: a.status })))

  const account = accounts.value.find(a => a.id === data.accountId)
  if (account) {
    console.log('[AccountsView] 找到账号:', account.email)
    console.log('[AccountsView] 状态变更:', account.status, '->', data.status)
    account.status = data.status as MailAccount['status']
    if (data.error) {
      account.lastError = data.error
    } else {
      account.lastError = undefined
    }
    // 通知父组件更新统计（已连接数量可能变化）
    emit('refresh')
    console.log('[AccountsView] 状态更新完成')
  } else {
    console.warn('[AccountsView] 未找到账号 ID:', data.accountId)
    console.warn('[AccountsView] 可用账号 IDs:', accounts.value.map(a => a.id))
  }
  console.log('[AccountsView] ==========================================')
}

const showPassword = ref(false)

// 同步相关状态
const showSyncModal = ref(false)
const syncAccount = ref<MailAccount | null>(null)
const syncing = ref(false)
const syncDaysOption = ref<'all' | 'recent'>('recent')
const syncDays = ref(7)
const syncResult = ref<{ total: number; new: number; existing: number } | null>(null)

const openSyncModal = (account: MailAccount) => {
  if (account.status !== 'connected') {
    alert('账号未连接，请先连接账号')
    return
  }
  syncAccount.value = account
  syncDaysOption.value = 'recent'
  syncDays.value = 7
  syncResult.value = null
  showSyncModal.value = true
}

const closeSyncModal = () => {
  showSyncModal.value = false
  syncAccount.value = null
  syncResult.value = null
}

const syncMails = async () => {
  if (!syncAccount.value) return

  const days = syncDaysOption.value === 'all' ? undefined : syncDays.value

  if (syncDaysOption.value === 'recent' && !days) {
    alert('请输入同步天数')
    return
  }

  syncing.value = true
  try {
    const result = await accountApi.sync(syncAccount.value.id, days)
    syncResult.value = result
    // 刷新邮件列表
    emit('refresh')
  } catch (e) {
    console.error('Failed to sync mails:', e)
    alert(`同步失败: ${(e as Error).message}`)
  } finally {
    syncing.value = false
  }
}

const openCreateModal = () => {
  isEditing.value = false
  editingId.value = null
  showPassword.value = false
  resetFormTouched()
  Object.assign(formData, {
    name: '',
    email: '',
    password: '',
    imapHost: '',
    imapPort: 993,
    imapTls: true,
    enabled: false,
    proxyUrl: '',
  })
  showModal.value = true
}

const openEditModal = (account: MailAccount) => {
  isEditing.value = true
  editingId.value = account.id
  resetFormTouched()
  Object.assign(formData, {
    name: account.name,
    email: account.email,
    password: account.password,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapTls: account.imapTls,
    enabled: account.enabled,
    proxyUrl: account.proxyUrl || '',
  })
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
}

const saveAccount = async () => {
  // 标记所有字段为已触碰
  formTouched.name = true
  formTouched.email = true
  formTouched.password = true
  formTouched.imapHost = true

  if (!isFormValid.value) {
    formError.value = '请填写所有必填项'
    return
  }

  formError.value = ''
  saving.value = true
  try {
    if (isEditing.value && editingId.value) {
      const data: any = { ...formData }
      if (!data.password) {
        delete data.password // 不更新密码
      }
      await accountApi.update(editingId.value, data)
    } else {
      await accountApi.create(formData)
    }
    closeModal()
    await loadAccounts()
    emit('refresh')
  } catch (e) {
    console.error('Failed to save account:', e)
    alert(`保存失败: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

const toggleEnabled = async (account: MailAccount) => {
  // account.enabled is already updated by v-model
  try {
    await accountApi.update(account.id, { enabled: account.enabled })
    await loadAccounts() // 重新加载以获取最新状态
    emit('refresh')
  } catch (e) {
    account.enabled = !account.enabled // Revert on failure
    console.error('Failed to toggle enabled:', e)
    alert(`操作失败: ${(e as Error).message}`)
  }
}

const testConnection = async (account: MailAccount) => {
  try {
    const result = await accountApi.test(account.id)
    alert(result.success ? '连接成功' : `连接失败: ${result.message}`)
  } catch (e) {
    console.error('Failed to test connection:', e)
    alert(`测试失败: ${(e as Error).message}`)
  }
}

const deleteAccount = async (account: MailAccount) => {
  if (!confirm(`确定要删除账号 "${account.name}" 吗？\n\n这将同时删除该账号的所有邮件记录。`)) {
    return
  }

  try {
    await accountApi.delete(account.id)
    await loadAccounts()
    emit('refresh')
  } catch (e) {
    console.error('Failed to delete account:', e)
    alert(`删除失败: ${(e as Error).message}`)
  }
}

onMounted(() => {
  console.log('[AccountsView] 组件已挂载，开始初始化...')
  loadAccounts()

  // 监听状态变化事件
  console.log('[AccountsView] 注册状态变更监听器: mail-manager/account-status-changed')

  // receive 函数会自动在组件卸载时清理监听器
  receive('mail-manager/account-status-changed', (data) => {
    handleStatusChange(data)
  })

  console.log('[AccountsView] 状态变更监听器注册完成')
})

</script>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
}

.ml-btn :deep(.icon) {
  margin-right: 4px;
}

.ml-btn.small :deep(.icon) {
  margin-right: 0;
}

.action-btns {
  display: flex;
  gap: 4px;
  justify-content: center;

  .ml-btn.small {
    min-width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    :deep(.icon) {
      margin: 0;
    }
  }
}

.error-hint {
  margin-left: 4px;
  cursor: help;
  color: #faad14;
  display: inline-flex;
  align-items: center;
}

.error-hint :deep(.icon) {
  width: 1.1em;
  height: 1.1em;
}

.empty-icon :deep(.icon) {
  width: 4em;
  height: 4em;
  opacity: 0.3;
}

/* 账号弹窗样式 */
.account-modal {
  width: 100%;
  max-width: 480px;
}

.form-error {
  background: rgba(255, 77, 79, 0.1);
  border: 1px solid rgba(255, 77, 79, 0.3);
  color: #ff4d4f;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-error :deep(.icon) {
  flex-shrink: 0;
}

.ml-help {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ml-help :deep(.icon) {
  flex-shrink: 0;
  color: #faad14;
}

.switch-wrapper {
  padding-top: 8px;
}

.ml-input.has-error {
  border-color: #ff4d4f;
}

.ml-input.has-error:focus {
  border-color: #ff4d4f;
  box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.2);
}

.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.toggle-password-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  opacity: 0.6;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-password-btn :deep(.icon) {
  width: 1.2em;
  height: 1.2em;
}

.toggle-password-btn:hover {
  opacity: 1;
}

.ml-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ml-modal-close :deep(.icon) {
  width: 1.2em;
  height: 1.2em;
}

/* 同步弹窗样式 */
.sync-modal {
  width: 100%;
  max-width: 450px;
}

.sync-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: rgba(24, 144, 255, 0.1);
  border: 1px solid rgba(24, 144, 255, 0.2);
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.6;
}

.sync-tip :deep(.icon) {
  flex-shrink: 0;
  margin-top: 2px;
  color: #1890ff;
}

.sync-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: rgba(250, 173, 20, 0.1);
  border: 1px solid rgba(250, 173, 20, 0.2);
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.6;
  color: #d48806;
}

.sync-warning :deep(.icon) {
  flex-shrink: 0;
  margin-top: 2px;
  color: #faad14;
}

.sync-options {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.radio-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.radio-label input[type="radio"] {
  cursor: pointer;
}

.sync-result {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.sync-result.success {
  background: rgba(82, 196, 26, 0.1);
  border: 1px solid rgba(82, 196, 26, 0.3);
}

.sync-result :deep(.icon) {
  flex-shrink: 0;
  width: 1.5em;
  height: 1.5em;
  color: #52c41a;
  margin-top: 2px;
}

.result-title {
  font-weight: 600;
  color: #52c41a;
  margin-bottom: 4px;
}

.result-detail {
  font-size: 13px;
  opacity: 0.85;
}

.ml-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
