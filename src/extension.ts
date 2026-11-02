import * as vscode from 'vscode';
import { NewsStore } from './newsStore';
import { NewsItemView, WebviewInMessage, WebviewOutMessage, WebviewPayload } from './types';
import { buildHtml } from './webview';

const VIEW_ID = 'hotNews.sidebar';
const PANEL_VIEW_TYPE = 'hotNews.panel';

let extensionContext: vscode.ExtensionContext;
let extensionUri: vscode.Uri;
let store: NewsStore;
let sidebar: SidebarProvider | undefined;
let panel: PanelController | undefined;
let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

/* ------------------------------------------------------------------ */
/* 数据加载                                                            */
/* ------------------------------------------------------------------ */

async function loadPayload(
  date: string | undefined,
  mode: 'sidebar' | 'panel',
  focusId?: string
): Promise<WebviewPayload> {
  const index = await store.index();
  const dates = [...new Set(index.days.map((d) => d.date))].sort((a, b) => b.localeCompare(a));
  const target = date && dates.includes(date) ? date : dates[0];

  if (!target) {
    throw new Error('news/index.json 的 days 字段为空，没有可展示的新闻数据。');
  }

  const day = await store.day(target);
  const items: NewsItemView[] = [];

  for (const category of index.categories) {
    const list = day?.categories?.[category.id];
    if (!Array.isArray(list)) {
      continue;
    }
    list.forEach((item, i) => {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) {
        return;
      }
      items.push({
        ...item,
        id: `${target}|${category.id}|${i}`,
        categoryId: category.id,
        categoryName: category.name,
        date: target,
      });
    });
  }

  const config = vscode.workspace.getConfiguration('hotNews');
  return {
    mode,
    categories: index.categories,
    date: target,
    dates,
    updatedAt: day?.updatedAt ?? index.updatedAt,
    headline: day?.headline,
    total: items.length,
    items,
    settings: {
      defaultCategory: config.get<string>('defaultCategory', 'all'),
      summaryLines: config.get<number>('summaryLines', 2),
    },
    focusId,
  };
}

async function findItemById(id: string): Promise<NewsItemView | undefined> {
  const date = id.split('|')[0];
  const payload = await loadPayload(date, 'panel');
  return payload.items.find((item) => item.id === id);
}

async function copyItem(id: string, titleOnly = false): Promise<void> {
  const item = await findItemById(id);
  if (!item) {
    return;
  }

  const meta = `—— ${item.categoryName}${item.source ? ` · ${item.source}` : ''} ${item.date}${
    item.time ? ` ${item.time}` : ''
  }`;
  const highlights = item.highlights?.length
    ? `【十条重要新闻】\n${item.highlights
        .map((h, i) => `${i + 1}. ${h.title}${h.detail ? `：${h.detail}` : ''}`)
        .join('\n')}`
    : '';
  const pointItems = item.pointItems?.length
    ? `【20 条相关新闻要点】\n${item.pointItems
        .map((p, i) => `${i + 1}. ${p.text}`)
        .join('\n')}`
    : '';
  const points = item.points?.length ? item.points.map((point, i) => `${i + 1}. ${point}`).join('\n') : '';
  const table = item.table?.columns?.length
    ? [
        item.table.caption ?? '',
        item.table.columns.join('\t'),
        ...item.table.rows.map((row) => item.table!.columns.map((_, i) => row[i] ?? '').join('\t')),
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const text = titleOnly
    ? item.title
    : [item.title, highlights, item.summary, pointItems, points, table, meta, item.url]
        .filter(Boolean)
        .join('\n\n');

  await vscode.env.clipboard.writeText(text);
  broadcast({ type: 'toast', message: titleOnly ? '标题已复制' : '全文已复制到剪贴板' });
}

function broadcast(message: WebviewOutMessage): void {
  void sidebar?.post(message);
  void panel?.post(message);
}

/* ------------------------------------------------------------------ */
/* 错误处理                                                            */
/* ------------------------------------------------------------------ */

let lastError = { message: '', at: 0 };

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  output.appendLine(`[${new Date().toLocaleString()}] ${message}`);

  const now = Date.now();
  if (lastError.message === message && now - lastError.at < 5000) {
    return;
  }
  lastError = { message, at: now };

  void vscode.window.showErrorMessage(`G-要点：${message}`, '打开数据文件').then((pick) => {
    if (pick === '打开数据文件') {
      void openDataFile();
    }
  });
}

