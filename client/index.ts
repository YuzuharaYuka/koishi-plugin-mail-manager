/**
 * 邮件管理插件 - WebUI 前端入口
 */

import { Context, icons } from '@koishijs/client'
import MailManager from './pages/index.vue'
import MailIcon from './components/MailIcon.vue'

import './styles/main.scss'

// 注册自定义邮件图标
icons.register('activity:mail-manager', MailIcon)

export default (ctx: Context) => {
  ctx.page({
    name: '邮件管理',
    path: '/mail-manager',
    icon: 'activity:mail-manager',
    component: MailManager,
  })
}
