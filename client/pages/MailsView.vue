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
                <th style="width: 40px;"></th>
                <th style="width: 150px;" class="sortable" @click="toggleSort('sender')">
                  发件人
                  <span class="sort-icon" :class="getSortClass('sender')">
                    <Icon :name="getSortIcon('sender')" />
                  </span>
                </th>
                <th style="min-width: 200px;" class="sortable" @click="toggleSort('subject')">
                  主题
                  <span class="sort-icon" :class="getSortClass('subject')">
                    <Icon :name="getSortIcon('subject')" />
                  </span>
                </th>
                <th style="width: 120px;" class="sortable" @click="toggleSort('date')">
                  时间
                  <span class="sort-icon" :class="getSortClass('date')">
                    <Icon :name="getSortIcon('date')" />
                  </span>
                </th>
                <th style="width: 90px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="mail in sortedMails"
                :key="mail.id"
                :class="{ unread: !mail.isRead }"
                @click="openMailDetail(mail)"
              >
                <td class="mail-avatar-col" @click.stop>
                  <div
                    class="mail-avatar"
                    :style="{ backgroundColor: getAvatarColor(getSenderName(mail.from)) }"
                    :title="getSenderName(mail.from)"
                  >
                    {{ getAvatarText(getSenderName(mail.from)) }}
                  </div>
                </td>
                <td class="mail-from" data-label="发件人">
                  <div class="sender-info">
                    <div class="sender-name" :class="{ bold: !mail.isRead }">
                      {{ getSenderName(mail.from) }}
                    </div>
                    <div class="sender-email">{{ getSenderEmail(mail.from) }}</div>
                  </div>
                </td>
                <td class="mail-subject" data-label="主题">
                  <div class="subject-wrapper">
                    <div class="subject-text" :class="{ bold: !mail.isRead }">
                      <span v-if="!mail.isRead" class="status-dot"></span>
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
                <td class="mail-date" data-label="时间">
                  <div class="date-cell">{{ formatDate(mail.receivedAt) }}</div>
                </td>
                <td class="mail-actions" data-label="操作" @click.stop>
                  <div class="action-btns">
                    <button class="ml-btn small" @click="forwardMail(mail)" title="转发">
                      <Icon name="share" />
                    </button>
                    <button class="ml-btn small danger" @click="deleteMail(mail)" title="删除">
                      <Icon name="delete" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页控件 - 固定在底部 -->
        <div class="ml-pagination">
          <div class="pagination-left">
            <button
              class="page-btn prev"
              :disabled="pagination.page <= 1"
              @click="goToPage(pagination.page - 1)"
              title="上一页"
            >
              <Icon name="chevron-left" />
              <span>上一页</span>
            </button>
            <button
              class="page-btn next"
              :disabled="pagination.page >= pagination.totalPages"
              @click="goToPage(pagination.page + 1)"
              title="下一页"
            >
              <span>下一页</span>
              <Icon name="chevron-right" />
            </button>
          </div>

          <div class="pagination-center">
            <span class="page-info">
              第 <span class="page-current">{{ pagination.page }}</span> / {{ pagination.totalPages }} 页
              <span class="page-total">（共 {{ pagination.total }} 封）</span>
            </span>
          </div>

          <div class="pagination-right">
            <div class="page-size-selector">
              <span class="selector-label">每页</span>
              <Select
                v-model="pagination.pageSize"
                :options="pageSizeOptions"
                @change="onPageSizeChange"
                size="small"
              />
              <span class="selector-label">封</span>
            </div>
            <div class="page-jumper" v-if="pagination.totalPages > 1">
              <span class="jumper-label">跳至</span>
              <input
                type="number"
                v-model.number="jumpPage"
                :min="1"
                :max="pagination.totalPages"
                @keyup.enter="handleJumpPage"
                class="jump-input"
              />
              <span>页</span>
              <button class="jump-btn" @click="handleJumpPage">GO</button>
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
              <button class="ml-btn" @click="forwardMail(selectedMail)">
                <Icon name="share" /> 转发此邮件
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { mailApi, accountApi } from '../api'
import type { StoredMail, MailAccount, MailAddress } from '../types'
import Icon from '../components/Icon.vue'
import Select from '../components/Select.vue'

const emit = defineEmits(['refresh'])

const loading = ref(false)
const mails = ref<StoredMail[]>([])
const accounts = ref<MailAccount[]>([])
const showDetail = ref(false)

// 获取头像颜色
const getAvatarColor = (name: string) => {
  const colors = ['#1890ff', '#52c41a', '#faad14', '#f56a00', '#7265e6', '#ffbf00', '#00a2ae']
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

// 获取头像文字
const getAvatarText = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : '?'
}

// 获取发件人名称
const getSenderName = (address: MailAddress) => {
  return address.name || address.address.split('@')[0]
}

