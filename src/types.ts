/**
 * 新闻数据类型定义。
 * 这些类型与 news/index.json、news/data/*.json 的结构一一对应，
 * 便于维护者用任何编辑器手工更新数据。
 */

/** 分类定义（存放在 news/index.json）。 */
export interface CategoryDef {
  /** 唯一 id，用于数据文件中的键名，建议使用英文小写。 */
  id: string;
  /** 展示名称，如“科技”。 */
  name: string;
  /** 可选的表情符号，展示在分类标签前。 */
  emoji?: string;
  /** 可选的一句话说明。 */
  description?: string;
}

/** 详情页中的表格（用于全球股市、黄金行情等结构化内容）。 */
export interface NewsTable {
  /** 表格标题，可选。 */
  caption?: string;
  columns: string[];
  rows: string[][];
}

/** 市场标记，用于统计美股占比与展示角标。 */
export type NewsMarket = 'US' | 'HK' | 'CN' | 'KR' | 'EU' | 'JP' | 'OTHER';

/** 上市阶段：已上市 / 拟上市（IPO 进程中）。 */
export type NewsStage = 'listed' | 'pre-ipo';

/** 顶部重要新闻（AI 与股市板块固定 10 条）。 */
export interface NewsHighlight {
  title: string;
  detail?: string;
  market?: NewsMarket;
  stage?: NewsStage;
  /** 股票代码，可选。 */
  ticker?: string;
}

/** 详细新闻要点（AI 与股市板块固定 20 条）。 */
export interface NewsPoint {
  text: string;
  market?: NewsMarket;
  stage?: NewsStage;
  ticker?: string;
}

/** 单条新闻（纯文字，url 可选，插件不强制联网）。 */
export interface NewsItem {
  title: string;
  summary?: string;
  source?: string;
  /** 发布时间，格式 HH:mm。 */
  time?: string;
  tags?: string[];
  /** 顶部重要新闻列表（用于“10 条要闻”板块）。 */
  highlights?: NewsHighlight[];
  /** 热点罗列，每条一句话。 */
  points?: string[];
  /** 详细新闻要点（支持市场标记，用于“20 条要点”板块）。 */
  pointItems?: NewsPoint[];
  /** 结构化表格，例如美股/港股/A股/韩股行情。 */
  table?: NewsTable;
  /** 可选原文链接，仅用于手动复制，不会自动打开。 */
  url?: string;
}

/** 某一天的新闻数据文件 news/data/YYYY-MM-DD.json。 */
export interface DayFile {
  date: string;
  updatedAt?: string;
  /** 今日一句话概览。 */
  headline?: string;
  categories: Record<string, NewsItem[]>;
}

/** 数据索引 news/index.json。 */
export interface NewsIndex {
  version: number;
  updatedAt?: string;
  categories: CategoryDef[];
  days: NewsDayEntry[];
}

export interface NewsDayEntry {
  date: string;
  /** 相对于 news 目录的文件路径，例如 data/2026-11-02.json。 */
  file: string;
  counts?: Record<string, number>;
}

/** 传给 Webview 的单条新闻视图模型。 */
export interface NewsItemView extends NewsItem {
  /** 稳定 id：date|categoryId|index，用于定位与复制。 */
  id: string;
  categoryId: string;
  categoryName: string;
  date: string;
}

/** 传给 Webview 的完整数据包。 */
export interface WebviewPayload {
  mode: 'sidebar' | 'panel';
  categories: CategoryDef[];
  date: string;
  dates: string[];
  updatedAt?: string;
  headline?: string;
  total: number;
  items: NewsItemView[];
  settings: {
    defaultCategory: string;
    summaryLines: number;
  };
  /** 需要在面板中高亮/展开的新闻 id。 */
  focusId?: string;
}

/** Webview -> 扩展宿主 的消息。 */
export type WebviewInMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'selectDate'; date: string }
  | { type: 'openItem'; id: string; date: string }
  | { type: 'copyItem'; id: string; full?: boolean; titleOnly?: boolean }
  | { type: 'openPanel' };

/** 扩展宿主 -> Webview 的消息。 */
export type WebviewOutMessage =
  | { type: 'data'; payload: WebviewPayload }
  | { type: 'setCategory'; category: string }
  | { type: 'setQuery'; query: string }
  | { type: 'toast'; message: string }
  | { type: 'error'; message: string };
