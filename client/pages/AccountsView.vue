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
              <th class="col-name">名称</th>
              <th class="col-email">邮箱地址</th>
              <th class="col-server">服务器</th>
              <th class="col-status">状态</th>
              <th class="col-enabled">启用</th>
              <th class="col-action">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td data-label="名称" class="col-name">{{ account.name }}</td>
              <td data-label="邮箱地址" class="col-email">{{ account.email }}</td>
              <td data-label="服务器" class="col-server">
                <div class="server-info">
                  <span>{{ account.imapHost }}</span>
                  <span class="server-port">:{{ account.imapPort }}</span>
                </div>
              </td>
              <td data-label="状态" class="col-status">
                <div class="status-cell">
                  <span class="status-dot" :class="account.status"></span>
                  <span class="status-text">{{ statusLabels[account.status] }}</span>
                  <span
                    v-if="account.lastError"
                    class="error-hint"
                    :title="account.lastError"
                    @click="showAccountError(account.lastError)"
                  >
                    <Icon name="alert-circle" />
                  </span>
                </div>
              </td>
              <td data-label="启用" class="col-enabled">
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
              <td data-label="操作" class="col-action">
                <div class="action-btns">
                  <button class="ml-btn small" @click="testConnection(account)" title="测试连接">
                    <Icon name="activity" />
                  </button>
                  <button
                    class="ml-btn small"
                    @click="openSyncModal(account)"
                    title="同步邮件"
                    :disabled="account.status !== 'connected'"
                  >
                    <Icon name="refresh-cw" />
                  </button>
                  <button class="ml-btn small" @click="openEditModal(account)" title="编辑">
                    <Icon name="edit-2" />
                  </button>
                  <button class="ml-btn small danger" @click="deleteAccount(account)" title="删除">
                    <Icon name="trash-2" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <AccountEditModal
      v-model:visible="showModal"
      :account="editingAccount"
      @saved="handleSaved"
    />

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
import AccountEditModal from '../components/AccountEditModal.vue'

const emit = defineEmits(['refresh'])

const statusLabels: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  error: '错误',
}

const loading = ref(false)
const accounts = ref<MailAccount[]>([])
const showModal = ref(false)
const editingAccount = ref<MailAccount | null>(null)

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
  const account = accounts.value.find(a => a.id === data.accountId)
  if (account) {
    account.status = data.status as MailAccount['status']
    if (data.error) {
      account.lastError = data.error
    } else {
      account.lastError = undefined
    }
    // 通知父组件更新统计（已连接数量可能变化）
    emit('refresh')
  }
}

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
  editingAccount.value = null
  showModal.value = true
}

const openEditModal = (account: MailAccount) => {
  editingAccount.value = account
  showModal.value = true
}

const handleSaved = async () => {
  await loadAccounts()
  emit('refresh')
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
  loadAccounts()

  // 监听状态变化事件
  // receive 函数会自动在组件卸载时清理监听器
  receive('mail-manager/account-status-changed', (data) => {
    handleStatusChange(data)
  })
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
  justify-content: flex-start;

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

/* 列宽控制 */
.col-name { width: 15%; min-width: 100px; }
.col-email { width: 22%; min-width: 150px; }
.col-server { width: 18%; min-width: 120px; }
.col-status { width: 15%; min-width: 90px; }
.col-enabled { width: 10%; min-width: 70px; text-align: center; }
.col-action { width: 20%; min-width: 160px; text-align: center; }

/* 操作按钮组 */
.action-btns {
  display: inline-flex;
  gap: 6px;
  justify-content: center;
}

.action-btns .ml-btn.small {
  min-width: 32px;
  height: 32px;
  padding: 6px;
}

/* 表格内元素样式 */
.server-info {
  font-family: monospace;
  font-size: 13px;
  color: var(--ml-text-secondary);
}

.server-port {
  opacity: 0.5;
}

.status-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d9d9d9;
}

.status-dot.connected { background: #52c41a; box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.2); }
.status-dot.connecting { background: #1890ff; animation: pulse 1.5s infinite; }
.status-dot.disconnected { background: #d9d9d9; }
.status-dot.error { background: #ff4d4f; }

@keyframes pulse {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.9); }
  100% { opacity: 1; transform: scale(1); }
}

.status-text {
  font-size: 13px;
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
