<template>
  <div v-if="visible" class="ml-modal-mask" @click.self="closeModal">
    <div class="ml-modal rule-modal">
      <div class="ml-modal-header">
        <span class="ml-modal-title">{{ isEditing ? '编辑规则' : '添加规则' }}</span>
        <button class="ml-modal-close" @click="closeModal"><Icon name="close" /></button>
      </div>
      <div class="ml-modal-body">
        <!-- 基本信息 -->
        <div class="section-title"><Icon name="clipboard" /> 基本信息</div>
        <div class="ml-form-group">
          <label class="ml-label">规则名称 <span class="required">*</span></label>
          <input v-model="formData.name" class="ml-input" placeholder="为规则起一个名称" />
        </div>
        <div class="ml-form-group">
          <label class="ml-label">描述</label>
          <input v-model="formData.description" class="ml-input" placeholder="规则描述（可选）" />
        </div>
        <div class="ml-form-group">
          <label class="ml-label">绑定账号</label>
          <Select
            v-model="formData.accountId"
            :options="accountOptions"
            placeholder="所有账号"
          />
          <div class="ml-help">仅处理指定账号收到的邮件</div>
        </div>

        <div class="ml-divider"></div>

        <!-- 匹配条件 -->
        <div class="section-title"><Icon name="target" /> 匹配条件</div>
        <div class="ml-condition-editor">
          <div class="condition-list">
            <div v-for="(cond, idx) in formData.conditions" :key="idx" class="condition-item">
              <Select
                v-model="cond.type"
                :options="conditionTypeOptions"
                size="small"
                class="condition-type"
              />
              <input
                v-if="cond.type !== 'all'"
                v-model="cond.value"
                class="ml-input condition-value"
                placeholder="匹配值"
              />
              <label v-if="cond.type !== 'all'" class="condition-negate">
                <input type="checkbox" v-model="cond.negate" />
                取反
              </label>
              <button
                v-if="formData.conditions.length > 1"
                class="ml-btn small danger"
                @click="removeCondition(idx)"
                title="移除"
              >
                <Icon name="close" />
              </button>
            </div>
          </div>
          <button class="ml-btn small" style="margin-top: 8px;" @click="addCondition">
            <Icon name="add" /> 添加条件
          </button>
        </div>

        <div class="ml-divider"></div>

        <!-- 转发目标 -->
        <div class="section-title"><Icon name="map-pin" /> 转发目标</div>
        <div class="ml-target-selector">
          <div class="target-list">
            <div v-for="(target, idx) in formData.targets" :key="idx" class="target-item">
              <div class="target-info">
                <Select
                  v-model="target.platform"
                  :options="platformOptions"
                  size="small"
                  style="width: 120px;"
                />
                <input
                  v-model="target.selfId"
                  class="ml-input"
                  placeholder="Bot ID"
                  style="width: 120px; margin-left: 8px;"
                />
                <input
                  v-model="target.channelId"
                  class="ml-input"
                  placeholder="频道/群组 ID"
                  style="flex: 1; margin-left: 8px;"
                />
              </div>
              <button class="ml-btn small danger" @click="removeTarget(idx)" title="移除"><Icon name="close" /></button>
            </div>
          </div>
          <button class="ml-btn small" style="margin-top: 8px;" @click="addTarget">
            <Icon name="add" /> 添加目标
          </button>
          <div class="ml-help">
            频道 ID 格式：群组直接填 ID，私聊填 private:用户ID
          </div>
        </div>

        <div class="ml-divider"></div>

        <!-- 转发模式 -->
        <div class="section-title"><Icon name="send" /> 转发模式</div>
        <div class="forward-mode-selector">
          <div
            class="mode-option"
            :class="{ active: formData.forwardMode === 'text' }"
            @click="formData.forwardMode = 'text'"
          >
            <div class="mode-icon-wrapper"><Icon name="file-text" /></div>
            <div class="mode-content">
              <div class="mode-name">文本模式</div>
              <div class="mode-desc">将邮件内容转换为纯文本发送，可筛选要发送的信息元素，支持正则匹配内容</div>
            </div>
            <div class="mode-check" v-if="formData.forwardMode === 'text'"><Icon name="check" /></div>
          </div>
          <div
            class="mode-option"
            :class="{ active: formData.forwardMode === 'image' }"
            @click="formData.forwardMode = 'image'"
          >
            <div class="mode-icon-wrapper"><Icon name="image" /></div>
            <div class="mode-content">
              <div class="mode-name">图片模式</div>
              <div class="mode-desc">将邮件原始内容（包括样式）渲染为图片发送，保持邮件原有格式</div>
            </div>
            <div class="mode-check" v-if="formData.forwardMode === 'image'"><Icon name="check" /></div>
          </div>
          <div
            class="mode-option"
            :class="{ active: formData.forwardMode === 'hybrid' }"
            @click="formData.forwardMode = 'hybrid'"
          >
            <div class="mode-icon-wrapper"><Icon name="layers" /></div>
            <div class="mode-content">
              <div class="mode-name">混合模式</div>
              <div class="mode-desc">摘要信息以文字发送，邮件正文渲染为图片，兼顾信息提取和内容完整性</div>
            </div>
            <div class="mode-check" v-if="formData.forwardMode === 'hybrid'"><Icon name="check" /></div>
          </div>
        </div>

        <!-- 文本模式 / 混合模式下显示元素选择 -->
        <div v-if="formData.forwardMode !== 'image'" class="ml-form-section">
          <div class="section-subtitle">选择要转发的信息元素</div>
          <div class="element-selector">
            <div v-for="(elem, idx) in textModeElements" :key="idx" class="element-chip"
                 :class="{ active: elem.enabled }" @click="elem.enabled = !elem.enabled">
              <Icon :name="getElementIconName(elem.type)" class="chip-icon-svg" />
              <span class="chip-label">{{ getElementLabel(elem.type) }}</span>
              <Icon v-if="elem.enabled" name="check" class="chip-check-icon" />
            </div>
          </div>
          <div class="ml-help">点击选择或取消要包含在转发消息中的元素</div>

          <!-- 正则匹配配置（仅文本模式） -->
          <div v-if="formData.forwardMode === 'text'" class="regex-config">
            <div class="section-subtitle">
              <Icon name="regex" /> 正则内容提取（可选）
            </div>
            <div class="ml-help" style="margin-bottom: 12px;">
              使用正则表达式从邮件正文中提取特定内容，留空则转发完整正文
            </div>
            <div class="regex-input-group">
              <input
                v-model="formData.bodyRegex"
                class="ml-input"
                placeholder="正则表达式，例如: 验证码[：:]\s*(\d{6})"
              />
              <Select
                v-model="formData.regexFlags"
                :options="regexFlagOptions"
                size="small"
                style="width: 120px;"
              />
            </div>
            <div class="ml-form-group" style="margin-top: 8px;">
              <label class="ml-label">提取模板</label>
              <input
                v-model="formData.regexTemplate"
                class="ml-input"
                placeholder="使用 $1, $2 等引用捕获组，例如: 您的验证码是: $1"
              />
              <div class="ml-help">若不填写模板，将返回完整匹配结果或第一个捕获组</div>
            </div>
          </div>
        </div>

        <!-- 图片模式 / 混合模式下显示 CSS 配置 -->
        <div v-if="formData.forwardMode !== 'text'" class="ml-form-section">
          <div class="section-subtitle">
            自定义 CSS 样式
            <button class="ml-btn small" style="margin-left: 8px;" @click="resetCss">
              重置默认
            </button>
          </div>
          <div class="ml-css-editor">
            <div class="editor-container">
              <textarea
                v-model="formData.customCss"
                placeholder="输入自定义 CSS 样式来调整图片渲染效果..."
              ></textarea>
            </div>
          </div>
        </div>

      </div>
      <div class="ml-modal-footer">
        <button class="ml-btn" @click="closeModal">取消</button>
        <button class="ml-btn primary" @click="saveRule" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ruleApi } from '../api'