/* ------------------------------------------------------------------ */
/* 侧边栏 Webview View                                                 */
/* ------------------------------------------------------------------ */

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private date?: string;
  private pending: WebviewOutMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = buildHtml(
      view.webview,
      this.context.extensionUri,
      'sidebar',
      'G-要点'
    );

    view.webview.onDidReceiveMessage((message: WebviewInMessage) => {
      void this.onMessage(message);
    });
    view.onDidDispose(() => {
      this.view = undefined;
      // 关闭视图后再次打开，默认回到最新日期
      this.date = undefined;
    });
  }

  private async onMessage(message: WebviewInMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.push();
        break;
      case 'refresh':
        store.invalidate();
        await Promise.all([this.push(), panel?.push()]);
        broadcast({ type: 'toast', message: '数据已刷新' });
        void refreshStatusBar();
        break;
      case 'selectDate':
        this.date = message.date;
        await this.push();
        break;
      case 'openItem':
        this.date = message.date;
        await openPanel(message.date, message.id);
        break;
      case 'copyItem':
        await copyItem(message.id, message.titleOnly);
        break;
      case 'openPanel':
        await openPanel(this.date);
        break;
      default:
        break;
    }
  }

  async push(focusId?: string): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const payload = await loadPayload(this.date, 'sidebar', focusId);
      this.date = payload.date;
      await this.view.webview.postMessage({ type: 'data', payload } satisfies WebviewOutMessage);
      await this.flushPending();
    } catch (error) {
      reportError(error);
      await this.post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async post(message: WebviewOutMessage): Promise<void> {
    if (!this.view) {
      this.pending.push(message);
      return;
    }
    await this.view.webview.postMessage(message);
  }

  private async flushPending(): Promise<void> {
    if (!this.pending.length || !this.view) {
      return;
    }
    const queue = this.pending;
    this.pending = [];
    for (const message of queue) {
      await this.view.webview.postMessage(message);
    }
  }

  async selectCategory(categoryId: string): Promise<void> {
    await this.post({ type: 'setCategory', category: categoryId });
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  async setQuery(query: string): Promise<void> {
    await this.post({ type: 'setQuery', query });
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  /** 跳转到指定日期（历史新闻），并聚焦侧边栏。 */
  async openDate(date: string): Promise<void> {
    this.date = date;
    await this.push();
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  get currentDate(): string | undefined {
    return this.date;
  }

  refresh(): void {
    void this.push();
  }
}

/* ------------------------------------------------------------------ */
/* 编辑器面板                                                          */
/* ------------------------------------------------------------------ */

class PanelController {
  private disposed = false;
  private pending: WebviewOutMessage[] = [];
  private ready = false;

  constructor(
    private readonly webviewPanel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private date?: string,
    private focusId?: string
  ) {
    const { webview } = webviewPanel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    };
    webview.html = buildHtml(webview, context.extensionUri, 'panel', 'G-要点');
    webview.onDidReceiveMessage((message: WebviewInMessage) => {
      void this.onMessage(message);
    });
    webviewPanel.onDidDispose(() => {
      this.disposed = true;
      if (panel === this) {
        panel = undefined;
      }
    });
  }

  private async onMessage(message: WebviewInMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.push(this.date, this.focusId);
        this.focusId = undefined;
        break;
      case 'refresh':
        store.invalidate();
        await Promise.all([this.push(), sidebar?.push()]);
        void refreshStatusBar();
        break;
      case 'selectDate':
        this.date = message.date;
        await this.push(this.date);
        break;
      case 'copyItem':
        await copyItem(message.id, message.titleOnly);
        break;
      default:
        break;
    }
  }

  async push(date?: string, focusId?: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      const payload = await loadPayload(date ?? this.date, 'panel', focusId);
      this.date = payload.date;
      this.webviewPanel.title = `G-要点 · ${payload.date}`;
      await this.webviewPanel.webview.postMessage({ type: 'data', payload } satisfies WebviewOutMessage);
      await this.flushPending();
    } catch (error) {
      reportError(error);
      await this.post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async post(message: WebviewOutMessage): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!this.ready) {
      this.pending.push(message);
      return;
    }
    await this.webviewPanel.webview.postMessage(message);
  }

  private async flushPending(): Promise<void> {
    if (!this.pending.length || this.disposed) {
      return;
    }
    const queue = this.pending;
    this.pending = [];
    for (const message of queue) {
      await this.webviewPanel.webview.postMessage(message);
    }
  }

  reveal(): void {
    this.webviewPanel.reveal();
  }

  async setQuery(query: string): Promise<void> {
    await this.post({ type: 'setQuery', query });
  }
}