// 获取发件人邮箱
const getSenderEmail = (address: MailAddress) => {
  return address.address
}
const selectedMail = ref<StoredMail | null>(null)
const contentTab = ref<'text' | 'html'>('text')
const htmlIframe = ref<HTMLIFrameElement | null>(null)

const filters = reactive({
  accountId: undefined as number | undefined,
  isRead: undefined as boolean | undefined,
  isForwarded: undefined as boolean | undefined,
})

// 账号选项
const accountOptions = computed(() => [
  { label: '全部', value: undefined },
  ...accounts.value.map(account => ({
    label: account.name,
    value: account.id
  }))
])

// 已读状态选项
const readStatusOptions = [
  { label: '全部', value: undefined },
  { label: '未读', value: false },
  { label: '已读', value: true }
]

// 转发状态选项
const forwardedOptions = [
  { label: '全部', value: undefined },
  { label: '已转发', value: true },
  { label: '未转发', value: false }
]

// 每页数量选项
const pageSizeOptions = [
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '50', value: 50 },
  { label: '100', value: 100 }
]

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})

// 排序状态
type SortField = 'sender' | 'subject' | 'date' | null
type SortOrder = 'asc' | 'desc'
const sortField = ref<SortField>(null)
const sortOrder = ref<SortOrder>('desc')

// 切换排序
const toggleSort = (field: SortField) => {
  if (sortField.value === field) {
    // 同一字段，切换排序方向
    if (sortOrder.value === 'desc') {
      sortOrder.value = 'asc'
    } else {
      // 已经是升序，取消排序
      sortField.value = null
    }
  } else {
    // 新字段，默认降序
    sortField.value = field
    sortOrder.value = 'desc'
  }
}

// 获取排序图标
const getSortIcon = (field: SortField): string => {
  if (sortField.value !== field) return 'arrow-up-down'
  return sortOrder.value === 'desc' ? 'arrow-down' : 'arrow-up'
}

// 获取排序样式类
const getSortClass = (field: SortField): string => {
  if (sortField.value !== field) return 'inactive'
  return 'active'
}

// 计算排序后的邮件列表
const sortedMails = computed(() => {
  if (!sortField.value) return mails.value

  const sorted = [...mails.value].sort((a, b) => {
    let compareResult = 0

    switch (sortField.value) {
      case 'sender':
        const senderA = getSenderName(a.from).toLowerCase()
        const senderB = getSenderName(b.from).toLowerCase()
        compareResult = senderA.localeCompare(senderB, 'zh-CN')
        break
      case 'subject':
        const subjectA = (a.subject || '').toLowerCase()
        const subjectB = (b.subject || '').toLowerCase()
        compareResult = subjectA.localeCompare(subjectB, 'zh-CN')
        break
      case 'date':
        compareResult = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
        break
    }

    return sortOrder.value === 'desc' ? -compareResult : compareResult
  })

  return sorted
})

// 跳转页码
const jumpPage = ref(1)

const formatAddress = (addr: MailAddress): string => {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address
}

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const loadAccounts = async () => {
  try {
    accounts.value = await accountApi.list()
  } catch (e) {
    console.error('Failed to load accounts:', e)
  }
}