import type { ForwardRule, MailAccount, ForwardCondition, ForwardTarget, ForwardElement, ForwardMode } from '../types'
import Icon from './Icon.vue'
import Select from './Select.vue'

const props = defineProps<{
  visible: boolean
  rule: ForwardRule | null
  accounts: MailAccount[]
  availablePlatforms: string[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved'): void
}>()

const saving = ref(false)

const isEditing = computed(() => !!props.rule)

// 账号选项（用于 Select 组件）
const accountOptions = computed(() => [
  { label: '所有账号', value: undefined },
  ...props.accounts.map(a => ({ label: a.name, value: a.id }))
])

// 平台选项（用于 Select 组件）
const platformOptions = computed(() =>
  props.availablePlatforms.map(p => ({ label: p, value: p }))
)

// 条件类型选项
const conditionTypeOptions = [
  { label: '匹配所有邮件', value: 'all' },
  { label: '主题包含', value: 'subject_contains' },
  { label: '主题正则', value: 'subject_regex' },
  { label: '发件人包含', value: 'from_contains' },
  { label: '发件人正则', value: 'from_regex' },
  { label: '收件人包含', value: 'to_contains' },
  { label: '正文包含', value: 'body_contains' },
  { label: '正文正则', value: 'body_regex' },
]

// 正则标志选项
const regexFlagOptions = [
  { label: '默认', value: '' },
  { label: '忽略大小写', value: 'i' },
  { label: '全局匹配', value: 'g' },
  { label: '全局+忽略', value: 'gi' },
]

// 元素类型标签映射
const elementLabels: Record<string, string> = {
  subject: '主题',
  from: '发件人',
  to: '收件人',
  date: '时间',
  body: '邮件正文',
  text: '纯文本正文',
  html: 'HTML 正文',
  markdown: 'Markdown 正文',
  attachments: '附件列表',
  separator: '分隔线',
  custom: '自定义',
}

// 元素图标名称映射（使用 Icon 组件）
const elementIconNames: Record<string, string> = {
  subject: 'mail',
  from: 'user',
  to: 'users',
  date: 'calendar',
  body: 'file-text',
  text: 'file-text',
  html: 'code',
  markdown: 'file-text',
  attachments: 'paperclip',
  separator: 'minus',
  custom: 'code',
}

const defaultCss = `/* ========== 容器与基础样式 ========== */
.mail-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
  background: #fff;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  box-sizing: border-box;
}

/* ========== 邮件头部区域 ========== */
.mail-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.mail-subject {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 12px;
  line-height: 1.4;
  word-break: break-word;
}

.mail-field {
  display: flex;
  align-items: flex-start;
  margin: 6px 0;
  font-size: 13px;
}

.mail-field-label {
  flex-shrink: 0;
  width: 56px;
  color: #888;
  font-weight: 500;
}

.mail-field-value {
  flex: 1;
  color: #333;
  word-break: break-word;
}

/* ========== 邮件正文 ========== */
.mail-body {
  color: #333;
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
}

.mail-body img {
  max-width: 100%;
  height: auto;
}

.mail-body a {
  color: #1677ff;
  text-decoration: none;
}

/* ========== 附件区域 ========== */
.mail-attachments {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e8e8e8;
}

.mail-attachment {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  margin: 4px;
  background: #f5f5f5;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 13px;
  color: #595959;
}`.trim()

const defaultTextElements: ForwardElement[] = [
  { type: 'subject', enabled: true, label: '主题：', order: 1 },
  { type: 'from', enabled: true, label: '发件人：', order: 2 },
  { type: 'date', enabled: true, label: '时间：', order: 3 },
  { type: 'separator', enabled: true, order: 4 },
  { type: 'body', enabled: true, label: '', order: 5 },
  { type: 'attachments', enabled: false, label: '', order: 6 },
]

const formData = reactive({
  name: '',
  description: '',
  enabled: true,
  accountId: undefined as number | undefined,
  conditions: [] as ForwardCondition[],
  targets: [] as ForwardTarget[],
  forwardMode: 'text' as ForwardMode,
  elements: [] as ForwardElement[],
  customCss: '',
  bodyRegex: '',
  regexFlags: '',
  regexTemplate: '',
})

// 计算属性：文本模式下的元素列表
const textModeElements = computed(() => {
  return formData.elements.filter(e =>
    ['subject', 'from', 'to', 'date', 'body', 'separator', 'attachments'].includes(e.type)
  )
})

const getElementLabel = (type: string) => elementLabels[type] || type
const getElementIconName = (type: string) => elementIconNames[type] || 'file-text'

// 检测转发模式（向后兼容旧规则）
const detectForwardMode = (rule: ForwardRule): ForwardMode => {
  if (rule.forwardMode) {
    return rule.forwardMode
  }
  const hasHtmlOrMd = rule.elements.some(
    e => e.enabled && (e.type === 'html' || e.type === 'markdown')
  )
  return hasHtmlOrMd ? 'image' : 'text'
}

watch(() => props.visible, (newVal) => {
  if (newVal) {
    if (props.rule) {
      const rule = props.rule
      const detectedMode = detectForwardMode(rule)

      let elements = rule.elements.length > 0
        ? JSON.parse(JSON.stringify(rule.elements))
        : JSON.parse(JSON.stringify(defaultTextElements))

      // 向后兼容
      if (!rule.forwardMode && elements.length > 0) {
        const hasBody = elements.some((e: ForwardElement) => e.type === 'body')
        if (!hasBody) {
          const hasText = elements.some((e: ForwardElement) => e.type === 'text' && e.enabled)
          const hasHtml = elements.some((e: ForwardElement) => e.type === 'html' && e.enabled)
          if (hasText || hasHtml) {
            const maxOrder = Math.max(...elements.map((e: ForwardElement) => e.order))
            elements.push({ type: 'body', enabled: true, label: '', order: maxOrder + 1 })
          }
        }
      }

      const regexConfig = (rule as any).regexConfig || {}

      Object.assign(formData, {
        name: rule.name,
        description: rule.description || '',
        enabled: rule.enabled,
        accountId: rule.accountId,
        conditions: rule.conditions.length > 0
          ? JSON.parse(JSON.stringify(rule.conditions))
          : [{ type: 'all', value: '', negate: false }],
        targets: JSON.parse(JSON.stringify(rule.targets)),
        forwardMode: detectedMode,
        elements,
        customCss: rule.customCss || defaultCss,
        bodyRegex: regexConfig.pattern || '',
        regexFlags: regexConfig.flags || '',
        regexTemplate: regexConfig.template || '',
      })
    } else {
      Object.assign(formData, {
        name: '',
        description: '',
        enabled: true,
        accountId: undefined,
        conditions: [{ type: 'all', value: '', negate: false }],
        targets: [],
        forwardMode: 'text',
        elements: JSON.parse(JSON.stringify(defaultTextElements)),
        customCss: defaultCss,
        bodyRegex: '',
        regexFlags: '',
        regexTemplate: '',
      })
    }
  }
})

const closeModal = () => {
  emit('update:visible', false)
}

const addCondition = () => {
  formData.conditions.push({ type: 'subject_contains', value: '', negate: false })
}

const removeCondition = (idx: number) => {
  formData.conditions.splice(idx, 1)
}

const addTarget = () => {
  formData.targets.push({ platform: 'onebot', selfId: '', channelId: '' })
}

const removeTarget = (idx: number) => {
  formData.targets.splice(idx, 1)
}

const resetCss = () => {
  formData.customCss = defaultCss
}

const saveRule = async () => {
  if (!formData.name) {
    alert('请填写规则名称')
    return
  }

  if (formData.targets.length === 0) {
    alert('请至少添加一个转发目标')
    return
  }

  // 验证正则表达式语法
  if (formData.bodyRegex) {
    try {
      new RegExp(formData.bodyRegex, formData.regexFlags)
    } catch (e) {
      alert(`正则表达式语法错误: ${(e as Error).message}`)
      return
    }
  }

  saving.value = true
  try {
    const data: any = {
      name: formData.name,
      description: formData.description || undefined,
      enabled: formData.enabled,
      accountId: formData.accountId,
      conditions: formData.conditions,
      targets: formData.targets,
      forwardMode: formData.forwardMode,
      elements: formData.elements,
      customCss: formData.customCss,
      renderConfig: {
        imageWidth: 800,
        backgroundColor: '#ffffff',
        textColor: '#333333',
        fontSize: 14,
        padding: 20,
        showBorder: true,
        borderColor: '#e0e0e0',
      },
    }

    if (formData.bodyRegex) {
      data.regexConfig = {
        pattern: formData.bodyRegex,
        flags: formData.regexFlags,
        template: formData.regexTemplate,
      }
    }

    if (isEditing.value && props.rule) {
      await ruleApi.update(props.rule.id, data)
    } else {
      await ruleApi.create(data)
    }
    emit('saved')
    closeModal()
  } catch (e) {
    console.error('Failed to save rule:', e)
    alert(`保存失败: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.rule-modal {
  width: 100%;
  max-width: 750px;
  max-height: 90vh;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ml-text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-subtitle {
  font-size: 13px;
  font-weight: 500;
  color: var(--ml-text-secondary);
  margin: 16px 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.condition-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .condition-type {
    width: 160px;
    flex-shrink: 0;
  }

  .condition-value {
    flex: 1;
  }

  .condition-negate {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--ml-text-secondary);
    flex-shrink: 0;
  }
}

.target-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .target-info {
    flex: 1;
    display: flex;
    align-items: center;
  }
}

/* 转发模式选择器 */
.forward-mode-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-option {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border: 2px solid var(--ml-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--ml-primary);
    background: rgba(var(--ml-primary-rgb), 0.05);
  }

  &.active {
    border-color: var(--ml-primary);
    background: rgba(var(--ml-primary-rgb), 0.1);
  }
}

.mode-icon-wrapper {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 14px;
  background: var(--ml-hover);
  border-radius: 8px;
  flex-shrink: 0;

  :deep(.icon) {
    width: 24px;
    height: 24px;
    color: var(--ml-primary);
  }
}

.mode-option.active .mode-icon-wrapper {
  background: var(--ml-primary);

  :deep(.icon) {
    color: white;
  }
}

.mode-content {
  flex: 1;
}

.mode-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ml-text);
  margin-bottom: 4px;
}

.mode-desc {
  font-size: 12px;
  color: var(--ml-text-secondary);
  line-height: 1.4;
}

.mode-check {
  color: var(--ml-primary);

  :deep(.icon) {
    width: 20px;
    height: 20px;
  }
}

/* 元素选择器 */
.element-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.element-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border: 1px solid var(--ml-border);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;

  &:hover {
    border-color: var(--ml-primary);
  }

  &.active {
    background: var(--ml-primary);
    border-color: var(--ml-primary);
    color: white;
  }
}

.chip-icon-svg {
  width: 16px;
  height: 16px;
  margin-right: 6px;
}

.chip-label {
  font-size: 13px;
}

.chip-check-icon {
  width: 14px;
  height: 14px;
  margin-left: 6px;
}

/* 正则配置区域 */
.regex-config {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--ml-border);
}

.regex-input-group {
  display: flex;
  gap: 8px;

  .ml-input {
    flex: 1;
  }
}

.ml-form-section {
  margin-top: 16px;
  padding: 16px;
  background: var(--ml-hover);
  border-radius: 8px;
}

.ml-css-editor {
  .editor-container {
    border: 1px solid var(--ml-border);
    border-radius: 6px;
    overflow: hidden;

    textarea {
      width: 100%;
      min-height: 200px;
      max-height: 350px;
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

.ml-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ml-modal-close :deep(.icon) {
  width: 1.2em;
  height: 1.2em;
}

.ml-divider {
  height: 1px;
  background: var(--ml-border);
  margin: 20px 0;
}
</style>
