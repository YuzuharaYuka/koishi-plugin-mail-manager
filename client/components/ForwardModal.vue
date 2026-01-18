<template>
  <div v-if="visible" class="ml-modal-mask" @click.self="closeModal">
    <div class="ml-modal forward-modal">
      <div class="ml-modal-header">
        <span class="ml-modal-title">转发邮件</span>
        <button class="ml-modal-close" @click="closeModal"><Icon name="close" /></button>
      </div>
      <div class="ml-modal-body">
        <!-- 邮件信息摘要 -->
        <div class="mail-summary" v-if="mail">
          <div class="summary-row">
            <span class="summary-label">主题</span>
            <span class="summary-value">{{ mail.subject || '(无主题)' }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">发件人</span>
            <span class="summary-value">{{ formatAddress(mail.from) }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">时间</span>
            <span class="summary-value">{{ formatDate(mail.receivedAt) }}</span>
          </div>
        </div>

        <div class="ml-divider"></div>

        <!-- 转发方式选择 -->
        <div class="section-title"><Icon name="send" /> 转发方式</div>
        <div class="forward-mode-tabs">
          <button
            class="mode-tab"
            :class="{ active: forwardMode === 'rule' }"
            @click="forwardMode = 'rule'"
          >
            <Icon name="clipboard" />
            使用现有规则
          </button>
          <button
            class="mode-tab"
            :class="{ active: forwardMode === 'quick' }"
            @click="forwardMode = 'quick'"
          >
            <Icon name="zap" />
            快速转发
          </button>
        </div>

        <!-- 规则选择模式 -->
        <div v-if="forwardMode === 'rule'" class="rule-select-section">
          <div class="ml-form-group">
            <label class="ml-label">选择转发规则</label>
            <Select
              v-model="selectedRuleId"
              :options="ruleSelectOptions"
              placeholder="请选择规则..."
            />
          </div>
          <div v-if="selectedRule" class="rule-info">
            <div class="rule-info-item">
              <Icon name="map-pin" />
              <span>{{ selectedRule.targets.length }} 个转发目标</span>
            </div>
            <div class="rule-info-item">
              <Icon :name="getModeIcon(selectedRule.forwardMode)" />
              <span>{{ getModeLabel(selectedRule.forwardMode) }}</span>
            </div>
          </div>
          <div v-if="enabledRules.length === 0" class="ml-empty small">
            <Icon name="inbox" />
            <span>暂无可用规则，请先在「转发规则」页面创建规则</span>
          </div>
        </div>

        <!-- 快速转发模式 -->
        <div v-if="forwardMode === 'quick'" class="quick-forward-section">
          <div class="ml-form-group">
            <label class="ml-label">转发目标 <span class="required">*</span></label>
            <div class="target-list">
              <div v-for="(target, idx) in quickTargets" :key="idx" class="target-item">
                <Select
                  v-model="target.platform"
                  :options="platformOptions"
                  size="small"
                  style="width: 110px;"
                />
                <input
                  v-model="target.selfId"
                  class="ml-input"
                  placeholder="Bot ID"
                  style="width: 100px;"
                />
                <input
                  v-model="target.channelId"
                  class="ml-input"
                  placeholder="频道/群组 ID"
                  style="flex: 1;"
                />
                <button
                  v-if="quickTargets.length > 1"
                  class="ml-btn small danger"
                  @click="removeTarget(idx)"
                  title="移除"
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>
            <button class="ml-btn small" style="margin-top: 8px;" @click="addTarget">
              <Icon name="add" /> 添加目标
            </button>
            <div class="ml-help">
              频道 ID 格式：群组直接填 ID，私聊填 private:用户ID
            </div>
          </div>
        </div>

        <!-- 转发结果 -->
        <div v-if="forwardResult" class="forward-result" :class="{ success: forwardResult.success, error: !forwardResult.success }">
          <Icon :name="forwardResult.success ? 'check-circle' : 'alert-circle'" />
          <div class="result-content">
            <div class="result-title">
              {{ forwardResult.success ? '转发成功' : '转发失败' }}
            </div>
            <div class="result-detail">
              成功 {{ forwardResult.successCount }} / {{ forwardResult.totalTargets }} 个目标
            </div>
            <div v-if="forwardResult.errors && forwardResult.errors.length > 0" class="result-errors">
              <div v-for="(err, idx) in forwardResult.errors" :key="idx" class="error-item">
                {{ err }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ml-modal-footer">
        <button class="ml-btn" @click="closeModal">{{ forwardResult ? '关闭' : '取消' }}</button>
        <button
          v-if="!forwardResult"
          class="ml-btn primary"
          @click="doForward"
          :disabled="!canForward || forwarding"
        >
          <Icon v-if="forwarding" name="loader" class="spin" />
          {{ forwarding ? '转发中...' : '确认转发' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { mailApi, ruleApi } from '../api'
import type { StoredMail, ForwardRule, ForwardTarget, MailAddress, ForwardMode, ForwardResult } from '../types'
import Icon from './Icon.vue'
import Select from './Select.vue'

const props = defineProps<{
  visible: boolean
  mail: StoredMail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'forwarded'): void
}>()

const forwardMode = ref<'rule' | 'quick'>('rule')
const selectedRuleId = ref<number | undefined>(undefined)
const rules = ref<ForwardRule[]>([])
const forwarding = ref(false)
const forwardResult = ref<ForwardResult | null>(null)

// 快速转发目标
const quickTargets = ref<ForwardTarget[]>([
  { platform: 'onebot', selfId: '', channelId: '' }
])

// 可用平台列表 - 扩展更多常见平台
const availablePlatforms = ['onebot', 'discord', 'telegram', 'kook', 'qq', 'slack', 'dingtalk', 'feishu', 'line', 'whatsapp', 'matrix', 'wechat-official', 'custom']

// 平台选项（用于 Select 组件）
const platformOptions = computed(() =>
  availablePlatforms.map(p => ({ label: p, value: p }))
)

// 规则选项（用于 Select 组件）
const ruleSelectOptions = computed(() =>
  enabledRules.value.map(r => ({
    label: r.description ? `${r.name} - ${r.description}` : r.name,
    value: r.id
  }))
)

// 计算属性
const enabledRules = computed(() => rules.value.filter(r => r.enabled))

const selectedRule = computed(() =>
  rules.value.find(r => r.id === selectedRuleId.value)
)

const canForward = computed(() => {
  if (forwardMode.value === 'rule') {
    return !!selectedRuleId.value
  } else {
    return quickTargets.value.some(t => t.platform && t.selfId && t.channelId)
  }
})

// 加载规则列表
const loadRules = async () => {
  try {
    rules.value = await ruleApi.list()
  } catch (e) {
    console.error('Failed to load rules:', e)
  }
}

// 监听弹窗显示
watch(() => props.visible, (newVal) => {
  if (newVal) {
    forwardResult.value = null
    selectedRuleId.value = undefined
    forwardMode.value = 'rule'
    quickTargets.value = [{ platform: 'onebot', selfId: '', channelId: '' }]
    loadRules()
  }
})

const closeModal = () => {
  emit('update:visible', false)
}

const addTarget = () => {
  quickTargets.value.push({ platform: 'onebot', selfId: '', channelId: '' })
}

const removeTarget = (idx: number) => {
  quickTargets.value.splice(idx, 1)
}

const doForward = async () => {
  if (!props.mail) return

  forwarding.value = true
  forwardResult.value = null

  try {
    // 使用规则转发
    if (forwardMode.value === 'rule' && selectedRuleId.value) {
      forwardResult.value = await mailApi.forward(props.mail.id, selectedRuleId.value)
    } else {
      // 快速转发 - 需要后端支持自定义目标
      // 暂时使用不带规则的转发（会尝试匹配第一个符合的规则）
      forwardResult.value = await mailApi.forward(props.mail.id)
    }

    if (forwardResult.value?.success) {
      emit('forwarded')
    }
  } catch (e) {
    forwardResult.value = {
      success: false,
      successCount: 0,
      totalTargets: 1,
      errors: [(e as Error).message || '转发失败']
    }
  } finally {
    forwarding.value = false
  }
}

// 辅助函数
const formatAddress = (addr: MailAddress) => {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString()
}

const getModeIcon = (mode?: ForwardMode) => {
  switch (mode) {
    case 'text': return 'file-text'
    case 'image': return 'image'
    case 'hybrid': return 'layers'
    default: return 'file-text'
  }
}

const getModeLabel = (mode?: ForwardMode) => {
  switch (mode) {
    case 'text': return '文本模式'
    case 'image': return '图片模式'
    case 'hybrid': return '混合模式'
    default: return '文本模式'
  }
}
</script>

<style scoped lang="scss">
.forward-modal {
  width: 520px;
  max-width: 95vw;
}

.mail-summary {
  background: var(--ml-bg-base);
  border-radius: var(--ml-radius);
  padding: 12px 16px;

  .summary-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .summary-label {
    flex-shrink: 0;
    width: 50px;
    font-size: 12px;
    color: var(--ml-text-secondary);
  }

  .summary-value {
    flex: 1;
    font-size: 13px;
    color: var(--ml-text);
    word-break: break-word;
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ml-text);
  margin-bottom: 12px;
}

.forward-mode-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;

  .mode-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--ml-border);
    border-radius: var(--ml-radius);
    background: var(--ml-bg);
    color: var(--ml-text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: var(--ml-transition);

    &:hover {
      border-color: var(--ml-primary);
      color: var(--ml-text);
    }

    &.active {
      border-color: var(--ml-primary);
      background: var(--ml-primary-light);
      color: var(--ml-primary);
    }
  }
}

.rule-select-section {
  .rule-info {
    display: flex;
    gap: 16px;
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--ml-bg-base);
    border-radius: var(--ml-radius);

    .rule-info-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--ml-text-secondary);
    }
  }
}

.quick-forward-section {
  .target-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .target-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.ml-empty.small {
  padding: 16px;
  font-size: 13px;
  color: var(--ml-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.forward-result {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--ml-radius);
  margin-top: 16px;

  &.success {
    background: var(--ml-success-light);
    border: 1px solid var(--ml-success-border);
    color: var(--ml-success);
  }

  &.error {
    background: var(--ml-danger-light);
    border: 1px solid var(--ml-danger-border);
    color: var(--ml-danger);
  }

  .result-content {
    flex: 1;
  }

  .result-title {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .result-detail {
    font-size: 12px;
    opacity: 0.8;
  }

  .result-errors {
    margin-top: 8px;
    font-size: 12px;

    .error-item {
      padding: 4px 0;
      border-top: 1px dashed currentColor;
      opacity: 0.7;

      &:first-child {
        border-top: none;
      }
    }
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ml-divider {
  height: 1px;
  background: var(--ml-border);
  margin: 16px 0;
}

.required {
  color: #ff4d4f;
}
</style>