async function openPanel(date?: string, focusId?: string): Promise<void> {
  if (panel) {
    panel.reveal();
    await panel.push(date, focusId);
    return;
  }

  const webviewPanel = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    'G-要点',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    }
  );

  const controller = new PanelController(webviewPanel, extensionContext, date, focusId);
  panel = controller;
}

/* ------------------------------------------------------------------ */
/* 命令                                                                */
/* ------------------------------------------------------------------ */

async function pickCategory(): Promise<void> {
  try {
    const payload = await loadPayload(sidebar?.currentDate, 'sidebar');
    const counts = new Map<string, number>();
    for (const item of payload.items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }

    const picks: Array<vscode.QuickPickItem & { id: string }> = [
      {
        id: 'all',
        label: '$(list-unordered) 全部分类',
        description: `${payload.total} 条`,
        detail: '显示当天所有分类的新闻',
      },
      ...payload.categories.map((category) => ({
        id: category.id,
        label: `${category.emoji ?? '📌'} ${category.name}`,
        description: `${counts.get(category.id) ?? 0} 条`,
        detail: category.description,
      })),
    ];

    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: `选择新闻分类（数据日期 ${payload.date}）`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      return;
    }
    await sidebar?.selectCategory(picked.id);
  } catch (error) {
    reportError(error);
  }
}

function relativeDateLabel(date: string, latest: string): string {
  const diff = Math.round(
    (Date.parse(`${latest}T00:00:00`) - Date.parse(`${date}T00:00:00`)) / 86400000
  );
  if (!Number.isFinite(diff) || diff <= 0) {
    return '最新';
  }
  if (diff === 1) {
    return '昨天';
  }
  if (diff === 2) {
    return '前天';
  }
  return `${diff} 天前`;
}

/** 日期跳转：默认最新，可查看任一天的历史新闻。 */
async function pickDate(): Promise<void> {
  try {
    const payload = await loadPayload(sidebar?.currentDate, 'sidebar');
    const latest = payload.dates[0];
    if (!latest) {
      return;
    }

    const picks: Array<vscode.QuickPickItem & { date: string }> = payload.dates.map((date) => ({
      date,
      label: `$(calendar) ${date} · ${relativeDateLabel(date, latest)}`,
      description: date === latest ? '默认展示' : '历史新闻',
      detail: date === latest ? '打开插件时默认看到最新一天' : '历史数据已保留，可随时回看',
    }));

    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: `选择要查看的新闻日期（共 ${payload.dates.length} 天，默认最新）`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) {
      return;
    }

    await sidebar?.openDate(picked.date);
    await panel?.push(picked.date);
  } catch (error) {
    reportError(error);
  }
}

