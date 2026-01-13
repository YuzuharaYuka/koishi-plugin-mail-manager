<template>
  <div class="rules-view">
    <!-- 工具栏 -->
    <div class="ml-card">
      <div class="toolbar">
        <button class="ml-btn primary" @click="openCreateModal">
          <Icon name="add" /> 添加规则
        </button>
        <button class="ml-btn" @click="loadRules">
          <Icon name="refresh" /> 刷新
        </button>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="ml-card">
      <div v-if="loading" class="ml-loading">加载中...</div>
      <div v-else-if="rules.length === 0" class="ml-empty">
        <div class="empty-icon"><Icon name="clipboard" /></div>
        <div class="empty-text">暂无转发规则，点击上方按钮添加</div>
      </div>
      <div v-else class="rule-table-wrapper">
        <table class="ml-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>描述</th>
              <th>条件数</th>
              <th>目标数</th>
              <th>启用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id">
              <td data-label="名称">{{ rule.name }}</td>
              <td data-label="描述">{{ rule.description || '-' }}</td>
              <td data-label="条件数">{{ rule.conditions.length }}</td>
              <td data-label="目标数">{{ rule.targets.length }}</td>
              <td data-label="启用">
                <label class="ml-switch">
                  <input
                    type="checkbox"
                    v-model="rule.enabled"
                    @change="toggleEnabled(rule)"
                  />
                  <span class="slider"></span>
                </label>
              </td>
              <td>
                <div class="action-btns">
                  <button class="ml-btn small" @click="openEditModal(rule)" title="编辑">
                    <Icon name="edit" />
                  </button>
                  <button class="ml-btn small danger" @click="deleteRule(rule)" title="删除">
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
    <div v-if="showModal" class="ml-modal-mask" @click.self="closeModal">
      <div class="ml-modal rule-modal">
        <div class="ml-modal-header">
          <span class="ml-modal-title">{{ isEditing ? '编辑规则' : '添加规则' }}</span>
          <button class="ml-modal-close" @click="closeModal"><Icon name="close" /></button>
        </div>
        <div class="ml-modal-body">
          <!-- 基本信息 -->
          <div class="section-title">基本信息</div>
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
            <select v-model="formData.accountId" class="ml-select">
              <option :value="undefined">所有账号</option>
              <option v-for="account in accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </option>
            </select>
            <div class="ml-help">仅处理指定账号收到的邮件</div>
          </div>

          <div class="ml-divider"></div>

          <!-- 匹配条件 -->
          <div class="section-title">匹配条件</div>
          <div class="ml-condition-editor">
            <div class="condition-list">
              <div v-for="(cond, idx) in formData.conditions" :key="idx" class="condition-item">
                <select v-model="cond.type" class="ml-select condition-type">
                  <option value="all">匹配所有</option>
                  <option value="subject_contains">主题包含</option>
                  <option value="subject_regex">主题正则</option>
                  <option value="from_contains">发件人包含</option>
                  <option value="from_regex">发件人正则</option>
                  <option value="to_contains">收件人包含</option>
                  <option value="body_contains">正文包含</option>
                  <option value="body_regex">正文正则</option>
                </select>
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
          <div class="section-title">转发目标</div>
          <div class="ml-target-selector">
            <div class="target-list">
              <div v-for="(target, idx) in formData.targets" :key="idx" class="target-item">
                <div class="target-info">
                  <select v-model="target.platform" class="ml-select" style="width: 120px;">
                    <option v-for="p in availablePlatforms" :key="p" :value="p">{{ p }}</option>
                  </select>
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

          <!-- 转发元素 -->
          <div class="section-title">转发元素</div>
          <div class="ml-element-selector">
            <div class="element-list">
              <div v-for="(elem, idx) in formData.elements" :key="idx" class="element-item">
                <span class="element-handle">⋮⋮</span>
                <label class="ml-switch element-switch">
                  <input type="checkbox" v-model="elem.enabled" />
                  <span class="slider"></span>
                </label>
                <div class="element-info">
                  <span class="element-type">{{ elementTypeLabels[elem.type] }}</span>
                  <input
                    v-if="elem.type !== 'separator'"
                    v-model="elem.label"
                    class="ml-input element-label-input"
                    placeholder="自定义标签（可选）"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="ml-divider"></div>

          <!-- 自定义样式 -->
          <div class="section-title">
            自定义 CSS（用于 HTML/Markdown 渲染）
            <button class="ml-btn small" style="margin-left: 8px;" @click="resetCss">
              重置默认
            </button>
          </div>
          <div class="ml-css-editor">
            <div class="editor-container">
              <textarea
                v-model="formData.customCss"
                placeholder="输入自定义 CSS 样式..."
              ></textarea>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ruleApi, accountApi, commonApi } from '../api'
import type { ForwardRule, MailAccount, ForwardCondition, ForwardTarget, ForwardElement } from '../types'
import Icon from '../components/Icon.vue'

const emit = defineEmits(['refresh'])

