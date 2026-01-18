/**
 * Default CSS styles for mail rendering.
 *
 * 这些样式用于将邮件内容渲染为图片时的外观控制。
 * 在「图片模式」和「混合模式」下生效，控制以下内容：
 *
 * 1. .mail-container - 整体容器样式（字体、行高、最大宽度）
 * 2. .mail-header - 邮件头部信息区域（发件人、主题、时间等）
 * 3. .mail-field - 单个字段行的样式
 * 4. .mail-subject - 邮件主题的特殊样式
 * 5. .mail-body - 邮件正文区域（包括图片、链接、引用块等）
 * 6. .mail-attachments - 附件列表区域
 *
 * 用户可以通过自定义 CSS 覆盖这些样式，实现个性化的渲染效果。
 */
export const DEFAULT_CSS = `
/* ========== 容器与基础样式 ========== */
.mail-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
  background: #fff;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  box-sizing: border-box;
}

/* ========== 邮件头部区域 ========== */
.mail-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.mail-subject {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 12px;
  line-height: 1.4;
  word-break: break-word;
}

.mail-field {
  display: flex;
  align-items: flex-start;
  margin: 6px 0;
  font-size: 13px;
}

.mail-field-label {
  flex-shrink: 0;
  width: 56px;
  color: #888;
  font-weight: 500;
}

.mail-field-value {
  flex: 1;
  color: #333;
  word-break: break-word;
}

/* ========== 分隔线 ========== */
.mail-separator {
  height: 1px;
  background: linear-gradient(to right, #e0e0e0 50%, transparent);
  margin: 16px 0;
  border: none;
}

/* ========== 邮件正文 ========== */
.mail-body {
  color: #333;
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
  overflow-wrap: break-word;
}

/* 图片响应式 */
.mail-body img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 8px 0;
}

/* 链接样式 */
.mail-body a {
  color: #1677ff;
  text-decoration: none;
  word-break: break-all;
}

.mail-body a:hover {
  text-decoration: underline;
}

/* 引用块 */
.mail-body blockquote {
  margin: 12px 0;
  padding: 10px 16px;
  border-left: 4px solid #d9d9d9;
  background: #fafafa;
  color: #595959;
  font-style: italic;
}

/* 代码块 */
.mail-body pre,
.mail-body code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  background: #f5f5f5;
  border-radius: 4px;
}

.mail-body code {
  padding: 2px 6px;
}

.mail-body pre {
  padding: 12px 16px;
  overflow-x: auto;
  line-height: 1.5;
}

.mail-body pre code {
  padding: 0;
  background: transparent;
}

/* 列表 */
.mail-body ul,
.mail-body ol {
  margin: 8px 0;
  padding-left: 24px;
}

.mail-body li {
  margin: 4px 0;
}

/* 表格 */
.mail-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.mail-body th,
.mail-body td {
  padding: 8px 12px;
  border: 1px solid #e8e8e8;
  text-align: left;
}

.mail-body th {
  background: #fafafa;
  font-weight: 600;
}

/* 标题 */
.mail-body h1,
.mail-body h2,
.mail-body h3,
.mail-body h4,
.mail-body h5,
.mail-body h6 {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.4;
}

.mail-body h1 { font-size: 24px; }
.mail-body h2 { font-size: 20px; }
.mail-body h3 { font-size: 18px; }
.mail-body h4 { font-size: 16px; }
.mail-body h5 { font-size: 14px; }
.mail-body h6 { font-size: 13px; }

/* 段落 */
.mail-body p {
  margin: 8px 0;
}

/* 水平线 */
.mail-body hr {
  border: none;
  height: 1px;
  background: #e8e8e8;
  margin: 16px 0;
}

/* ========== 附件区域 ========== */
.mail-attachments {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e8e8e8;
}

.mail-attachments-title {
  font-size: 13px;
  font-weight: 600;
  color: #666;
  margin-bottom: 10px;
}

.mail-attachment {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  margin: 4px;
  background: #f5f5f5;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 13px;
  color: #595959;
  transition: all 0.2s;
}

.mail-attachment:hover {
  background: #e8e8e8;
}

.mail-attachment-icon {
  margin-right: 8px;
  font-size: 16px;
}

.mail-attachment-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-attachment-size {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}
`
