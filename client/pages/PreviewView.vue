<template>
  <div class="preview-view">
    <!-- 配置区域 -->
    <div class="ml-card config-card">
      <div class="config-row">
        <div class="ml-form-group inline">
          <label class="ml-label">选择邮件</label>
          <Select
            v-model="selectedMailId"
            :options="mailOptions"
            placeholder="请选择邮件..."
            @change="onMailChange"
          />
        </div>
        <div class="ml-form-group inline">
          <label class="ml-label">渲染模式</label>
          <Select
            v-model="renderMode"
            :options="renderModeOptions"
          />
        </div>
        <button
          class="ml-btn primary"
          @click="generatePreview"
          :disabled="!selectedMailId || loading"
        >
          <template v-if="loading">
            生成中...
          </template>
          <template v-else>
            <Icon name="search" /> 生成预览
          </template>
        </button>
      </div>
    </div>

    <!-- 可滚动的内容区域 -->
    <div class="preview-scroll-wrapper">
      <!-- 元素配置 -->
      <div class="ml-card">
        <h3 class="card-title">转发元素配置</h3>
        <div class="element-config-grid">
          <div v-for="(elem, idx) in elements" :key="idx" class="element-config-item">
            <label class="ml-switch">
              <input type="checkbox" v-model="elem.enabled" />
              <span class="slider"></span>
            </label>
            <span class="element-icon">
              <Icon v-if="getIconName(elem.type)" :name="getIconName(elem.type)" />
              <span v-else>{{ getElementIcon(elem.type) }}</span>
            </span>
            <span class="element-name">{{ getElementName(elem.type) }}</span>
            <input
              v-if="elem.type !== 'separator'"
              v-model="elem.label"
              class="ml-input element-label"
              placeholder="标签"
            />
          </div>
        </div>
      </div>

      <!-- 自定义 CSS -->
      <div class="ml-card">
        <div class="card-header">
          <h3 class="card-title">自定义 CSS</h3>
          <button class="ml-btn small" @click="resetCss">重置默认</button>
        </div>
        <div class="css-editor">
          <textarea v-model="customCss" placeholder="输入自定义 CSS 样式..."></textarea>
        </div>
      </div>

      <!-- 预览结果 -->
      <div class="ml-card preview-result">
        <h3 class="card-title">预览结果</h3>
        <div class="preview-tabs">
          <button
            :class="['preview-tab', { active: previewTab === 'elements' }]"
            @click="previewTab = 'elements'"
          >
            <Icon name="list" /> 元素列表
          </button>
          <button
            :class="['preview-tab', { active: previewTab === 'text' }]"
            @click="previewTab = 'text'"
          >
            <Icon name="file-text" /> 文本预览
          </button>
          <button
            :class="['preview-tab', { active: previewTab === 'image' }]"
            @click="previewTab = 'image'"
          >
            <Icon name="image" /> 图片预览
          </button>
        </div>

        <div v-if="!previewData" class="preview-empty">
          <div class="empty-icon"><Icon name="eye" /></div>
          <div class="empty-text">请选择邮件并点击"生成预览"</div>
        </div>

        <div v-else class="preview-content">
          <!-- 文本预览 -->
          <div v-if="previewTab === 'elements' || previewTab === 'text'" class="text-preview">
            <pre class="preview-text-content">{{ previewData.textPreview || '（无文本内容）' }}</pre>
          </div>

          <!-- 图片预览 -->
          <div v-if="previewTab === 'image'" class="image-preview">
            <div v-if="previewData.imagePreview" class="preview-image-container">
              <img :src="'data:image/png;base64,' + previewData.imagePreview" alt="预览图片" class="preview-image" />
            </div>
            <div v-else class="preview-notice">
              <Icon name="image" /> 图片渲染需要 puppeteer 插件支持
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { mailApi, previewApi } from '../api'
import type { StoredMail, ForwardElement, ForwardPreviewResponse } from '../types'
import Icon from '../components/Icon.vue'
import Select from '../components/Select.vue'

interface PreviewElement {
  type: string
  enabled: boolean
  label?: string
  value?: string | string[]
}