const elementTypeLabels: Record<string, string> = {
  subject: '主题',
  from: '发件人',
  to: '收件人',
  date: '时间',
  text: '纯文本内容',
  html: 'HTML 渲染图片',
  markdown: 'Markdown 渲染图片',
  attachments: '附件列表',
  separator: '分隔线',
  custom: '自定义模板',
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
const saving = ref(false)
const rules = ref<ForwardRule[]>([])
const accounts = ref<MailAccount[]>([])
const availablePlatforms = ref<string[]>(['onebot', 'discord', 'telegram', 'kook'])
const showModal = ref(false)
const isEditing = ref(false)
const editingId = ref<number | null>(null)

const formData = reactive({
  name: '',
  description: '',
  enabled: true,
  accountId: undefined as number | undefined,
  conditions: [] as ForwardCondition[],
  targets: [] as ForwardTarget[],
  elements: [] as ForwardElement[],
  customCss: '',
})

const loadRules = async () => {
  loading.value = true
  try {
    rules.value = await ruleApi.list()
  } catch (e) {
    console.error('Failed to load rules:', e)
    alert(`加载失败: ${(e as Error).message}`)
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

const loadTargets = async () => {
  try {
    const targets = await commonApi.getTargets()
    const platforms = new Set(targets.map(t => t.platform))
    availablePlatforms.value = [...platforms, 'onebot', 'discord', 'telegram', 'kook']
      .filter((v, i, a) => a.indexOf(v) === i)
  } catch (e) {
    console.error('Failed to load targets:', e)
  }
}

const openCreateModal = () => {
  isEditing.value = false
  editingId.value = null
  Object.assign(formData, {
    name: '',
    description: '',
    enabled: true,
    accountId: undefined,
    conditions: [{ type: 'all', value: '', negate: false }],
    targets: [],
    elements: JSON.parse(JSON.stringify(defaultElements)),
    customCss: defaultCss,
  })
  showModal.value = true
}

const openEditModal = (rule: ForwardRule) => {
  isEditing.value = true
  editingId.value = rule.id
  Object.assign(formData, {
    name: rule.name,
    description: rule.description || '',
    enabled: rule.enabled,
    accountId: rule.accountId,
    conditions: rule.conditions.length > 0
      ? JSON.parse(JSON.stringify(rule.conditions))
      : [{ type: 'all', value: '', negate: false }],
    targets: JSON.parse(JSON.stringify(rule.targets)),
    elements: rule.elements.length > 0
      ? JSON.parse(JSON.stringify(rule.elements))
      : JSON.parse(JSON.stringify(defaultElements)),
    customCss: rule.customCss || defaultCss,
  })
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
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

  saving.value = true
  try {
    const data = {
      name: formData.name,
      description: formData.description || undefined,
      enabled: formData.enabled,
      accountId: formData.accountId,
      conditions: formData.conditions,
      targets: formData.targets,
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

    if (isEditing.value && editingId.value) {
      await ruleApi.update(editingId.value, data)
    } else {
      await ruleApi.create(data)
    }
    closeModal()
    await loadRules()
    emit('refresh')
  } catch (e) {
    console.error('Failed to save rule:', e)
    alert(`保存失败: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

const toggleEnabled = async (rule: ForwardRule) => {
  try {
    await ruleApi.update(rule.id, { enabled: rule.enabled })
    // await loadRules()
  } catch (e) {
    rule.enabled = !rule.enabled
    console.error('Failed to toggle enabled:', e)
    alert(`操作失败: ${(e as Error).message}`)
  }
}

const deleteRule = async (rule: ForwardRule) => {
  if (!confirm(`确定要删除规则 "${rule.name}" 吗？`)) {
    return
  }

  try {
    await ruleApi.delete(rule.id)
    await loadRules()
    emit('refresh')
  } catch (e) {
    console.error('Failed to delete rule:', e)
    alert(`删除失败: ${(e as Error).message}`)
  }
}

onMounted(() => {
  loadRules()
  loadAccounts()
  loadTargets()
})
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
}

.action-btns {
  display: flex;
  gap: 4px;
  justify-content: center;

  .ml-btn.small {
    min-width: 32px;
    height: 32px;
    padding: 6px 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    :deep(.icon) {
      margin: 0;
    }
  }
}

.rule-modal {
  width: 100%;
  max-width: 700px;
  max-height: 85vh;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ml-text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
}

.condition-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .condition-type {
    width: 140px;
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

.element-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--ml-hover);
  border-radius: 6px;
  margin-bottom: 8px;

  .element-handle {
    color: var(--ml-text-secondary);
    cursor: grab;
  }

  .element-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;

    .element-type {
      width: 140px;
      flex-shrink: 0;
    }

    .element-label-input {
      flex: 1;
      padding: 4px 8px;
      font-size: 13px;
    }
  }
}

.ml-css-editor {
  .editor-container {
    border: 1px solid var(--ml-border);
    border-radius: 6px;
    overflow: hidden;

    textarea {
      width: 100%;
      min-height: 150px;
      padding: 12px;
      border: none;
      background: #1e1e1e;
      color: #d4d4d4;
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
</style>
