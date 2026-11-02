import * as path from 'node:path';
import * as vscode from 'vscode';
import { DayFile, NewsIndex } from './types';

const decoder = new TextDecoder('utf-8');

/**
 * 新闻数据仓库。
 *
 * 默认读取插件安装包内自带的 `news` 目录（离线可用）；
 * 若用户配置了 `hotNews.localDataPath`，则改为读取该本地目录，
 * 方便维护者在仓库中编辑数据后立即预览。
 */
export class NewsStore {
  private indexCache: NewsIndex | undefined;
  private readonly dayCache = new Map<string, DayFile>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** 当前生效的数据根目录（其下应有 index.json 与 data/）。 */
  get dataRoot(): vscode.Uri {
    const configured = vscode.workspace
      .getConfiguration('hotNews')
      .get<string>('localDataPath', '')
      .trim();

    if (configured) {
      const folders = vscode.workspace.workspaceFolders;
      const resolved =
        path.isAbsolute(configured) || !folders?.length
          ? configured
          : path.join(folders[0].uri.fsPath, configured);
      return vscode.Uri.file(resolved);
    }

    return vscode.Uri.joinPath(this.extensionUri, 'news');
  }

  invalidate(): void {
    this.indexCache = undefined;
    this.dayCache.clear();
  }

  private async readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(decoder.decode(bytes)) as T;
    } catch {
      return undefined;
    }
  }

  async index(force = false): Promise<NewsIndex> {
    if (!force && this.indexCache) {
      return this.indexCache;
    }

    const uri = vscode.Uri.joinPath(this.dataRoot, 'index.json');
    const data = await this.readJson<NewsIndex>(uri);
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.days)) {
      throw new Error(
        `无法读取新闻索引：${uri.fsPath}。请确认文件中包含 categories 与 days 字段。`
      );
    }

    this.dayCache.clear();
    this.indexCache = data;
    return data;
  }

  /** 按日期读取一天的数据（带缓存）。 */
  async day(date: string): Promise<DayFile | undefined> {
    const cached = this.dayCache.get(date);
    if (cached) {
      return cached;
    }

    const index = await this.index();
    const entry = index.days.find((d) => d.date === date);
    if (!entry) {
      return undefined;
    }

    const data = await this.readJson<DayFile>(
      vscode.Uri.joinPath(this.dataRoot, entry.file)
    );
    if (data) {
      this.dayCache.set(date, data);
    }
    return data;
  }

  /** 所有可用日期，按时间倒序（最新在前）。 */
  async dates(): Promise<string[]> {
    const index = await this.index();
    return [...new Set(index.days.map((d) => d.date))].sort((a, b) =>
      b.localeCompare(a)
    );
  }

  async latest(): Promise<{ index: NewsIndex; date?: string; day?: DayFile }> {
    const index = await this.index();
    const dates = await this.dates();
    const date = dates[0];
    const day = date ? await this.day(date) : undefined;
    return { index, date, day };
  }

  /** 某一天数据文件的绝对路径（优先使用 index 中登记的相对路径）。 */
  async dayFileUri(date: string): Promise<vscode.Uri | undefined> {
    const index = await this.index();
    const entry = index.days.find((d) => d.date === date);
    if (!entry) {
      return undefined;
    }
    return vscode.Uri.joinPath(this.dataRoot, entry.file);
  }

  get indexPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.dataRoot, 'index.json');
  }
}
