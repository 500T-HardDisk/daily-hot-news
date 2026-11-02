import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

export type WebviewMode = 'sidebar' | 'panel';

/**
 * 生成 Webview 的 HTML 骨架。
 * 样式与脚本都以外部资源方式加载，遵守严格的 CSP（nonce 校验）。
 */
export function buildHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode: WebviewMode,
  title: string
): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const media = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', ...segments));
  const styleUri = media('webview.css');
  const scriptUri = media('webview.js');

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body data-mode="${mode}">
  <div id="app">
    <header class="topbar">
      <div class="title-block">
        <h1 class="app-title">${mode === 'panel' ? '热点头条' : '今日热点'}</h1>
        <div class="meta"><span id="date-label">加载中…</span><span class="dot">·</span><span id="meta-label"></span></div>
      </div>
      <div class="topbar-actions">
        <select id="date-select" class="date-select" title="切换日期" hidden></select>
        <button id="btn-latest" class="latest-btn" title="回到最新新闻" hidden>最新</button>
        <button id="btn-refresh" class="icon-btn" title="刷新数据" aria-label="刷新数据">⟳</button>
      </div>
    </header>

    <p id="headline" class="headline" hidden></p>

    <div class="search-row">
      <input id="search" class="search" type="search" placeholder="搜索标题、摘要或来源…" aria-label="搜索新闻" />
      <kbd class="search-hint">/</kbd>
    </div>

    <nav id="categories" class="chips" aria-label="新闻分类"></nav>

    <main class="content">
      <section id="list" class="list" aria-live="polite"></section>
      <aside id="detail" class="detail" hidden></aside>
    </main>

    <footer class="footer">
      <span id="footer-label" class="footer-label"></span>
      <span class="footer-tip">数据随插件版本更新 · 离线可读</span>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
