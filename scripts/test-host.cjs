#!/usr/bin/env node
/**
 * 扩展宿主逻辑测试：用轻量 vscode API 模拟器加载编译产物 out/extension.js，
 * 验证激活、Webview 数据下发、日期切换、复制、命令与面板。
 *
 * 用法：node scripts/test-host.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/* ---------------- vscode API 模拟 ---------------- */

const posted = [];
const commands = {};
const views = [];
const panels = [];
let clipboard = '';
let quickPickResult;
let lastStatusBarText = '';

const uri = (fsPath) => ({
  fsPath,
  scheme: 'file',
  path: fsPath.replace(/\\/g, '/'),
  toString: () => `file://${fsPath.replace(/\\/g, '/')}`,
});

const vscodeMock = {
  Uri: {
    file: (p) => uri(p),
    joinPath: (base, ...segments) => uri(path.join(base.fsPath, ...segments)),
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1 },
  workspace: {
    fs: {
      readFile: async (u) => {
        if (!fs.existsSync(u.fsPath)) {
          throw new Error('ENOENT');
        }
        return fs.promises.readFile(u.fsPath);
      },
    },
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (key, fallback) => {
        if (key === 'localDataPath') {
          return '';
        }
        return fallback;
      },
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    openTextDocument: async () => ({}),
  },
  window: {
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      show() {
        lastStatusBarText = this.text;
      },
      hide() {},
      dispose() {},
    }),
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    registerWebviewViewProvider: (id, provider) => {
      views.push({ id, provider });
      return { dispose() {} };
    },
    createWebviewPanel: (type, title, column, options) => {
      const webview = createWebview();
      const panel = {
        type,
        title,
        webview,
        options,
        revealed: 0,
        dispose() {
          this.disposed = true;
        },
        reveal() {
          this.revealed += 1;
        },
        onDidDispose(cb) {
          this._onDispose = cb;
          return { dispose() {} };
        },
      };
      panels.push(panel);
      return panel;
    },
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => quickPickResult,
    showInputBox: async () => undefined,
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, callback) => {
      commands[id] = callback;
      return { dispose() {} };
    },
    executeCommand: async () => undefined,
  },
  env: {
    clipboard: {
      writeText: async (text) => {
        clipboard = text;
      },
    },
  },
};

function createWebview() {
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://test',
    _onMessage: null,
    asWebviewUri: (target) => target,
    onDidReceiveMessage(cb) {
      webview._onMessage = cb;
      return { dispose() {} };
    },
    postMessage(message) {
      posted.push(message);
      return Promise.resolve(true);
    },
  };
  return webview;
}