async function searchNews(): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: '搜索新闻',
    prompt: '按标题、摘要、来源或标签搜索当天的新闻',
    placeHolder: '例如：芯片 / 利率 / 联赛',
    value: '',
  });
  if (query === undefined) {
    return;
  }

  await sidebar?.setQuery(query);
  await panel?.setQuery(query);

  if (query.trim()) {
    void vscode.window.setStatusBarMessage(`G-要点：正在搜索“${query}”`, 2500);
  }
}

async function openDataFile(): Promise<void> {
  try {
    const index = await store.index();
    const dates = [...new Set(index.days.map((d) => d.date))].sort((a, b) => b.localeCompare(a));

    const picks: Array<vscode.QuickPickItem & { uri?: vscode.Uri }> = [
      {
        label: '$(json) index.json',
        description: '分类定义与日期索引',
        uri: store.indexPath,
      },
      ...dates.map((date) => ({
        label: `$(calendar) ${date}.json`,
        description: '当日新闻内容',
        uri: vscode.Uri.joinPath(store.dataRoot, 'data', `${date}.json`),
      })),
    ];

    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: '选择要打开的新闻数据文件',
    });
    if (!picked?.uri) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(picked.uri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    reportError(error);
  }
}

async function showAbout(): Promise<void> {
  try {
    const { index, date, day } = await store.latest();
    const total = day
      ? Object.values(day.categories).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
      : 0;
    const detail = [
      `新闻数据日期：${date ?? '无'}`,
      `分类数量：${index.categories.length} 类`,
      `当日条数：${total} 条`,
      `可用日期：${index.days.length} 天`,
      `数据目录：${store.dataRoot.fsPath}`,
      '',
      '新闻随插件版本内置，升级插件即可获得最新内容；也可配置 hotNews.localDataPath 预览本地数据。',
    ].join('\n');

    const pick = await vscode.window.showInformationMessage(
      `G-要点 v${extensionVersion()} · ${index.categories.length} 分类 · ${total} 条`,
      { modal: true, detail },
      '打开数据文件'
    );
    if (pick === '打开数据文件') {
      await openDataFile();
    }
  } catch (error) {
    reportError(error);
  }
}

function extensionVersion(): string {
  return extensionContext.extension.packageJSON?.version ?? '1.0.0';
}

async function refreshStatusBar(): Promise<void> {
  const config = vscode.workspace.getConfiguration('hotNews');
  if (!config.get<boolean>('showStatusBar', true)) {
    statusBar.hide();
    return;
  }
  try {
    const payload = await loadPayload(undefined, 'sidebar');
    statusBar.text = `$(rss) G-要点 ${payload.total}`;
    statusBar.tooltip = `G-要点 · ${payload.date} · ${payload.categories.length} 个分类，点击查看`;
    statusBar.show();
  } catch {
    statusBar.hide();
  }
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  extensionUri = context.extensionUri;
  store = new NewsStore(context.extensionUri);
  output = vscode.window.createOutputChannel('G-要点');
  context.subscriptions.push(output);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'hotNews.openPanel';
  context.subscriptions.push(statusBar);

  sidebar = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hotNews.openPanel', () => openPanel(sidebar?.currentDate)),
    vscode.commands.registerCommand('hotNews.selectDate', () => pickDate()),
    vscode.commands.registerCommand('hotNews.selectCategory', () => pickCategory()),
    vscode.commands.registerCommand('hotNews.search', () => searchNews()),
    vscode.commands.registerCommand('hotNews.refresh', async () => {
      store.invalidate();
      await Promise.all([sidebar?.push(), panel?.push()]);
      broadcast({ type: 'toast', message: '数据已刷新' });
      void refreshStatusBar();
      void vscode.window.setStatusBarMessage('G-要点：数据已刷新', 2000);
    }),
    vscode.commands.registerCommand('hotNews.openDataFile', () => openDataFile()),
    vscode.commands.registerCommand('hotNews.about', () => showAbout())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('hotNews')) {
        return;
      }
      store.invalidate();
      sidebar?.refresh();
      void panel?.push();
      void refreshStatusBar();
    })
  );

  void refreshStatusBar();
}

export function deactivate(): void {
  panel = undefined;
  sidebar = undefined;
}
