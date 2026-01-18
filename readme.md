# koishi-plugin-mail-manager

[![npm](https://img.shields.io/npm/v/koishi-plugin-mail-manager?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mail-manager)

邮件监听与自动转发插件。支持多账号 IMAP 监听、规则匹配自动转发、WebUI 管理界面。

## 功能特性

- 多账号同时监听，支持主流邮箱提供商
- 基于规则的条件匹配与自动转发
- 三种渲染模式：纯文本、HTML 图片、混合模式
- 灵活的转发元素配置
- 连接健康检查与自动重连
- 邮件数据持久化与定期清理

## 安装

插件市场安装或者使用 npm 安装：
```bash
npm install koishi-plugin-mail-manager
```

## 依赖要求

### 必需服务

- `@koishijs/plugin-console` - 提供 WebUI 管理界面
- `@koishijs/plugin-server` - 提供 HTTP 服务支持

### 可选服务

- `@koishijs/plugin-puppeteer` - 用于 HTML/Markdown 渲染为图片（image 和 hybrid 模式需要）

## 快速开始

1. 在控制台打开「邮件管理」页面
2. 添加邮箱账号并配置 IMAP 服务器信息
3. 创建转发规则，设置匹配条件和转发目标
4. 启用账号开始监听新邮件

## 配置选项

### 基础设置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| debug | boolean | false | 启用调试日志输出 |
| encryptionKey | string | 自动生成 | 密码加密密钥 |
| mailRetentionDays | number | 30 | 邮件保留天数，0 表示永久保留 |
| autoCleanup | boolean | true | 自动清理过期邮件 |

### 连接设置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| autoReconnect | boolean | true | 连接断开时自动重连 |
| maxReconnectAttempts | number | 10 | 最大重连尝试次数 |
| reconnectInterval | number | 30 | 重连间隔（秒） |
| connectionTimeout | number | 30 | 连接超时时间（秒） |
| healthCheckEnabled | boolean | true | 定期健康检查 |
| healthCheckInterval | number | 300 | 健康检查间隔（秒） |
| enableConnectivityTest | boolean | true | 启用 IP 连通性测试 |
| connectivityTestTimeout | number | 3000 | 连通性测试超时（毫秒） |

## 邮箱服务器配置

### 主流邮箱 IMAP 服务器

| 邮箱提供商 | IMAP 服务器 | 端口 | TLS | 说明 |
|-----------|------------|------|-----|------|
| QQ 邮箱 | imap.qq.com | 993 | 是 | 需使用授权码登录 |
| 163 邮箱 | imap.163.com | 993 | 是 | 需使用授权码登录 |
| 126 邮箱 | imap.126.com | 993 | 是 | 需使用授权码登录 |
| Gmail | imap.gmail.com | 993 | 是 | 需使用应用专用密码 |
| Outlook/Hotmail | outlook.office365.com | 993 | 是 | 可直接使用账号密码 |
| iCloud | imap.mail.me.com | 993 | 是 | 需使用应用专用密码 |
| Yahoo | imap.mail.yahoo.com | 993 | 是 | 需使用应用密码 |

### 授权码获取方式

- **QQ 邮箱**：设置 - 账户 - POP3/IMAP/SMTP 服务 - 开启 IMAP 服务并生成授权码
- **163/126 邮箱**：设置 - POP3/SMTP/IMAP - 开启 IMAP 服务并生成授权码
- **Gmail**：Google 账号设置 - 安全性 - 两步验证 - 应用专用密码
- **iCloud**：Apple ID - 安全 - 应用专用密码

## 转发规则

### 渲染模式

| 模式 | 说明 | 依赖 Puppeteer |
|------|------|----------------|
| text | 纯文本模式，根据元素配置发送纯文本消息 | 否 |
| image | 图片模式，将邮件 HTML 内容渲染为图片 | 是 |
| hybrid | 混合模式，摘要文本加正文图片 | 是 |

### 转发元素

可配置的转发元素包括：

- subject - 邮件主题
- from - 发件人信息
- to - 收件人信息
- date - 接收日期
- body - 邮件正文
- attachments - 附件列表
- separator - 分隔线
- custom - 自定义模板内容

### 匹配条件

| 条件类型 | 说明 |
|---------|------|
| subject_contains | 主题包含指定文本 |
| subject_regex | 主题匹配正则表达式 |
| from_contains | 发件人包含指定文本 |
| from_regex | 发件人匹配正则表达式 |
| to_contains | 收件人包含指定文本 |
| body_contains | 正文包含指定文本 |
| body_regex | 正文匹配正则表达式 |
| all | 匹配所有邮件 |

### 条件组合逻辑

- **and**: 所有条件必须同时满足
- **or**: 满足任意一个条件即可

支持条件取反，可实现复杂的过滤逻辑。

### 失败处理策略

| 策略 | 说明 |
|------|------|
| mark-partial | 部分目标转发成功即标记为已转发（默认） |
| require-all | 所有目标转发成功才标记为已转发 |
| retry-failed | 记录失败目标，支持后续重试 |

## 命令

```
mail.cleanup [-e|-a] [-d]  清理邮件数据库
  -e, --expired              清理过期邮件
  -a, --all                  清理所有邮件
  -d, --dry-run             预览清理数量，不实际删除
```

## 许可证

MIT License
