/**
 * 邮件管理插件 - WebUI 前端入口
 */

import { Context } from '@koishijs/client'
import MailManager from './pages/index.vue'

import './styles/main.scss'

export default (ctx: Context) => {
  ctx.page({
    name: '邮件管理',
    path: '/mail-manager',
    icon: 'mail',
    component: MailManager,
  })
}