function createView() {
  const webview = createWebview();
  const view = {
    webview,
    visible: true,
    onDidDispose(cb) {
      view._onDispose = cb;
      return { dispose() {} };
    },
  };
  return view;
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

/* ---------------- 激活扩展 ---------------- */

const context = {
  extensionUri: uri(ROOT),
  subscriptions: [],
  extension: { packageJSON: { version: '1.0.0' } },
};

const extension = require(path.join(ROOT, 'out', 'extension.js'));
extension.activate(context);

const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const lastData = () => [...posted].reverse().find((m) => m.type === 'data')?.payload;

let passed = 0;
async function check(label, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

(async () => {
  console.log('扩展激活：');

  await check('注册了 7 个命令', () => {
    const expected = [
      'hotNews.openPanel',
      'hotNews.selectDate',
      'hotNews.selectCategory',
      'hotNews.search',
      'hotNews.refresh',
      'hotNews.openDataFile',
      'hotNews.about',
    ];
    for (const id of expected) {
      assert.equal(typeof commands[id], 'function', `缺少命令 ${id}`);
    }
  });

  await check('注册了侧边栏 Webview 视图', () => {
    assert.equal(views.length, 1);
    assert.equal(views[0].id, 'hotNews.sidebar');
  });

  await wait(150);

  await check('状态栏显示当天条数', () => {
    assert.match(lastStatusBarText, /热点 \d+/);
  });

  console.log('\n侧边栏数据：');
  const view = createView();
  views[0].provider.resolveWebviewView(view);

  await check('生成带 CSP 与资源引用的 HTML', () => {
    assert.match(view.webview.html, /Content-Security-Policy/);
    assert.match(view.webview.html, /media\/webview\.css/);
    assert.match(view.webview.html, /media\/webview\.js/);
    assert.match(view.webview.html, /nonce-/);
  });

  view.webview._onMessage({ type: 'ready' });
  await wait();

  await check('向 Webview 下发最新一天的数据', () => {
    const data = lastData();
    assert.ok(data, '未收到 data 消息');
    assert.equal(data.date, '2026-11-02');
    assert.equal(data.categories.length, 15);
    assert.ok(data.total >= 30, `条数异常：${data.total}`);
    assert.equal(data.items.length, data.total);
    assert.equal(data.items[0].id.split('|').length, 3);
    assert.equal(data.mode, 'sidebar');
  });

  await check('每类新闻都有分类名与日期', () => {
    for (const item of lastData().items) {
      assert.ok(item.categoryName);
      assert.ok(item.title);
      assert.equal(item.date, '2026-11-02');
    }
  });

  view.webview._onMessage({ type: 'selectDate', date: '2026-11-01' });
  await wait();

  await check('切换日期后下发历史数据', () => {
    const data = lastData();
    assert.equal(data.date, '2026-11-01');
    assert.ok(data.dates.includes('2026-11-02'));
    assert.ok(data.total > 0);
  });

  view.webview._onMessage({ type: 'copyItem', id: lastData().items[0].id });
  await wait();

  await check('复制新闻全文到剪贴板', () => {
    assert.ok(clipboard.includes(lastData().items[0].title));
    assert.ok(posted.some((m) => m.type === 'toast'));
  });

  console.log('\n命令：');
  quickPickResult = { date: '2026-11-02' };
  await commands['hotNews.selectDate']();
  await wait();

  await check('日期跳转命令切换到所选日期', () => {
    const data = lastData();
    assert.equal(data.date, '2026-11-02');
    assert.equal(data.dates[0], '2026-11-02');
  });

  quickPickResult = { id: 'tech', label: '💻 科技' };
  await commands['hotNews.selectCategory']();
  await wait();

  await check('选择分类后向侧边栏发送 setCategory', () => {
    const message = [...posted].reverse().find((m) => m.type === 'setCategory');
    assert.ok(message, '未收到 setCategory');
    assert.equal(message.category, 'tech');
  });

  const before = posted.filter((m) => m.type === 'data').length;
  await commands['hotNews.refresh']();
  await wait();

  await check('刷新命令重新下发数据', () => {
    const after = posted.filter((m) => m.type === 'data').length;
    assert.ok(after > before, '刷新后未收到新的 data');
  });

  console.log('\n编辑器面板：');
  await commands['hotNews.openPanel']();
  await wait();

  await check('打开面板并设置标题', () => {
    assert.equal(panels.length, 1);
    assert.match(panels[0].title, /热点头条/);
    assert.match(panels[0].webview.html, /data-mode="panel"/);
    assert.ok(panels[0].webview.html.includes('btn-refresh'));
  });

  panels[0].webview._onMessage({ type: 'ready' });
  await wait();

  await check('面板收到 mode=panel 的数据', () => {
    const data = lastData();
    assert.equal(data.mode, 'panel');
    assert.ok(data.items.length > 0);
  });

  await check('再次打开面板时复用而非新建', async () => {
    await commands['hotNews.openPanel']();
    await wait();
    assert.equal(panels.length, 1);
    assert.ok(panels[0].revealed >= 1);
  });

  panels[0].webview._onMessage({ type: 'refresh' });
  await wait();

  await check('面板刷新后仍能收到数据', () => {
    const data = [...posted].reverse().find((m) => m.type === 'data' && m.payload.mode === 'panel');
    assert.ok(data, '未收到面板 data');
    assert.ok(data.payload.items.length > 0);
  });

  extension.deactivate();

  console.log(`\n✅ 扩展宿主测试通过（${passed} 项）`);
})().catch((error) => {
  console.error('\n❌ 测试失败：', error);
  process.exit(1);
});
