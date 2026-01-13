/**
 * Default CSS styles for mail rendering.
 */
export const DEFAULT_CSS = `
.mail-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  max-width: 800px;
  margin: 0 auto;
}

.mail-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e0e0e0;
}

.mail-field {
  margin: 4px 0;
  font-size: 14px;
}

.mail-field-label {
  color: #666;
  margin-right: 4px;
}

.mail-field-value {
  color: #333;
}

.mail-subject {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 8px;
}

.mail-separator {
  height: 1px;
  background: linear-gradient(to right, #e0e0e0, transparent);
  margin: 16px 0;
}

.mail-body {
  color: #333;
  font-size: 14px;
}

.mail-body img {
  max-width: 100%;
  height: auto;
}

.mail-body a {
  color: #1890ff;
  text-decoration: none;
}

.mail-body a:hover {
  text-decoration: underline;
}

.mail-body blockquote {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 4px solid #ddd;
  background: #f9f9f9;
  color: #666;
}

.mail-body pre, .mail-body code {
  background: #f4f4f4;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.mail-body pre {
  padding: 12px;
  overflow-x: auto;
}

.mail-attachments {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e0e0e0;
}

.mail-attachment {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  margin: 4px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 13px;
  color: #666;
}

.mail-attachment-icon {
  margin-right: 6px;
}
`
