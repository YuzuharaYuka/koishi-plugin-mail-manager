<template>
  <div class="mails-view">
    <!-- 筛选工具栏 -->
    <div class="ml-card filter-card">
      <div class="filter-bar">
        <div class="filter-group">
          <div class="filter-item">
            <label>账号</label>
            <Select
              v-model="filters.accountId"
              :options="accountOptions"
              @change="loadMails"
              placeholder="全部"
            />
          </div>
          <div class="filter-item">
            <label>状态</label>
            <Select
              v-model="filters.isRead"
              :options="readStatusOptions"
              @change="loadMails"
              placeholder="全部"
            />
          </div>
          <div class="filter-item">
            <label>转发</label>
            <Select
              v-model="filters.isForwarded"
              :options="forwardedOptions"
              @change="loadMails"
              placeholder="全部"
            />
          </div>
        </div>
        <button class="ml-btn" @click="loadMails"><Icon name="refresh" /> 刷新</button>
      </div>
    </div>

    <!-- 邮件列表 -->
    <div class="ml-card mail-list-card">
      <div v-if="loading" class="ml-loading">加载中...</div>
      <div v-else-if="mails.length === 0" class="ml-empty">
        <div class="empty-icon"><Icon name="inbox" /></div>
        <div class="empty-text">暂无邮件</div>
      </div>
      <template v-else>
        <!-- 表格滚动区域 -->
        <div class="mail-table-wrapper">
          <table class="ml-table mail-list-table">
            <thead>
              <tr>
                <th class="col-sender sortable" @click="toggleSort('sender')">
                  发件人
                  <span class="sort-icon" :class="getSortClass('sender')">
                    <Icon :name="getSortIcon('sender')" />
                  </span>
                </th>
                <th class="col-subject sortable" @click="toggleSort('subject')">
                  主题
                  <span class="sort-icon" :class="getSortClass('subject')">
                    <Icon :name="getSortIcon('subject')" />
                  </span>
                </th>
                <th class="col-date sortable" @click="toggleSort('date')">
                  时间
                  <span class="sort-icon" :class="getSortClass('date')">
                    <Icon :name="getSortIcon('date')" />
                  </span>
                </th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="mail in sortedMails"
                :key="mail.id"
                :class="{ unread: !mail.isRead }"
                @click="openMailDetail(mail)"
              >
                <td class="col-sender" data-label="发件人">
                  <div class="sender-cell-content">
                    <div
                      class="mail-avatar"
                      :style="{ backgroundColor: getAvatarColor(getSenderName(mail.from)) }"
                      :title="getSenderName(mail.from)"
                    >
                      {{ getAvatarText(getSenderName(mail.from)) }}
                    </div>
                    <div class="sender-info">
                      <div class="sender-name" :class="{ bold: !mail.isRead }">
                        {{ getSenderName(mail.from) }}
                      </div>
                      <div class="sender-email">{{ getSenderEmail(mail.from) }}</div>
                    </div>
                  </div>
                </td>
                <td class="col-subject" data-label="主题">
                  <div class="subject-wrapper">
                    <div class="subject-text" :class="{ bold: !mail.isRead }">
                      <span v-if="!mail.isRead" class="status-dot" title="未读"></span>
                      {{ mail.subject || '(无主题)' }}
                    </div>
                    <div class="subject-snippet">
                      <span v-if="mail.attachments.length > 0" class="attachment-badge">
                        <Icon name="paperclip" /> {{ mail.attachments.length }}
                      </span>
                      <span v-if="mail.isForwarded" class="forward-badge">已转发</span>
                      {{ (mail.textContent || '').slice(0, 150) }}
                    </div>
                  </div>
                </td>
                <td class="col-date" data-label="时间">
                  <div class="date-cell">{{ formatDate(mail.receivedAt) }}</div>
                </td>
                <td class="col-action" data-label="操作" @click.stop>
                  <div class="action-btns">
                    <button class="ml-btn small" @click="openForwardModal(mail)" title="转发">
                      <Icon name="share-2" />
                    </button>
                    <button class="ml-btn small danger" @click="deleteMail(mail)" title="删除">
                      <Icon name="trash-2" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页控件 -->
        <div class="ml-pagination">
          <div class="pagination-left">
            <button
              class="page-btn prev"
              :disabled="pagination.page <= 1"
              @click="goToPage(pagination.page - 1)"
              title="上一页"
            >
              <Icon name="chevron-left" />
            </button>
            <button
              class="page-btn next"
              :disabled="pagination.page >= pagination.totalPages"
              @click="goToPage(pagination.page + 1)"
              title="下一页"
            >
              <Icon name="chevron-right" />
            </button>
            <span class="page-info">
              第 {{ pagination.page }} / {{ pagination.totalPages }} 页（共 {{ pagination.total }} 项）
            </span>
          </div>

          <div class="pagination-right">
            <div class="page-size-selector">
              <Select
                v-model="pagination.pageSize"
                :options="pageSizeOptions"
                @change="onPageSizeChange"
                size="small"
              />
              <span class="selector-unit">封/页</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 邮件详情弹窗 -->
    <div v-if="showDetail && selectedMail" class="ml-modal-mask" @click.self="closeDetail">
      <div class="ml-modal mail-detail-modal" :class="{ 'is-html': contentTab === 'html' }">
        <div class="ml-modal-body mail-detail-body">
          <!-- 左侧：邮件基本信息 -->
          <div class="mail-info-sidebar">
            <!-- 关闭按钮 -->
            <div class="sidebar-header">
              <span class="sidebar-title">邮件详情</span>
              <button class="ml-modal-close" @click="closeDetail"><Icon name="close" /></button>
            </div>

            <!-- 内容切换标签 -->
            <div class="content-tabs">
              <button
                class="tab-btn"
                :class="{ active: contentTab === 'text' }"
                @click="contentTab = 'text'"
              >
                <Icon name="file-text" /> 纯文本
              </button>
              <button
                v-if="selectedMail.htmlContent"
                class="tab-btn"
                :class="{ active: contentTab === 'html' }"
                @click="switchToHtmlTab"
              >
                <Icon name="code" /> HTML
              </button>
            </div>
            <div class="mail-header-info">
              <div class="info-row">
                <span class="info-label">发件人</span>
                <span class="info-value">{{ formatAddress(selectedMail.from) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">收件人</span>
                <span class="info-value">{{ selectedMail.to.map(formatAddress).join(', ') }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">主题</span>
                <span class="info-value">{{ selectedMail.subject }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">时间</span>
                <span class="info-value">{{ formatDate(selectedMail.receivedAt) }}</span>
              </div>
            </div>

            <!-- 附件 -->
            <div v-if="selectedMail.attachments.length > 0" class="attachments-section">
              <div class="section-title"><Icon name="paperclip" /> 附件 ({{ selectedMail.attachments.length }})</div>
              <div class="attachment-list">
                <div v-for="(att, idx) in selectedMail.attachments" :key="idx" class="attachment-item">
                  <Icon name="file-text" />
                  <div class="att-info">
                    <span class="att-name">{{ att.filename }}</span>
                    <span class="att-size">{{ formatSize(att.size) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="mail-actions">
              <button class="ml-btn" @click="openForwardModal(selectedMail)">
                <Icon name="share-2" /> 转发此邮件
              </button>
            </div>
          </div>

          <!-- 右侧：邮件内容 -->
          <div class="mail-content-main">
            <!-- 邮件内容区域 -->
            <div class="mail-content">
              <pre v-if="contentTab === 'text'" class="text-content">{{ selectedMail.textContent || '(无内容)' }}</pre>
              <iframe
                v-else-if="contentTab === 'html'"
                :srcdoc="selectedMail.htmlContent"
                class="html-content"
                sandbox="allow-same-origin"
                ref="htmlIframe"
                @load="adjustModalSize"
              ></iframe>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 手动转发弹窗 -->
    <ForwardModal
      v-model:visible="showForwardModal"
      :mail="forwardMail"
      @forwarded="onForwarded"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { mailApi, accountApi } from '../api'
import type { StoredMail, MailAccount, MailAddress } from '../types'
import Icon from '../components/Icon.vue'
import Select from '../components/Select.vue'
import ForwardModal from '../components/ForwardModal.vue'

const emit = defineEmits(['refresh'])

const loading = ref(false)
const mails = ref<StoredMail[]>([])
const accounts = ref<MailAccount[]>([])
const showDetail = ref(false)
const selectedMail = ref<StoredMail | null>(null)
const contentTab = ref<'text' | 'html'>('text')
const htmlIframe = ref<HTMLIFrameElement | null>(null)

// 手动转发弹窗状态
const showForwardModal = ref(false)
const forwardMail = ref<StoredMail | null>(null)

// 筛选状态
const filters = reactive({
  accountId: undefined as number | undefined,
  isRead: undefined as boolean | undefined,
  isForwarded: undefined as boolean | undefined,
})

// 分页状态
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1
})
const jumpPage = ref(1)

// 排序状态
const sortKey = ref<string>('date')
const sortOrder = ref<'asc' | 'desc'>('desc')

const accountOptions = computed(() => [
  { label: '所有账号', value: undefined },
  ...accounts.value.map(a => ({ label: a.name, value: a.id }))
])

const readStatusOptions = [
  { label: '全部状态', value: undefined },
  { label: '已读', value: true },
  { label: '未读', value: false },
]

const forwardedOptions = [
  { label: '全部', value: undefined },
  { label: '已转发', value: true },
  { label: '未转发', value: false },
]

const pageSizeOptions = [
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
]

// 获取头像颜色
const getAvatarColor = (name: string) => {
  const colors = ['#1890ff', '#52c41a', '#faad14', '#f56a00', '#7265e6', '#ffbf00', '#00a2ae']
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

const getAvatarText = (name: string) => {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

const getSenderName = (from: MailAddress) => {
  return from.name || from.address.split('@')[0]
}

const getSenderEmail = (from: MailAddress) => {
  return from.address
}

const formatAddress = (addr: MailAddress) => {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString()
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// 排序处理
const toggleSort = (key: string) => {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'desc'
  }
}

const getSortIcon = (key: string) => {
  if (sortKey.value !== key) return 'minus' // 或者 space
  return sortOrder.value === 'asc' ? 'chevron-up' : 'chevron-down'
}

const getSortClass = (key: string) => {
  return { active: sortKey.value === key }
}

const sortedMails = computed(() => {
  // 注意：这里仅对当前页排序，理想情况应该是后端排序
  // 假设后端返回的数据已经是按时间倒序的，这里前端排序作为辅助
  const list = [...mails.value]
  list.sort((a, b) => {
    let valA: any = a.receivedAt
    let valB: any = b.receivedAt

    if (sortKey.value === 'subject') {
      valA = a.subject || ''
      valB = b.subject || ''
    } else if (sortKey.value === 'sender') {
      valA = getSenderName(a.from) || ''
      valB = getSenderName(b.from) || ''
    }

    if (valA < valB) return sortOrder.value === 'asc' ? -1 : 1
    if (valA > valB) return sortOrder.value === 'asc' ? 1 : -1
    return 0
  })
  return list
})

const loadMails = async () => {
  loading.value = true
  try {
    // 构造查询参数
    const query = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      accountId: filters.accountId,
      isRead: filters.isRead,
      isForwarded: filters.isForwarded,
    }
    const res = await mailApi.list(query)
    mails.value = res.items
    pagination.total = res.total
    pagination.totalPages = Math.ceil(res.total / pagination.pageSize) || 1
  } catch (e) {
    console.error('Failed to load mails:', e)
    // mock data if api fails (dev mode?)
    // mails.value = []
  } finally {
    loading.value = false
  }
}

const loadAccounts = async () => {
  try {
    accounts.value = await accountApi.list()
  } catch (e) {
    console.error('Failed to load accounts:', e)
  }
}

const goToPage = (page: number) => {
  if (page < 1 || page > pagination.totalPages) return
  pagination.page = page
  loadMails()
}

const onPageSizeChange = () => {
  pagination.page = 1
  loadMails()
}

const handleJumpPage = () => {
  if (jumpPage.value >= 1 && jumpPage.value <= pagination.totalPages) {
    goToPage(jumpPage.value)
  } else {
    jumpPage.value = pagination.page
  }
}

const openMailDetail = async (mail: StoredMail) => {
  selectedMail.value = mail
  // 优先显示HTML内容，如果没有则显示纯文本
  contentTab.value = mail.htmlContent ? 'html' : 'text'
  showDetail.value = true

  // 标记为已读
  if (!mail.isRead) {
    try {
      await mailApi.markAsRead(mail.id)
      mail.isRead = true
      // 更新列表中的状态
      const idx = mails.value.findIndex(m => m.id === mail.id)
      if (idx !== -1) mails.value[idx].isRead = true
      emit('refresh') // 通知父组件（如果是侧边栏模式）
    } catch (e) {
      console.error('Failed to mark read:', e)
    }
  }
}

const closeDetail = () => {
  showDetail.value = false
  selectedMail.value = null
}

const switchToHtmlTab = () => {
  contentTab.value = 'html'
}

const adjustModalSize = () => {
  // 可以在这里根据 iframe 内容调整模态框大小，或者 iframe 自适应
}

const deleteMail = async (mail: StoredMail) => {
  if (!confirm('确定要删除这封邮件吗？')) return
  try {
    await mailApi.delete(mail.id)
    loadMails()
  } catch (e) {
    console.error('Failed to delete mail:', e)
    alert('删除失败')
  }
}

const openForwardModal = (mail: StoredMail) => {
  forwardMail.value = mail
  showForwardModal.value = true
}

const onForwarded = () => {
  // 刷新邮件列表以更新转发状态
  loadMails()
  emit('refresh')
}

onMounted(() => {
  loadAccounts() // 先加载账号，用于筛选
  loadMails()
})
</script>

<style scoped lang="scss">
@use '../styles/variables';

.mails-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    font-size: 13px;
    font-weight: 500;
  }
}

/* 邮件列表样式优化 */
.mail-list-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0; /* 允许 flex item 缩小 */
  padding: 0; /* 让表格贴边 */
  overflow: hidden; /* 防止卡片本身滚动 */
}

.mail-table-wrapper {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.mail-list-table {
  width: 100%;
  table-layout: fixed; // 固定表格布局，严格控制列宽
  border-collapse: separate;
  border-spacing: 0;

  thead {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--ml-bg);

    th {
      padding: 12px 16px;
      font-weight: 600;
      color: var(--ml-text-secondary);
      border-bottom: 2px solid var(--ml-border);
      text-align: left;
      white-space: nowrap;
    }
  }

  tbody tr {
    transition: background 0.2s;
    cursor: pointer;

    &:hover {
      background: var(--ml-hover);

      .action-btns {
        opacity: 1;
      }
    }

    &.unread {
      background: rgba(var(--ml-primary-rgb), 0.04);

      .sender-name, .subject-text {
        font-weight: 700;
        color: var(--ml-text);
      }
    }
  }

  td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--ml-border);
    vertical-align: middle;
    overflow: hidden; // 防止内容溢出单元格
    max-width: 0; // 配合 table-layout: fixed 强制截断
  }
}

