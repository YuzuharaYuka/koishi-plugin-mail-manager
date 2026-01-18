<template>
  <div v-if="visible" class="ml-modal-mask">
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

        <!-- 邮箱服务商快速选择 -->
        <div class="ml-form-group">
          <label class="ml-label">邮箱服务商</label>
          <Select
            v-model="selectedProvider"
            :options="providerOptions"
            placeholder="选择服务商自动填充配置"
            @change="onProviderChange"
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
              placeholder="授权码（非登录密码）"
              @blur="formTouched.password = true"
            />
            <button class="toggle-password-btn" @click="showPassword = !showPassword" tabindex="-1">
              <Icon :name="showPassword ? 'eye' : 'eye-off'" />
            </button>
          </div>
          <!-- 授权码获取指引 -->
          <div v-if="selectedProviderInfo" class="auth-guide">
            <Icon name="info" />
            <span>{{ selectedProviderInfo.authGuide }}</span>
            <a v-if="selectedProviderInfo.helpUrl" :href="selectedProviderInfo.helpUrl" target="_blank" class="guide-link">
              查看教程 <Icon name="external-link" />
            </a>
          </div>
          <div v-else class="ml-help"><Icon name="lightbulb" /> 大部分邮箱需要使用授权码，而非登录密码</div>
        </div>

        <div class="ml-form-group">
          <label class="ml-label">代理服务器（可选）</label>
          <input
            v-model="formData.proxyUrl"
            class="ml-input"
            placeholder="如: socks5://127.0.0.1:6780"
          />
          <div v-if="selectedProviderInfo?.needsProxy" class="ml-help warning">
            <Icon name="alert" />
            {{ selectedProviderInfo.proxyHint || '此邮箱服务可能需要代理才能连接' }}
          </div>
        </div>

        <div class="ml-form-group">
          <label class="ml-label">IMAP 服务器 <span class="required">*</span></label>
          <div class="server-input-row">
            <input
              v-model="formData.imapHost"
              class="ml-input"
              :class="{ 'has-error': !formData.imapHost && formTouched.imapHost }"
              placeholder="imap.example.com"
              @blur="formTouched.imapHost = true"
            />
            <Select
              v-model="quickServerSelect"
              :options="quickServerOptions"
              placeholder="快速选择"
              size="small"
              @change="onQuickServerSelect"
            />
          </div>
        </div>

        <div class="ml-form-row">
          <div class="ml-form-group port-group">
            <label class="ml-label">端口</label>
            <Select
              v-model="formData.imapPort"
              :options="portOptions"
              placeholder="选择端口"
            />
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
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { accountApi } from '../api'
import type { MailAccount } from '../types'
import Icon from './Icon.vue'
import Select from './Select.vue'

const props = defineProps<{
  visible: boolean
  account: MailAccount | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved'): void
}>()

// ========== 邮箱服务商配置 ==========
interface ProviderConfig {
  name: string
  domains: string[]
  imapHost: string
  imapPort: number
  imapTls: boolean
  authGuide: string
  helpUrl?: string
  needsProxy?: boolean
  proxyHint?: string
}