// 使用 API 返回的类型
type PreviewData = ForwardPreviewResponse

// 邮件选项（用于 Select 组件）
const mailOptions = computed(() =>
  mails.value.map(m => ({
    label: `[${m.subject || '(无主题)'}] - ${m.from}`,
    value: m.id
  }))
)

// 渲染模式选项
const renderModeOptions = [
  { label: '纯文本', value: 'text' },
  { label: '图片模式', value: 'image' },
  { label: '混合模式', value: 'hybrid' },
]

const getIconName = (type: string): string => {
  const iconMap: Record<string, string> = {
    subject: 'inbox',
    from: 'user',
    to: 'user',
    date: 'clock',
    text: 'file-text',
    html: 'code',
    markdown: 'file-text',
    attachments: 'paperclip',
    separator: 'minus',
    custom: 'edit',
  }
  return iconMap[type] || ''
}

const getElementIcon = (type: string): string => {
  const icons: Record<string, string> = {
    subject: '主题',
    from: '发件人',
    to: '收件人',
    date: '时间',
    text: '文本',
    html: 'HTML',
    markdown: 'MD',
    attachments: '附件',
    separator: '---',
    custom: '自定义',
  }
  return icons[type] || type
}

const getElementName = (type: string): string => {
  const names: Record<string, string> = {
    subject: '主题',
    from: '发件人',
    to: '收件人',
    date: '时间',
    text: '纯文本',
    html: 'HTML 图片',
    markdown: 'Markdown',
    attachments: '附件',
    separator: '分隔线',
    custom: '自定义',
  }
  return names[type] || type
}

const defaultCss = `
.mail-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  max-width: 800px;
  margin: 0 auto;
}

.mail-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e0e0e0;
}

.mail-field {
  margin: 4px 0;
  font-size: 14px;
}

.mail-body {
  color: #333;
  font-size: 14px;
}
`.trim()

const defaultElements: ForwardElement[] = [
  { type: 'subject', enabled: true, label: '主题：', order: 1 },
  { type: 'from', enabled: true, label: '发件人：', order: 2 },
  { type: 'date', enabled: true, label: '时间：', order: 3 },
  { type: 'separator', enabled: true, order: 4 },
  { type: 'text', enabled: true, label: '', order: 5 },
  { type: 'html', enabled: false, label: '', order: 6 },
  { type: 'markdown', enabled: false, label: '', order: 7 },
  { type: 'attachments', enabled: true, label: '', order: 8 },
]

const loading = ref(false)
const mails = ref<StoredMail[]>([])
const selectedMailId = ref<number | null>(null)
const renderMode = ref<'text' | 'image' | 'hybrid'>('text')
const previewTab = ref<'elements' | 'text' | 'image'>('elements')
const elements = reactive(JSON.parse(JSON.stringify(defaultElements)))
const customCss = ref(defaultCss)
const previewData = ref<PreviewData | null>(null)

const loadMails = async () => {
  try {
    const result = await mailApi.list({ page: 1, pageSize: 100 })
    mails.value = result.items
  } catch (e) {
    console.error('Failed to load mails:', e)
  }
}

const onMailChange = () => {
  previewData.value = null
}

const resetCss = () => {
  customCss.value = defaultCss
}

