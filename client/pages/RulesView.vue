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
              <th class="col-name">名称</th>
              <th class="col-mode">转发模式</th>
              <th class="col-conditions">匹配条件</th>
              <th class="col-targets">转发目标</th>
              <th class="col-enabled">启用</th>
              <th class="col-action">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id">
              <td data-label="名称" class="col-name">
                <div class="rule-name">{{ rule.name }}</div>
                <div v-if="rule.description" class="rule-desc">{{ rule.description }}</div>
              </td>
              <td data-label="模式" class="col-mode">
                <span class="mode-badge" :class="getModeBadgeClass(rule)">
                  {{ getModeLabel(rule) }}
                </span>
              </td>
              <td data-label="条件" class="col-conditions">
                <div class="conditions-preview">
                  <div
                    v-for="(cond, index) in getConditionsSummary(rule)"
                    :key="index"
                    class="condition-tag"
                  >
                    {{ cond }}
                  </div>
                  <div v-if="rule.conditions.length > 2" class="condition-more">
                    +{{ rule.conditions.length - 2 }}
                  </div>
                </div>
              </td>
              <td data-label="目标" class="col-targets">
                <div class="targets-preview">
                  <div class="target-summary">
                    转发至 {{ rule.targets.length }} 个目标
                  </div>
                  <div class="target-examples">
                    {{ getTargetsSummary(rule) }}
                  </div>
                </div>
              </td>
              <td data-label="启用" class="col-enabled">
                <label class="ml-switch">
                  <input
                    type="checkbox"
                    v-model="rule.enabled"
                    @change="toggleEnabled(rule)"
                  />
                  <span class="slider"></span>
                </label>
              </td>
              <td data-label="操作" class="col-action">
                <div class="action-btns">
                  <button class="ml-btn small" @click="openEditModal(rule)" title="编辑">
                    <Icon name="edit-2" />
                  </button>
                  <button class="ml-btn small danger" @click="deleteRule(rule)" title="删除">
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
    <RuleEditModal
      v-model:visible="showModal"
      :rule="editingRule"
      :accounts="accounts"
      :available-platforms="availablePlatforms"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ruleApi, accountApi, commonApi } from '../api'
import type { ForwardRule, MailAccount, ForwardMode } from '../types'
import Icon from '../components/Icon.vue'
import RuleEditModal from '../components/RuleEditModal.vue'

const emit = defineEmits(['refresh'])

// 模式标签映射
const modeLabels: Record<string, string> = {
  text: '文本',
  image: '图片',
  hybrid: '混合',
}

const loading = ref(false)
const rules = ref<ForwardRule[]>([])
const accounts = ref<MailAccount[]>([])
const availablePlatforms = ref<string[]>(['onebot', 'discord', 'telegram', 'kook'])
const showModal = ref(false)
const editingRule = ref<ForwardRule | null>(null)

const getModeLabel = (rule: ForwardRule) => {
  const mode = detectForwardMode(rule)
  return modeLabels[mode] || '文本'
}

const getModeBadgeClass = (rule: ForwardRule) => {
  const mode = detectForwardMode(rule)
  return `mode-${mode}`
}

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

const conditionTypeMap: Record<string, string> = {
  all: '所有邮件',
  subject_contains: '主题包含',
  subject_regex: '主题匹配',
  from_contains: '发件人包含',
  from_regex: '发件匹配',
  to_contains: '收件人包含',
  body_contains: '正文包含',
  body_regex: '正文匹配',
}

const getConditionsSummary = (rule: ForwardRule): string[] => {
  if (rule.conditions.length === 0) return ['无条件']
  return rule.conditions.slice(0, 2).map(c => {
    if (c.type === 'all') return '所有邮件'
    const label = conditionTypeMap[c.type] || c.type
    const val = c.value.length > 10 ? c.value.slice(0, 10) + '...' : c.value
    return `${c.negate ? '不' : ''}${label} "${val}"`
  })
}

const getTargetsSummary = (rule: ForwardRule): string => {
  if (rule.targets.length === 0) return '无目标'
  const first = rule.targets[0]
  const platform = first.platform
  const target = first.channelId.startsWith('private:')
    ? `用户 ${first.channelId.slice(8)}`
    : `群/频道 ${first.channelId}`
  return `${platform}: ${target}${rule.targets.length > 1 ? ' 等...' : ''}`
}

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
  editingRule.value = null
  showModal.value = true
}

const openEditModal = (rule: ForwardRule) => {
  editingRule.value = rule
  showModal.value = true
}

const handleSaved = async () => {
  await loadRules()
  emit('refresh')
}

const toggleEnabled = async (rule: ForwardRule) => {
  try {
    await ruleApi.update(rule.id, { enabled: rule.enabled })
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

.rule-name {
  font-weight: 500;
  font-size: 14px;
}

.rule-desc {
  font-size: 12px;
  color: var(--ml-text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.mode-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.mode-badge.mode-text {
  background: #e3f2fd;
  color: #1976d2;
}

.mode-badge.mode-image {
  background: #fff3e0;
  color: #f57c00;
}

.mode-badge.mode-hybrid {
  background: #e8f5e9;
  color: #388e3c;
}

.action-btns {
  display: inline-flex;
  gap: 4px;
  justify-content: center;

  .ml-btn.small {
    min-width: 32px;
    height: 32px;
    padding: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    :deep(.icon) {
      margin: 0;
    }
  }
}

/* 列表列宽优化 - 使用flex布局 */
.rule-table-wrapper {
  overflow-x: auto;

  .ml-table {
    min-width: 700px;
    table-layout: fixed;
  }
}

.col-name { width: 18%; min-width: 120px; }
.col-mode { width: 10%; min-width: 70px; text-align: center; }
.col-conditions { width: 28%; min-width: 160px; }
.col-targets { width: 24%; min-width: 140px; }
.col-enabled { width: 10%; min-width: 60px; text-align: center; }
.col-action { width: 10%; min-width: 90px; text-align: center; }

/* 条件预览样式 */
.conditions-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.condition-tag {
  font-size: 12px;
  background: var(--ml-hover);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--ml-text-secondary);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.condition-more {
  font-size: 12px;
  color: var(--ml-text-secondary);
  align-self: center;
}

/* 目标预览样式 */
.targets-preview {
  font-size: 13px;
}

.target-summary {
  color: var(--ml-text);
  margin-bottom: 2px;
}

.target-examples {
  font-size: 12px;
  color: var(--ml-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

</style>