const emailProviders: Record<string, ProviderConfig> = {
  qq: {
    name: 'QQ 邮箱',
    domains: ['qq.com', 'foxmail.com'],
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在 QQ 邮箱「设置 > 账户 > POP3/IMAP 服务」中开启 IMAP 并获取授权码',
    helpUrl: 'https://service.mail.qq.com/cgi-bin/help?subtype=1&&id=28&&no=1001256'
  },
  netease163: {
    name: '163 邮箱',
    domains: ['163.com'],
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在 163 邮箱「设置 > POP3/SMTP/IMAP」中开启 IMAP 服务并获取授权码',
    helpUrl: 'https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac21b87735d7227c217'
  },
  netease126: {
    name: '126 邮箱',
    domains: ['126.com'],
    imapHost: 'imap.126.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在 126 邮箱「设置 > POP3/SMTP/IMAP」中开启 IMAP 服务并获取授权码',
    helpUrl: 'https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac21b87735d7227c217'
  },
  gmail: {
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请先开启两步验证，然后创建应用专用密码作为授权码使用',
    helpUrl: 'https://support.google.com/accounts/answer/185833',
    needsProxy: true,
    proxyHint: 'Gmail 在中国大陆地区需要配置代理才能连接'
  },
  outlook: {
    name: 'Outlook / Hotmail',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在 Microsoft 账户「安全 > 应用密码」中创建应用密码',
    helpUrl: 'https://support.microsoft.com/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944',
    needsProxy: true,
    proxyHint: 'Outlook 在部分地区可能需要配置代理'
  },
  yahoo: {
    name: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.cn'],
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在 Yahoo 账户「安全设置」中生成应用专用密码',
    needsProxy: true
  },
  aliyun: {
    name: '阿里云邮箱',
    domains: ['aliyun.com', 'alimail.com'],
    imapHost: 'imap.aliyun.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在阿里邮箱「设置 > 账户 > 客户端设置」中获取授权码'
  },
  aliyunEnterprise: {
    name: '阿里企业邮箱',
    domains: [],
    imapHost: 'imap.qiye.aliyun.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '阿里企业邮箱可直接使用登录密码作为授权码'
  },
  sina: {
    name: '新浪邮箱',
    domains: ['sina.com', 'sina.cn'],
    imapHost: 'imap.sina.com',
    imapPort: 993,
    imapTls: true,
    authGuide: '请在新浪邮箱「设置 > 客户端」中开启 IMAP 并设置授权码'
  },
  custom: {
    name: '自定义',
    domains: [],
    imapHost: '',
    imapPort: 993,
    imapTls: true,
    authGuide: '请查阅您的邮件服务商文档获取 IMAP 配置和授权码'
  }
}

// 服务商选择选项
const providerOptions = computed(() => [
  { label: '-- 选择服务商快速配置 --', value: '' },
  { label: 'QQ 邮箱', value: 'qq' },
  { label: '163 邮箱', value: 'netease163' },
  { label: '126 邮箱', value: 'netease126' },
  { label: 'Gmail', value: 'gmail' },
  { label: 'Outlook / Hotmail', value: 'outlook' },
  { label: 'Yahoo Mail', value: 'yahoo' },
  { label: '阿里云邮箱', value: 'aliyun' },
  { label: '阿里企业邮箱', value: 'aliyunEnterprise' },
  { label: '新浪邮箱', value: 'sina' },
  { label: '自定义', value: 'custom' },
])

// 快速服务器选择选项
const quickServerOptions = computed(() => [
  { label: '-- 快速选择 --', value: '' },
  { label: 'imap.qq.com (QQ)', value: 'imap.qq.com' },
  { label: 'imap.163.com (163)', value: 'imap.163.com' },
  { label: 'imap.126.com (126)', value: 'imap.126.com' },
  { label: 'imap.gmail.com (Gmail)', value: 'imap.gmail.com' },
  { label: 'outlook.office365.com', value: 'outlook.office365.com' },
  { label: 'imap.aliyun.com', value: 'imap.aliyun.com' },
  { label: 'imap.qiye.aliyun.com', value: 'imap.qiye.aliyun.com' },
])

// 端口选择选项
const portOptions = [
  { label: '993 (SSL/TLS, 推荐)', value: 993 },
  { label: '143 (STARTTLS)', value: 143 },
  { label: '465 (SSL)', value: 465 },
]

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

const saving = ref(false)
const showPassword = ref(false)
const formError = ref('')
const selectedProvider = ref('')
const quickServerSelect = ref('')

const isEditing = computed(() => !!props.account)

// 当前选中的服务商信息
const selectedProviderInfo = computed(() => {
  if (!selectedProvider.value || selectedProvider.value === 'custom') return null
  return emailProviders[selectedProvider.value]
})

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
  proxyUrl: '',
})

// 初始化表单
watch(() => props.visible, (newVal) => {
  if (newVal) {
    resetForm()
    if (props.account) {
      Object.assign(formData, {
        name: props.account.name,
        email: props.account.email,
        password: props.account.password,
        imapHost: props.account.imapHost,
        imapPort: props.account.imapPort,
        imapTls: props.account.imapTls,
        enabled: props.account.enabled,
        proxyUrl: props.account.proxyUrl || '',
      })
      // 尝试识别服务商
      detectProvider(props.account.email)
    } else {
      Object.assign(formData, {
        name: '',
        email: '',
        password: '',
        imapHost: '',
        imapPort: 993,
        imapTls: true,
        enabled: true, // 新建默认启用
        proxyUrl: '',
      })
      selectedProvider.value = ''
    }
  }
})