const generatePreview = async () => {
  if (!selectedMailId.value) {
    alert('请先选择一封邮件')
    return
  }

  loading.value = true
  try {
    const result = await previewApi.generate({
      mailId: selectedMailId.value,
      elements: elements.filter((e: ForwardElement) => e.enabled),
      customCss: customCss.value,
      forwardMode: renderMode.value,
      renderConfig: {
        imageWidth: 800,
        backgroundColor: '#ffffff',
        textColor: '#333333',
        fontSize: 14,
        padding: 20,
        showBorder: true,
        borderColor: '#e0e0e0',
      },
    })

    previewData.value = result
    // 根据渲染模式自动切换到合适的预览标签
    if (renderMode.value === 'image' || renderMode.value === 'hybrid') {
      previewTab.value = 'image'
    } else {
      previewTab.value = 'text'
    }
  } catch (e) {
    console.error('Failed to generate preview:', e)
    alert(`生成预览失败: ${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadMails()
})
</script>

<style scoped>
.config-card {
  flex-shrink: 0;

  .config-row {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;

    .ml-form-group.inline {
      margin-bottom: 0;

      .ml-label {
        white-space: nowrap;
        margin-bottom: 6px;
      }
    }

    /* 邮件选择器 - 宽度更大以显示完整邮件标题 */
    .ml-form-group.inline:first-child {
      flex: 2;
      min-width: 280px;
      max-width: 500px;
    }

    /* 渲染模式选择器 - 固定宽度 */
    .ml-form-group.inline:nth-child(2) {
      flex: 0 0 auto;
      min-width: 140px;
      max-width: 160px;

      :deep(.ml-select-wrapper) {
        width: auto;
        display: inline-block;
      }
    }

    .ml-btn {
      flex-shrink: 0;
      white-space: nowrap;
    }
  }
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ml-text);
  margin: 0 0 16px 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;

  .card-title {
    margin: 0;
  }
}

.element-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.element-config-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--ml-hover);
  border-radius: 8px;

  .element-icon {
    font-size: 16px;
    width: 32px;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    :deep(.icon) {
      width: 1.2em;
      height: 1.2em;
    }
  }

  .element-name {
    font-size: 14px;
    color: var(--ml-text);
    min-width: 60px;
  }

  .element-label {
    flex: 1;
    padding: 4px 8px;
    font-size: 13px;
  }
}

.css-editor {
  border: 1px solid var(--ml-border);
  border-radius: 8px;
  overflow: hidden;

  textarea {
    width: 100%;
    min-height: 200px;
    max-height: 400px;
    padding: 12px;
    border: none;
    background: var(--ml-code-bg, #1e1e1e);
    color: var(--ml-code-text, #d4d4d4);
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;

    &:focus {
      outline: none;
    }
  }
}

.preview-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--ml-border);
  padding-bottom: 12px;
}

.preview-tab {
  padding: 8px 16px;
  border: 1px solid var(--ml-border);
  background: var(--ml-bg);
  color: var(--ml-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;

  &:hover {
    background: var(--ml-hover);
    color: var(--ml-text);
  }

  &.active {
    background: var(--ml-primary);
    color: white;
    border-color: var(--ml-primary);
  }
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--ml-text-secondary);

  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  .empty-text {
    font-size: 14px;
  }
}

.elements-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-element {
  padding: 12px 16px;
  background: var(--ml-hover);
  border-radius: 8px;
  border-left: 3px solid var(--ml-primary);

  .element-header {
    margin-bottom: 8px;
  }

  .element-type-badge {
    display: inline-block;
    padding: 2px 8px;
    background: var(--ml-primary);
    color: white;
    font-size: 12px;
    border-radius: 4px;
  }

  .element-content {
    color: var(--ml-text);
    font-size: 14px;
  }

  .element-label-text {
    font-weight: 500;
    color: var(--ml-text-secondary);
    margin-bottom: 4px;
  }

  .element-value {
    word-break: break-word;
  }

  .separator-line {
    border: none;
    border-top: 1px dashed var(--ml-border);
    margin: 8px 0;
  }

  .attachments-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .attachment-item {
    padding: 4px 8px;
    background: var(--ml-bg);
    border-radius: 4px;
    font-size: 13px;
  }

  .no-content {
    color: var(--ml-text-secondary);
    font-style: italic;
  }
}

.text-preview {
  .preview-text-content {
    margin: 0;
    padding: 16px;
    background: var(--ml-hover);
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ml-text);
    max-height: 500px;
    overflow-y: auto;
  }
}

.image-preview {
  .preview-image-container {
    display: flex;
    justify-content: center;
    padding: 20px;
    background: var(--ml-bg-base);
    border-radius: 8px;
  }

  .preview-image {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    box-shadow: var(--ml-shadow-sm);
    display: block;
  }

  .preview-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: var(--ml-hover);
    border-radius: 8px;
    color: var(--ml-text-secondary);
    font-size: 14px;
  }
}
</style>