const loadMails = async () => {
  loading.value = true
  try {
    const result = await mailApi.list({
      ...filters,
      page: pagination.page,
      pageSize: pagination.pageSize,
    })
    mails.value = result.items
    pagination.total = result.total
    pagination.totalPages = result.totalPages
  } catch (e) {
    console.error('Failed to load mails:', e)
    alert(`加载失败: ${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

const goToPage = (page: number) => {
  pagination.page = page
  jumpPage.value = page
  loadMails()
}

const onPageSizeChange = () => {
  // 切换每页数量时，重置到第一页
  pagination.page = 1
  jumpPage.value = 1
  loadMails()
}

const handleJumpPage = () => {
  // 校验页码范围
  let targetPage = jumpPage.value
  if (targetPage < 1) targetPage = 1
  if (targetPage > pagination.totalPages) targetPage = pagination.totalPages
  jumpPage.value = targetPage
  goToPage(targetPage)
}

const openMailDetail = async (mail: StoredMail) => {
  selectedMail.value = mail
  // 如果有HTML内容，默认显示HTML，否则显示纯文本
  contentTab.value = mail.htmlContent ? 'html' : 'text'

  showDetail.value = true

  // 标记为已读
  if (!mail.isRead) {
    try {
      await mailApi.markAsRead(mail.id)
      mail.isRead = true
    } catch (e) {
      console.error('Failed to mark as read:', e)
    }
  }
}

const closeDetail = () => {
  showDetail.value = false
  selectedMail.value = null
}

const switchToHtmlTab = () => {
  contentTab.value = 'html'
  // 依赖 iframe @load 事件触发调整
}

// 根据HTML内容宽度自动调整弹窗宽度和高度
const adjustModalSize = () => {
  if (!htmlIframe.value) return

  try {
    const iframeDoc = htmlIframe.value.contentDocument || htmlIframe.value.contentWindow?.document
    if (!iframeDoc) return

    const body = iframeDoc.body
    const html = iframeDoc.documentElement
    if (!body) return

    // 获取内容实际高度
    const bodyHeight = body.scrollHeight
    const htmlHeight = html ? html.scrollHeight : 0
    const contentHeight = Math.max(bodyHeight, htmlHeight)

    const minIframeHeight = 600 // iframe最小高度

    // 设置iframe高度为实际内容高度，让外层容器滚动
    if (htmlIframe.value) {
      const targetHeight = Math.max(minIframeHeight, contentHeight + 40)
      htmlIframe.value.style.height = `${targetHeight}px`
    }
  } catch (e) {
    console.error('Failed to adjust modal size:', e)
  }
}

const forwardMail = async (mail: StoredMail) => {
  try {
    await mailApi.forward(mail.id)
    mail.isForwarded = true
    emit('refresh')
    alert('转发成功')
  } catch (e) {
    console.error('Failed to forward mail:', e)
    alert(`转发失败: ${(e as Error).message}`)
  }
}

const deleteMail = async (mail: StoredMail) => {
  if (!confirm(`确定要删除这封邮件吗？\n\n主题：${mail.subject}`)) {
    return
  }

  try {
    await mailApi.delete(mail.id)
    await loadMails()
    emit('refresh')
  } catch (e) {
    console.error('Failed to delete mail:', e)
    alert(`删除失败: ${(e as Error).message}`)
  }
}

onMounted(() => {
  loadAccounts()
  loadMails()
})
</script>

<style scoped lang="scss">
/* ========== 排序表头样式 ========== */
.sortable {
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;

  &:hover {
    background: var(--ml-hover);
  }
}

.sort-icon {
  display: inline-block;
  margin-left: 4px;
  font-size: 12px;
  opacity: 0.4;
  transition: opacity 0.2s;

  &.active {
    opacity: 1;
    color: var(--ml-primary);
  }
}

/* ========== 基础样式 ========== */
.filter-bar {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    font-size: 13px;
    color: var(--ml-text-secondary);
  }

  .ml-select {
    width: 140px;
  }
}

.ml-table tr.unread {
  font-weight: 500;

  .mail-subject {
    color: var(--ml-primary);
  }
}

.ml-table tr {
  cursor: pointer;
}

.mail-icon {
  text-align: center;
}

.mail-from {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-subject {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-icon {
  margin-left: 4px;
}

.mail-date {
  color: var(--ml-text-secondary);
  font-size: 13px;
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

/* ========== 弹窗样式 ========== */
.ml-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.ml-modal {
  background: var(--ml-bg, #fff);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 900px; /* 默认宽度 */
  max-width: 95vw;
  max-height: 90vh;
}

.ml-modal.is-html {
  width: 1100px; /* HTML模式下使用更宽的窗口 */
  min-height: 70vh; /* 确保HTML模式下有足够的高度 */
}



.ml-modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

.mail-info-sidebar {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid var(--ml-border, #eee);
  display: flex;
  flex-direction: column;
  background: var(--ml-bg-secondary, #f9f9f9);
  padding: 20px;
  overflow-y: auto;
}

.mail-content-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  min-width: 0;
}

.mail-content {
  flex: 1;
  overflow: auto;
  padding: 0;
  position: relative;
}

.text-content {
  padding: 30px;
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.6;
  color: var(--ml-text, #333);
}

.html-content {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* Sidebar elements */
.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.sidebar-title {
  font-size: 18px;
  font-weight: 600;
}

.ml-modal-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--ml-text-secondary, #999);

  &:hover {
    background: rgba(0,0,0,0.05);
    color: var(--ml-text, #333);
  }
}

.content-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--ml-border, #eee);
  padding-bottom: 10px;
}

.tab-btn {
  background: none;
  border: none;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ml-text-secondary, #666);

  &.active {
    background: var(--ml-primary-bg, #e6f7ff);
    color: var(--ml-primary, #1890ff);
  }

  &:hover:not(.active) {
    background: rgba(0,0,0,0.03);
  }
}

.mail-header-info {
  margin-bottom: 20px;
}

.info-row {
  margin-bottom: 12px;
  font-size: 13px;
}

.info-label {
  display: block;
  color: var(--ml-text-secondary, #999);
  margin-bottom: 4px;
}

.info-value {
  display: block;
  color: var(--ml-text, #333);
  word-break: break-all;
}

.attachments-section {
  margin-top: 20px;
  border-top: 1px solid var(--ml-border, #eee);
  padding-top: 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--ml-border, #eee);
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 12px;
  background: #fff;

  .att-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .att-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .att-size {
    color: var(--ml-text-secondary, #999);
    font-size: 11px;
  }
}

.mail-actions {
  margin-top: auto;
  padding-top: 20px;
}

</style>
