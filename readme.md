# koishi-plugin-mail-listener

[![npm](https://img.shields.io/npm/v/koishi-plugin-mail-listener?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mail-listener)

邮件监听与转发插件，支持 WebUI 管理、自定义渲染和多种转发元素选择。

## 功能特性

- 📧 **多账号管理**：支持同时监听多个邮箱账户（IMAP 协议）
- 💾 **邮件存储**：自动保存接收到的邮件到数据库
- 🔄 **智能转发**：根据规则自动将邮件转发到指定频道
- 🎨 **自定义样式**：支持自定义 CSS 渲染邮件内容
- 🖼️ **多种渲染模式**：支持纯文本、HTML 图片、Markdown 图片
- ✨ **元素选择**：自定义选择要转发的邮件元素（主题、发件人、正文等）
- 🎯 **条件匹配**：支持多种匹配条件（主题、发件人、正文等）
- 👀 **预览功能**：转发前可预览渲染效果

## 安装

```bash
npm install koishi-plugin-mail-listener
```

## 依赖

- `@koishijs/plugin-console` - 控制台插件
- `@koishijs/plugin-server` - 服务器插件
- `koishi-plugin-puppeteer`（可选）- 用于 HTML/Markdown 渲染为图片

## 使用说明

### 1. 添加邮箱账号

1. 在控制台中打开「邮件监听」页面
2. 点击「添加账号」按钮
3. 填写邮箱信息：
   - **账号名称**：用于标识的名称
   - **邮箱地址**：你的邮箱地址
   - **IMAP 服务器**：邮箱的 IMAP 服务器地址
   - **端口**：IMAP 端口（通常为 993）
   - **用户名**：登录用户名（通常是邮箱地址）
   - **密码/授权码**：邮箱密码或应用授权码
4. 点击「测试连接」验证配置
5. 保存并启用账号

### 2. 配置转发规则

1. 切换到「转发规则」标签页
2. 点击「添加规则」
3. 配置匹配条件：
   - 匹配所有邮件
   - 按主题/发件人/正文包含或正则匹配
4. 添加转发目标：
   - 选择平台和 Bot
   - 填写频道/群组 ID
5. 选择要转发的元素：
   - 主题、发件人、时间、正文等
   - 可自定义每个元素的标签
6. 自定义 CSS 样式（可选）

### 3. 预览效果

1. 切换到「预览」标签页
2. 选择一封已接收的邮件
3. 调整渲染模式和元素配置
4. 点击「生成预览」查看效果

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| mailRetentionDays | number | 30 | 邮件保留天数（0 为永久保留） |
| maxMailsPerAccount | number | 1000 | 每账号最大邮件数 |
| autoCleanup | boolean | true | 自动清理过期邮件 |
| cleanupInterval | number | 86400000 | 清理间隔（毫秒） |

### 渲染配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| imageWidth | number | 800 | 渲染图片宽度 |
| backgroundColor | string | #ffffff | 背景颜色 |
| textColor | string | #333333 | 文本颜色 |
| fontSize | number | 14 | 字体大小 |
| padding | number | 20 | 内边距 |
| showBorder | boolean | true | 显示边框 |
| borderColor | string | #e0e0e0 | 边框颜色 |

## 常见邮箱 IMAP 配置

| 邮箱 | IMAP 服务器 | 端口 |
|------|-------------|------|
| QQ 邮箱 | imap.qq.com | 993 |
| 163 邮箱 | imap.163.com | 993 |
| Gmail | imap.gmail.com | 993 |
| Outlook | outlook.office365.com | 993 |

> **注意**：部分邮箱需要开启 IMAP 服务并使用授权码而非密码登录。

## 许可证

MIT License