const resetForm = () => {
  formTouched.name = false
  formTouched.email = false
  formTouched.password = false
  formTouched.imapHost = false
  formError.value = ''
  showPassword.value = false
  quickServerSelect.value = ''
}

// 根据邮箱地址检测服务商
const detectProvider = (email: string) => {
  if (!email.includes('@')) return
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return

  for (const [key, config] of Object.entries(emailProviders)) {
    if (config.domains.includes(domain)) {
      selectedProvider.value = key
      return
    }
  }
  selectedProvider.value = 'custom'
}

// 服务商变更时填充配置
const onProviderChange = (value: string) => {
  if (!value || value === 'custom') return
  const config = emailProviders[value]
  if (config) {
    formData.imapHost = config.imapHost
    formData.imapPort = config.imapPort
    formData.imapTls = config.imapTls
  }
}

// 快速服务器选择
const onQuickServerSelect = (value: string) => {
  if (value) {
    formData.imapHost = value
    quickServerSelect.value = ''
  }
}

// 计算表单是否有效
const isFormValid = computed(() => {
  if (!formData.name || !formData.email || !formData.imapHost) return false
  if (!isEditing.value && !formData.password) return false
  return true
})

// 根据邮箱地址自动填充 IMAP 服务器
const autoFillImapHost = () => {
  const email = formData.email
  if (!email.includes('@')) return
  const domain = email.split('@')[1]?.toLowerCase()

  // 检测服务商
  detectProvider(email)

  // 自动填充 IMAP 地址
  if (!formData.imapHost && domain && imapHostMap[domain]) {
    formData.imapHost = imapHostMap[domain]
  }
}

const closeModal = () => {
  emit('update:visible', false)
}

const saveAccount = async () => {
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
    if (isEditing.value && props.account) {
      const data: any = { ...formData }
      if (!data.password) {
        delete data.password
      }
      await accountApi.update(props.account.id, data)
    } else {
      await accountApi.create(formData)
    }
    emit('saved')
    closeModal()
  } catch (e) {
    console.error('Failed to save account:', e)
    formError.value = `保存失败: ${(e as Error).message}`
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.account-modal {
  width: 100%;
  max-width: 520px;
}

.form-error {
  background: var(--ml-danger-light);
  border: 1px solid var(--ml-danger-border);
  color: var(--ml-danger);
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
  color: var(--ml-warning);
}

.ml-help.warning {
  color: var(--ml-warning);
  background: var(--ml-warning-light);
  padding: 8px 12px;
  border-radius: 6px;
  margin-top: 8px;
}

.ml-help.warning :deep(.icon) {
  color: var(--ml-warning);
}

.auth-guide {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--ml-primary-light);
  border-radius: 6px;
  font-size: 13px;
  color: var(--ml-text-secondary);
  line-height: 1.5;
}

.auth-guide :deep(.icon) {
  flex-shrink: 0;
  color: var(--ml-primary);
  margin-top: 2px;
}

.guide-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--ml-primary);
  white-space: nowrap;
  margin-left: 4px;
}

.guide-link:hover {
  text-decoration: underline;
}

.guide-link :deep(.icon) {
  width: 12px;
  height: 12px;
}

.server-input-row {
  display: flex;
  gap: 8px;
}

.server-input-row .ml-input {
  flex: 1;
}

.server-input-row .ml-select-wrapper {
  width: 140px;
  flex-shrink: 0;
}

.port-group {
  flex: 1;
  max-width: 200px;
}

.switch-wrapper {
  padding-top: 8px;
}

.ml-input.has-error {
  border-color: var(--ml-danger);
}

.ml-input.has-error:focus {
  border-color: var(--ml-danger);
  box-shadow: 0 0 0 2px var(--ml-danger-light);
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
  color: var(--ml-text-secondary);
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
</style>
