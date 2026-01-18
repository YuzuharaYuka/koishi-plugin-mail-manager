<template>
  <k-layout class="mail-listener-app">
    <!-- 顶部导航 -->
    <div class="ml-header">
      <div class="ml-title">
        <h1><Icon name="inbox" /></h1>
        <div class="ml-stats" v-if="stats">
          <div class="stat-item">
            <span>账号：</span>
            <span class="stat-value">{{ stats.connectedCount }}/{{ stats.accountCount }}</span>
          </div>
          <div class="stat-item">
            <span>邮件：</span>
            <span class="stat-value">{{ stats.mailCount }}</span>
          </div>
          <div class="stat-item">
            <span>未读：</span>
            <span class="stat-value">{{ stats.unreadCount }}</span>
          </div>
        </div>
      </div>
      <div class="ml-nav">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="nav-btn"
          :class="{ active: currentTab === tab.id }"
          @click="currentTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="ml-content">
      <keep-alive>
        <component :is="currentComponent" @refresh="loadStats" />
      </keep-alive>
    </div>
  </k-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { receive } from '@koishijs/client'
import { commonApi } from '../api'
import type { Stats } from '../types'
import Icon from '../components/Icon.vue'
import AccountsView from './AccountsView.vue'
import MailsView from './MailsView.vue'
import RulesView from './RulesView.vue'
import PreviewView from './PreviewView.vue'

const tabs = [
  { id: 'accounts', label: '账号管理' },
  { id: 'mails', label: '邮件列表' },
  { id: 'rules', label: '转发规则' },
  { id: 'preview', label: '效果预览' },
]

const currentTab = ref('accounts')
const stats = ref<Stats | null>(null)

const currentComponent = computed(() => {
  switch (currentTab.value) {
    case 'accounts': return AccountsView
    case 'mails': return MailsView
    case 'rules': return RulesView
    case 'preview': return PreviewView
    default: return AccountsView
  }
})

const loadStats = async () => {
  try {
    stats.value = await commonApi.getStats()
  } catch (e) {
    console.error('Failed to load stats:', e)
  }
}

let refreshInterval: NodeJS.Timeout | null = null

onMounted(() => {
  loadStats()

  // 监听账号状态变化，实时更新统计（Vue 会自动清理监听器）
  receive('mail-manager/account-status-changed', () => {
    loadStats()
  })

  // 每30秒刷新一次统计（防止遗漏事件）
  refreshInterval = setInterval(() => {
    loadStats()
  }, 30000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
})
</script>

<style lang="scss" scoped>
.ml-header {
  padding: 12px 20px;
  background: var(--ml-bg);
  border-bottom: 1px solid var(--ml-border);
}

/* 不在 scoped 中重复定义 ml-content，使用全局样式 */
</style>