/* 列定义 */
.col-sender {
  width: 12%;
  min-width: 180px;
}

.col-subject {
  width: 64%;
  min-width: 300px;
}

.col-date {
  width: 8%;
  min-width: 140px;
  white-space: nowrap;
  text-align: center;
}

.col-action {
  width: 6%;
  min-width: 100px;
  text-align: center;
}

.mail-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
}

.sender-cell-content {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0; // 允许 flex 子项缩小
  max-width: 100%; // 限制最大宽度
}

.sender-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0; // 允许缩小
  flex: 1; // 占据剩余空间

  .sender-name {
    font-size: 14px;
    color: var(--ml-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sender-email {
    font-size: 12px;
    color: var(--ml-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.subject-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0; // 允许缩小
  max-width: 100%; // 限制最大宽度
  overflow: hidden; // 防止溢出

  .subject-text {
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ml-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .subject-snippet {
    font-size: 12px;
    color: var(--ml-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block; // 改为 block 避免 flex 导致的溢出

    // 徽章样式内联显示
    .attachment-badge,
    .forward-badge {
      display: inline-flex;
      vertical-align: middle;
      margin-right: 4px;
    }
  }
}

.date-cell {
  text-align: center;
  font-size: 13px;
  color: var(--ml-text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--ml-primary);
  flex-shrink: 0;
}

.attachment-badge, .forward-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  height: 20px;
  border-radius: 10px;
  background: var(--ml-hover);
  border: 1px solid var(--ml-border);
  font-size: 11px;
  flex-shrink: 0;
}

.forward-badge {
  background: #e6f7ff;
  color: #1890ff;
  border-color: #91d5ff;
}

.action-btns {
  display: inline-flex;
  justify-content: center;
  gap: 6px;
  opacity: 0.6; /* 提高默认可见度 */
  transition: opacity 0.2s;
}

tbody tr:hover .action-btns {
  opacity: 1; /* 悬停时完全显示 */
}

.action-btns .ml-btn.small {
  min-width: 32px;
  height: 32px;
  padding: 6px;
}

/* 分页控件 */
.ml-pagination {
  padding: 12px 16px;
  border-top: 1px solid var(--ml-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--ml-bg-container);
  flex-wrap: wrap;
  gap: 12px;
}

.pagination-left {
  display: flex;
  align-items: center;
  gap: 8px;

  .page-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--ml-border);
    border-radius: 4px;
    background: var(--ml-bg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ml-text);
    transition: var(--ml-transition);

    &:hover:not(:disabled) {
      border-color: var(--ml-primary);
      color: var(--ml-primary);
      background: var(--ml-primary-light);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  .page-info {
    margin-left: 12px;
    font-size: 13px;
    color: var(--ml-text);
    white-space: nowrap;
  }
}

/* 邮件详情侧边栏样式 */
.mail-detail-modal {
  width: 90%;
  height: 90%;
  max-width: 1200px;
  display: flex;
  flex-direction: column;
}

.mail-detail-body {
  flex: 1;
  display: flex;
  padding: 0;
  overflow: hidden;
}

.mail-info-sidebar {
  width: 280px; // 减小侧边栏宽度
  background: var(--ml-bg-base);
  border-right: 1px solid var(--ml-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0; // 防止压缩
}

.sidebar-header {
  padding: 12px 16px; // 减小pading
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--ml-border);
  flex-shrink: 0; // 防止压缩

  .sidebar-title {
    font-size: 15px; // 略微减小字号
    font-weight: 600;
  }
}

.content-tabs {
  padding: 8px 12px; // 减小pading
  display: flex;
  gap: 6px; // 减小间距
  border-bottom: 1px solid var(--ml-border);

  .tab-btn {
    flex: 1;
    padding: 6px;
    border: 1px solid var(--ml-border);
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 13px;

    &.active {
      background: var(--ml-primary);
      border-color: var(--ml-primary);
      color: white;
    }
  }
}

.mail-header-info {
  padding: 12px 16px; // 减小pading
  overflow-y: auto;
  border-bottom: 1px solid var(--ml-border);
  flex-shrink: 0; // 防止压缩

  .info-row {
    margin-bottom: 10px; // 减小间距

    &:last-child {
      margin-bottom: 0;
    }

    .info-label {
      display: block;
      font-size: 11px; // 略微减小
      color: var(--ml-text-secondary);
      margin-bottom: 2px;
    }

    .info-value {
      font-size: 13px; // 略微减小
      color: var(--ml-text);
      word-break: break-all;
    }
  }
}

.attachments-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ml-border);
  overflow-y: auto;
  max-height: 200px; // 限制最大高度

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ml-text);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px; // 减小pading
  border: 1px solid var(--ml-border);
  border-radius: 4px;
  background: var(--ml-bg-container);
  transition: var(--ml-transition);

  &:hover {
    border-color: var(--ml-primary);
    background: var(--ml-bg-hover);
  }

  .att-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .att-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .att-size {
    font-size: 11px;
    color: var(--ml-text-secondary);
  }
}

.mail-actions {
  padding: 12px 16px;
  border-top: 1px solid var(--ml-border);
  margin-top: auto; // 推到底部
  flex-shrink: 0;

  .ml-btn {
    width: 100%;
  }
}

.mail-content-main {
  flex: 1;
  min-width: 0; // 允许收缩
  background: var(--ml-bg-base);
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mail-content {
  flex: 1;
  min-height: 0; // 关键：允许 flex 子项收缩，防止溢出
  background: var(--ml-bg-container);
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  margin: 0;

  .text-content {
    flex: 1;
    padding: 16px;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.6;
    overflow-y: auto;
    color: var(--ml-text);
    margin: 0; // 移除默认 pre margin
  }

  .html-content {
    flex: 1;
    width: 100%;
    height: 100%; // 确保 iframe 填满容器
    border: none;
    display: block;
    margin: 0;
    padding: 0;
  }
}

</style>

