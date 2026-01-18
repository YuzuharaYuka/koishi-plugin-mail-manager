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
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { accountApi } from '../api'
import type { MailAccount } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{
  visible: boolean
  account: MailAccount | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved'): void
}>()

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

const isEditing = computed(() => !!props.account)

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
}

// 计算表单是否有效
const isFormValid = computed(() => {
  if (!formData.name || !formData.email || !formData.imapHost) return false
  if (!isEditing.value && !formData.password) return false
  return true
})

// 根据邮箱地址自动填充 IMAP 服务器
const autoFillImapHost = () => {
  if (formData.imapHost) return
  const email = formData.email
  if (!email.includes('@')) return
  const domain = email.split('@')[1]?.toLowerCase()
  if (domain && imapHostMap[domain]) {
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
</style>
