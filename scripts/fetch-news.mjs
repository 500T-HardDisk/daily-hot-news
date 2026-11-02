#!/usr/bin/env node
/**
 * 从公开 RSS / 公开频道页抓取真实新闻，生成某一天的数据文件。
 *
 * 原则：
 * - 只使用原文标题、摘要/正文与链接，不生成、不补写、不伪造内容；
 * - 每板块 10 条，摘要截取 200–400 字，保留原文链接；
 * - 抓取失败或正文不足 200 字的条目直接丢弃，不用模板凑数。
 *
 * 用法：
 *   node scripts/fetch-news.mjs
 *   node scripts/fetch-news.mjs --date=2026-11-03
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'news');
const INDEX_FILE = join(NEWS, 'index.json');
const DATA_DIR = join(NEWS, 'data');
const LIMIT = 10;
const SUMMARY_MIN = 200;
const SUMMARY_MAX = 400;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith('--date='));
const now = new Date();
const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const TARGET_DATE = dateArg ? dateArg.slice('--date='.length) : localDate;

/* ---------------- 通用工具 ---------------- */

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…');
}

function stripHtml(value) {
  let text = String(value || '');
  for (let round = 0; round < 3; round += 1) {
    text = decodeEntities(text)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
  }
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function normalizeText(value) {
  let text = decodeEntities(value)
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  // RSS 中常因标签被替换为空格而出现“中 国新闻网”这类断字，这里合并中文之间的空白
  for (let round = 0; round < 4; round += 1) {
    text = text.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
  }
  return text
    .replace(/\s+([，。！？；：、）】》”’])/g, '$1')
    .replace(/([（【《“‘])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/([。！？；])[。！？；]+/g, '$1')
    .trim();
}

function textLength(value) {
  return [...String(value || '')].length;
}

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function timeLabel(date, fallback = '00:00') {
  if (!date) return fallback;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function keyOf(title) {
  return normalizeText(title)
    .replace(/[【】\[\]（）()《》<>“”"'’‘·—\-_:：,，.。!！?？、/\\|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 50);
}

async function fetchText(url, { referer, timeout = 20000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------------- RSS ---------------- */

function parseRss(xml, source) {
  const blocks = [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return blocks
    .map((block) => {
      const get = (tag) => {
        const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return match ? match[1] : '';
      };
      const rawTitle = stripHtml(get('title')).replace(/\s*[-_|]\s*(中国新闻网|IT之家|界面新闻|39健康网|网易娱乐)\s*$/i, '');
      const link = stripHtml(get('link') || get('guid'));
      const descHtml = get('description') || get('content:encoded') || get('content') || get('summary');
      const desc = stripHtml(descHtml);
      const date = parseDate(stripHtml(get('pubDate') || get('updated') || get('published')));
      return {
        title: normalizeText(rawTitle),
        url: link,
        desc,
        descHtml,
        date,
        source,
        time: timeLabel(date),
      };
    })
    .filter((item) => item.title && /^https?:\/\//.test(item.url));
}

/* ---------------- 频道页列表 ---------------- */

function extractAnchorList(html, { base, pattern, source }) {
  const results = [];
  const seen = new Set();
  const regex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(regex)) {
    const attrs = `${match[1]} ${match[3]}`;
    let href = match[2];
    try {
      href = new URL(href, base).href;
    } catch {
      continue;
    }
    if (!pattern.test(href) || seen.has(href)) continue;
    const titleAttr = attrs.match(/title=["']([^"']+)["']/i);
    const title = normalizeText(stripHtml(titleAttr ? titleAttr[1] : match[4]));
    if (title.length < 8 || title.length > 120) continue;
    if (/^(查看更多|阅读全文|详情|下一页|首页|登录|注册)$/.test(title)) continue;
    seen.add(href);
    results.push({ title, url: href, desc: '', source, time: '00:00' });
  }
  pattern.lastIndex = 0;
  return results;
}

/* ---------------- 正文抽取与摘要 ---------------- */

const BAD_PARAGRAPH =
  /^(责任编辑|编辑|校对|来源|原标题|作者|记者)[:：]|点击进入专题|下载.*客户端|扫描二维码|更多精彩|免责声明|以上内容不构成投资建议|版权所有|未经授权|相关阅读|海量资讯|新浪财经公众号|24小时滚动播报|原标题[:：]|（完）|返回首页|分享到/;

function extractArticle(html) {
  const cleaned = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeText(stripHtml(match[1])))
    .filter((text) => textLength(text) >= 15)
    .filter((text) => !BAD_PARAGRAPH.test(text))
    .filter((text) => !/^[（(]?图片来源/.test(text));
  const body = paragraphs.join('');
  if (textLength(body) >= SUMMARY_MIN) return body;

  const meta = cleaned.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i
  );
  const metaText = meta ? normalizeText(stripHtml(meta[1])) : '';
  if (textLength(metaText) > textLength(body)) return metaText;
  return body;
}

function cutSummary(text) {
  const normalized = normalizeText(stripHtml(text))
    .replace(/^IT之家\s*\d+\s*月\s*\d+\s*日消息[，,]\s*/, '')
    .replace(/^（?\d{4}年\d{1,2}月\d{1,2}日[，,]\s*/, '')
    .replace(/^【[^】]{2,20}】\s*/, '')
    .replace(/\s*[（(]完[）)]\s*$/, '')
    .replace(/\s*-\s*END\s*-\s*$/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[图片\]|（图片）|\(图片\)/g, '')
    .trim();

  // 不把任何残留标签当作正文
  if (/<\/?[a-z][^>]*>/i.test(normalized)) return undefined;
  if (textLength(normalized) < SUMMARY_MIN) return undefined;

  const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [normalized];
  let output = '';
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (textLength(output + sentence) > SUMMARY_MAX) break;
    output += sentence;
    if (textLength(output) >= SUMMARY_MIN) break;
  }
  if (textLength(output) < SUMMARY_MIN) {
    output = [...normalized].slice(0, SUMMARY_MAX).join('');
  }
  output = output.trim();
  if (textLength(output) > SUMMARY_MAX) {
    output = [...output].slice(0, SUMMARY_MAX).join('');
  }
  if (output && !/[。！？!?；;…]$/.test(output)) {
    output = `${output.slice(0, -1)}。`;
  }
  return textLength(output) >= SUMMARY_MIN ? output : undefined;
}

const articleCache = new Map();

async function articleText(url, referer) {
  if (!articleCache.has(url)) {
    articleCache.set(
      url,
      fetchText(url, { referer })
        .then((html) => extractArticle(html))
        .catch(() => '')
    );
  }
  return articleCache.get(url);
}

function candidateSummary(candidate) {
  const desc = candidate.desc || '';
  const descLen = textLength(desc);
  if (descLen >= SUMMARY_MIN) {
    return cutSummary(desc);
  }
  return undefined;
}

/* ---------------- 数据源 ---------------- */

const RSS_FEEDS = {
  ithome: { url: 'https://www.ithome.com/rss/', source: 'IT之家', referer: 'https://www.ithome.com/' },
  ifanr: { url: 'https://www.ifanr.com/feed/', source: '爱范儿', referer: 'https://www.ifanr.com/' },
  sspai: { url: 'https://sspai.com/feed', source: '少数派', referer: 'https://sspai.com/' },
  jiemian: {
    url: 'https://a.jiemian.com/index.php?m=article&a=rss',
    source: '界面新闻',
    referer: 'https://www.jiemian.com/',
  },
  cnFinance: { url: 'https://www.chinanews.com.cn/rss/finance.xml', source: '中国新闻网' },
  cnWorld: { url: 'https://www.chinanews.com.cn/rss/world.xml', source: '中国新闻网' },
  cnSociety: { url: 'https://www.chinanews.com.cn/rss/society.xml', source: '中国新闻网' },
  cnSports: { url: 'https://www.chinanews.com.cn/rss/sports.xml', source: '中国新闻网' },
  cnHealth: { url: 'https://www.chinanews.com.cn/rss/jk.xml', source: '中国新闻网' },
  cnEdu: { url: 'https://www.chinanews.com.cn/rss/edu.xml', source: '中国新闻网' },
  cnCulture: { url: 'https://www.chinanews.com.cn/rss/culture.xml', source: '中国新闻网' },
  cnImport: { url: 'https://www.chinanews.com.cn/rss/importnews.xml', source: '中国新闻网' },
  cnScroll: { url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', source: '中国新闻网' },
  cnLife: { url: 'https://www.chinanews.com.cn/rss/life.xml', source: '中国新闻网' },
  cnDxw: { url: 'https://www.chinanews.com.cn/rss/dxw.xml', source: '中国新闻网' },
};

const HTML_LISTS = {
  eastmoneyGold: {
    url: 'https://gold.eastmoney.com/',
    base: 'https://gold.eastmoney.com/',
    pattern: /^https?:\/\/finance\.eastmoney\.com\/a\/2026\d+\.html$/,
    source: '东方财富',
  },
  sinaGold: {
    url: 'https://finance.sina.com.cn/nmetal/',
    base: 'https://finance.sina.com.cn/',
    pattern: /^https?:\/\/finance\.sina\.com\.cn\/money\/nmetal\/2026-11-\d{2}\/doc-[^/]+\.shtml$/,
    source: '新浪财经',
  },
  neteaseEnt: {
    url: 'https://ent.163.com/',
    base: 'https://ent.163.com/',
    pattern: /^https?:\/\/www\.163\.com\/ent\/article\/[^/]+\.html$/,
    source: '网易娱乐',
  },
  eastmoneyStock: {
    url: 'https://stock.eastmoney.com/',
    base: 'https://stock.eastmoney.com/',
    pattern: /^https?:\/\/finance\.eastmoney\.com\/a\/2026\d+\.html$/,
    source: '东方财富',
  },
  health39: {
    url: 'https://www.39.net/',
    base: 'https://www.39.net/',
    pattern: /^https?:\/\/news\.39\.net\/[a-z]+\/\d{6}\/[^/]+\.html$/,
    source: '39健康网',
  },
  health39news: {
    url: 'https://news.39.net/',
    base: 'https://news.39.net/',
    pattern: /^https?:\/\/news\.39\.net\/[a-z]+\/\d{6}\/[^/]+\.html$/,
    source: '39健康网',
  },
};

const KEYWORDS = {
  ai: /人工智能|大模型|智能体|OpenAI|Anthropic|Claude|Gemini|DeepSeek|Grok|英伟达|NVIDIA|算力|混元|豆包|通义|文心|智谱|月之暗面|Kimi|具身智能|生成式|机器学习|AI\b|AI\s|AI[计芯模平]|机器人/i,
  aiExclude: /洗地机|显示器|音箱|鼠标|手柄|耳机|电视|冰箱|空调|早报|促销|降价|开售|预约|评测|上架|售价|元起|值得买/i,
  auto: /汽车|车企|特斯拉|比亚迪|奔驰|宝马|蔚来|小鹏|理想|零跑|起亚|现代|新能源车|智能驾驶|车型|SUV|轿车|充电|电池|埃安|大众|丰田|本田|吉利|奇瑞|小米汽车|问界/i,
  autoExclude: /AI 冲击|转行|早报|股价|市值|营收|利润/i,
  game: /游戏|电竞|玩家|主机|Steam|任天堂|索尼|PlayStation|Xbox|手游|世嘉|马力欧|塞尔达|模拟器|DLC|VR 街机|桌游|辐射/i,
  gameExclude: /鼠标|手柄|耳机|显示器|显卡|RTX|促销|开售|预约|价格|元起/i,
  stocks: /股价|美股|港股|A股|指数|标普|纳斯达克|道指|恒生|KOSPI|韩国|收盘|涨停|市值|IPO|财报|营收|净利润|涨跌|开盘|反弹|资金/i,
  geopolitics: /中东|伊朗|以色列|俄乌|俄罗斯|乌克兰|美国|特朗普|加沙|哈马斯|霍尔木兹|北约|冲突|袭击|停火|谈判|制裁|导弹|无人机|选举/i,
  gold: /黄金|金价|贵金属|白银|美联储|美元指数|金矿|央行购金|现货金|期货金|金饰|金条/i,
  finance: /经济|金融|银行|保险|证券|基金|债券|利率|汇率|人民币|美元|财政|货币|CPI|PPI|GDP|PMI|贸易|关税|企业|公司|市场|投资/i,
};

/* ---------------- 行情表 ---------------- */

function decodeGbk(buffer) {
  return new TextDecoder('gbk').decode(buffer);
}

async function fetchGbk(url, referer) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: referer },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decodeGbk(Buffer.from(await response.arrayBuffer()));
}

function number(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function percent(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

async function fetchStockTable() {
  const rows = [];
  try {
    const text = await fetchGbk(
      'https://qt.gtimg.cn/q=usDJI,usIXIC,usINX,hkHSI,sh000001',
      'https://gu.qq.com/'
    );
    const quotes = new Map();
    for (const match of text.matchAll(/v_(\w+)="([^"]*)"/g)) {
      const fields = match[2].split('~');
      quotes.set(match[1], {
        current: number(fields[3]),
        previous: number(fields[4]),
        pct: number(fields[32]),
      });
    }
    const add = (market, name, key) => {
      const quote = quotes.get(key);
      if (!quote) return;
      rows.push([
        market,
        name,
        formatNumber(quote.current),
        formatPercent(Number.isFinite(quote.pct) ? quote.pct : percent(quote.current, quote.previous)),
        '公开行情',
      ]);
    };
    add('美股', '道琼斯', 'usDJI');
    add('美股', '纳斯达克', 'usIXIC');
    add('美股', '标普500', 'usINX');
    add('港股', '恒生指数', 'hkHSI');
    add('A股', '上证指数', 'sh000001');
  } catch (error) {
    console.warn(`  ! 美股/港股/A股行情获取失败：${error.message}`);
  }

  try {
    const response = await fetch(
      'https://push2.eastmoney.com/api/qt/stock/get?secid=100.KS11&fields=f43,f58,f60,f170',
      { headers: { 'User-Agent': USER_AGENT, Referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(15000) }
    );
    const json = await response.json();
    const data = json?.data;
    if (data && Number.isFinite(data.f43)) {
      const current = data.f43 / 100;
      const previous = Number.isFinite(data.f60) ? data.f60 / 100 : undefined;
      const pct = Number.isFinite(data.f170) ? data.f170 / 100 : percent(current, previous);
      rows.push(['韩股', 'KOSPI', formatNumber(current), formatPercent(pct), '公开行情']);
    }
  } catch (error) {
    console.warn(`  ! 韩国 KOSPI 行情获取失败：${error.message}`);
  }

  if (!rows.length) return undefined;
  return {
    caption: `${TARGET_DATE} 公开行情快照（来源：腾讯行情 / 东方财富）`,
    columns: ['市场', '指数', '最新', '涨跌幅', '说明'],
    rows,
  };
}

async function fetchGoldTable() {
  try {
    const text = await fetchGbk('https://hq.sinajs.cn/list=hf_XAU,hf_GC,gds_AUTD', 'https://finance.sina.com.cn/');
    const quotes = new Map();
    for (const match of text.matchAll(/var hq_str_(\w+)="([^"]*)"/g)) {
      quotes.set(match[1], match[2].split(','));
    }
    const rows = [];
    const xau = quotes.get('hf_XAU');
    if (xau) {
      const current = number(xau[0]);
      const previous = number(xau[1]);
      rows.push([
        '伦敦金（现货）',
        `${formatNumber(current)} 美元/盎司`,
        formatPercent(percent(current, previous)),
        '新浪财经公开行情',
      ]);
    }
    const gc = quotes.get('hf_GC');
    if (gc) {
      const current = number(gc[0]);
      const previous = number(gc[7]);
      rows.push([
        '纽约黄金期货',
        `${formatNumber(current)} 美元/盎司`,
        formatPercent(percent(current, previous)),
        '新浪财经公开行情',
      ]);
    }
    const autd = quotes.get('gds_AUTD');
    if (autd) {
      const current = number(autd[0]);
      const previous = number(autd[2]);
      rows.push([
        '黄金延期 Au(T+D)',
        `${formatNumber(current)} 元/克`,
        formatPercent(percent(current, previous)),
        '新浪财经公开行情',
      ]);
    }
    if (!rows.length) return undefined;
    return {
      caption: `${TARGET_DATE} 贵金属公开行情（来源：新浪财经）`,
      columns: ['品种', '最新价', '日涨跌', '说明'],
      rows,
    };
  } catch (error) {
    console.warn(`  ! 黄金行情获取失败：${error.message}`);
    return undefined;
  }
}

/* ---------------- 抓取数据源 ---------------- */

console.log(`抓取日期：${TARGET_DATE}`);
console.log('读取 RSS …');
const rss = {};
await mapLimit(Object.entries(RSS_FEEDS), 5, async ([id, config]) => {
  try {
    const xml = await fetchText(config.url, { referer: config.referer });
    rss[id] = parseRss(xml, config.source);
    console.log(`  ✓ ${id}：${rss[id].length} 条`);
  } catch (error) {
    rss[id] = [];
    console.warn(`  ! ${id} 失败：${error.message}`);
  }
});

console.log('读取频道页 …');
const lists = {};
await mapLimit(Object.entries(HTML_LISTS), 4, async ([id, config]) => {
  try {
    const html = await fetchText(config.url, { referer: config.base });
    lists[id] = extractAnchorList(html, config);
    console.log(`  ✓ ${id}：${lists[id].length} 条`);
  } catch (error) {
    lists[id] = [];
    console.warn(`  ! ${id} 失败：${error.message}`);
  }
});

/* ---------------- 分类候选 ---------------- */

function candidatesFrom(items, tags = []) {
  return items.map((item) => ({
    ...item,
    key: keyOf(item.title),
    tags: [tags[0], item.source].filter(Boolean),
  }));
}

function filterCandidates(items, rules, excludes = []) {
  return items.filter((item) => {
    const text = `${item.title} ${item.desc || ''}`;
    if (rules && !rules.test(text)) return false;
    if (excludes.some((rule) => rule.test(text))) return false;
    return true;
  });
}

function dedupe(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item.key || seen.has(item.key)) continue;
    if (output.some((existing) => existing.url === item.url)) continue;
    seen.add(item.key);
    output.push(item);
  }
  return output;
}

const ithome = candidatesFrom(rss.ithome || [], ['科技']);
const ifanr = candidatesFrom(rss.ifanr || [], ['科技']);
const sspai = candidatesFrom(rss.sspai || [], ['科技']);
const jiemian = candidatesFrom(rss.jiemian || [], ['财经']);
const cnFinance = candidatesFrom(rss.cnFinance || [], ['财经']);
const cnWorld = candidatesFrom(rss.cnWorld || [], ['国际']);
const cnImport = candidatesFrom(rss.cnImport || [], ['国际']);
const cnScroll = candidatesFrom(rss.cnScroll || [], ['社会']);
const cnSociety = candidatesFrom(rss.cnSociety || [], ['社会']);
const cnSports = candidatesFrom(rss.cnSports || [], ['体育']);
const cnHealth = candidatesFrom(rss.cnHealth || [], ['健康']);
const cnLife = candidatesFrom(rss.cnLife || [], ['健康']);
const cnEdu = candidatesFrom(rss.cnEdu || [], ['教育']);
const cnCulture = candidatesFrom(rss.cnCulture || [], ['文化']);
const cnDxw = candidatesFrom(rss.cnDxw || [], ['文化']);
const eastmoneyGold = candidatesFrom(lists.eastmoneyGold || [], ['黄金行情']);
const sinaGold = candidatesFrom(lists.sinaGold || [], ['黄金行情']);
const neteaseEnt = candidatesFrom(lists.neteaseEnt || [], ['娱乐']);
const eastmoneyStock = candidatesFrom(lists.eastmoneyStock || [], ['财经']);
const health39 = candidatesFrom([...(lists.health39 || []), ...(lists.health39news || [])], ['健康']);

const aiPool = dedupe([...filterCandidates(ithome, KEYWORDS.ai, [KEYWORDS.aiExclude]), ...filterCandidates(ifanr, KEYWORDS.ai, [KEYWORDS.aiExclude])]);
const autoPool = dedupe([
  ...filterCandidates(ithome, KEYWORDS.auto, [KEYWORDS.autoExclude]),
  ...filterCandidates(ifanr, KEYWORDS.auto, [KEYWORDS.autoExclude]),
]);
const gamePool = dedupe([
  ...filterCandidates(ithome, KEYWORDS.game, [KEYWORDS.gameExclude]),
  // 游戏硬件、VR/主机与电竞产业同样属于游戏板块，作为真实新闻补充
  ...filterCandidates(ithome, /游戏手柄|VR|头显|RTX|显卡|主机|电竞|游戏/i, [/早报|降价|促销/i]),
  ...filterCandidates(ifanr, /游戏|主机|VR|电竞|掌机/i, [/早报|降价|促销/i]),
]);
const stockPool = dedupe([
  ...filterCandidates(eastmoneyStock, KEYWORDS.stocks),
  ...filterCandidates(cnFinance, KEYWORDS.stocks),
  ...jiemian.filter((item) => KEYWORDS.stocks.test(item.title)),
]);
const goldPool = dedupe([
  ...filterCandidates(eastmoneyGold, KEYWORDS.gold),
  ...filterCandidates(sinaGold, KEYWORDS.gold),
  ...filterCandidates(cnFinance, KEYWORDS.gold),
  ...filterCandidates(jiemian, KEYWORDS.gold),
]);
const geopoliticsPool = dedupe([
  ...filterCandidates(cnWorld, KEYWORDS.geopolitics),
  ...filterCandidates(cnImport, KEYWORDS.geopolitics),
]);
const aistockPool = dedupe([
  ...filterCandidates(ithome, KEYWORDS.ai, [KEYWORDS.aiExclude]).filter((item) =>
    /股价|IPO|上市|营收|财报|利润|融资|市值|收购|英伟达|NVIDIA|Anthropic|OpenAI|Marvell|Lumentum|AMD|博通|台积电/i.test(item.title)
  ),
  ...filterCandidates(eastmoneyStock, KEYWORDS.ai),
  ...filterCandidates(jiemian, KEYWORDS.ai),
]);

/* ---------------- 逐板块填充 ---------------- */

const used = new Set();
const usedUrls = new Set();
const result = {};

async function enrich(candidate) {
  const cached = candidateSummary(candidate);
  if (cached) return cached;
  try {
    const html = await articleText(candidate.url, candidate.source === '中国新闻网' ? 'https://www.chinanews.com.cn/' : undefined);
    const fromArticle = cutSummary(html);
    if (fromArticle) return fromArticle;
  } catch {
    // ignore
  }
  return cutSummary(candidate.desc || '');
}

async function fill(categoryId, candidates, { limit = LIMIT, tag } = {}) {
  const pool = dedupe(candidates).filter((item) => !used.has(item.key) && !usedUrls.has(item.url));
  const sample = pool.slice(0, 50);
  const enriched = await mapLimit(sample, 6, async (candidate) => {
    const summary = await enrich(candidate);
    return summary ? { candidate, summary } : undefined;
  });
  const items = [];
  for (const entry of enriched) {
    if (!entry) continue;
    const { candidate, summary } = entry;
    if (used.has(candidate.key) || usedUrls.has(candidate.url)) continue;
    used.add(candidate.key);
    usedUrls.add(candidate.url);
    items.push({
      time: candidate.time || '00:00',
      title: candidate.title,
      summary,
      source: candidate.source,
      tags: [tag, candidate.source].filter(Boolean),
      url: candidate.url,
    });
    if (items.length >= limit) break;
  }
  result[categoryId] = items;
  console.log(`  ${categoryId}: ${items.length}/${limit}`);
  return items;
}

console.log('生成板块 …');
await fill('aistocks', aistockPool, { tag: 'AI 与股市' });
await fill('ai', aiPool, { tag: '人工智能' });
await fill(
  'tech',
  dedupe([...ithome, ...sspai, ...ifanr]).filter(
    (item) => !KEYWORDS.auto.test(item.title) && !KEYWORDS.game.test(item.title) && !KEYWORDS.ai.test(item.title)
  ),
  { tag: '科技' }
);
await fill('auto', autoPool, { tag: '汽车' });
await fill('game', gamePool, { tag: '游戏' });
await fill('stocks', stockPool, { tag: '全球股市' });
await fill('finance', dedupe([...cnFinance, ...jiemian, ...eastmoneyStock]), { tag: '财经' });
await fill('gold', goldPool, { tag: '黄金行情' });
await fill('geopolitics', geopoliticsPool, { tag: '全球局势' });
await fill('global', dedupe([...cnWorld, ...cnImport]), { tag: '国际' });
await fill('society', dedupe([...cnSociety, ...cnScroll, ...jiemian]), { tag: '社会' });
await fill('sports', cnSports, { tag: '体育' });
await fill('entertainment', neteaseEnt, { tag: '娱乐' });
const freshHealth = (item) =>
  !item.date || item.date.getTime() >= Date.now() - 45 * 86400000;
await fill(
  'health',
  dedupe([
    ...health39,
    ...filterCandidates(cnLife, /健康|医疗|医|病|癌|药|睡眠|饮食|运动|心理|疫苗|流感|糖尿病|血压|肥胖|眼|牙|心|脑/),
    ...filterCandidates(cnHealth, /./).filter(freshHealth),
  ]),
  { tag: '健康' }
);
await fill('education', cnEdu, { tag: '教育' });
await fill('culture', dedupe([...cnCulture, ...cnDxw]), { tag: '文化' });

/* ---------------- 近一月回顾：中新网每日归档 ---------------- */

function shiftDate(base, days) {
  const date = new Date(base.getTime() - days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function monthlyCandidates() {
  const days = [];
  for (let offset = 0; offset < 30; offset += 3) {
    days.push(shiftDate(now, offset));
  }
  const candidates = [];
  await mapLimit(days, 5, async (day) => {
    const [year, month, date] = day.split('-');
    const url = `https://www.chinanews.com.cn/scroll-news/${year}/${month}${date}/news.shtml`;
    try {
      const html = await fetchText(url, { referer: 'https://www.chinanews.com.cn/' });
      const links = extractAnchorList(html, {
        base: 'https://www.chinanews.com.cn/',
        pattern: new RegExp(`/${year}/${month}-${date}/\\d+\\.shtml$`),
        source: '中国新闻网',
      });
      // 跳过当日头条，避免与前面板块重复；取每个归档日的次条要闻
      for (const item of links.slice(3, 10)) {
        const parsed = parseDate(`${year}-${month}-${date}T12:00:00+08:00`);
        candidates.push({ ...item, key: keyOf(item.title), date: parsed, time: `${month}-${date}` });
      }
    } catch {
      // ignore
    }
  });
  return candidates;
}

console.log('抓取近一月归档 …');
const monthlyPool = await monthlyCandidates();
console.log(`  候选：${monthlyPool.length} 条`);
monthlyPool.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
await fill('monthly', monthlyPool, { tag: '近一月回顾' });

/* ---------------- 行情表 ---------------- */

console.log('抓取公开行情 …');
const stockTable = await fetchStockTable();
const goldTable = await fetchGoldTable();
if (stockTable && result.stocks?.[0]) result.stocks[0].table = stockTable;
if (goldTable && result.gold?.[0]) result.gold[0].table = goldTable;

/* ---------------- 校验与写入 ---------------- */

const ORDER = [
  'hotsearch',
  'tech',
  'ai',
  'finance',
  'stocks',
  'aistocks',
  'gold',
  'global',
  'geopolitics',
  'society',
  'sports',
  'entertainment',
  'health',
  'education',
  'auto',
  'game',
  'culture',
  'monthly',
];

const shortfalls = [];
for (const id of ORDER) {
  if (id === 'hotsearch') continue;
  const count = result[id]?.length || 0;
  if (count < LIMIT) shortfalls.push(`${id} ${count}/${LIMIT}`);
}

if (shortfalls.length) {
  console.error(`\n❌ 以下板块真实新闻不足 ${LIMIT} 条：${shortfalls.join('，')}`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
const categoryMap = new Map(index.categories.map((category) => [category.id, category]));
const categories = {};

for (const id of ORDER) {
  if (id === 'hotsearch') {
    categories.hotsearch = [];
    continue;
  }
  categories[id] = result[id];
}

const counts = Object.fromEntries(ORDER.map((id) => [id, categories[id]?.length || 0]));
const day = {
  date: TARGET_DATE,
  updatedAt: new Date().toISOString(),
  headline: '今日 17 个真实新闻板块已更新：科技、AI、财经、股市、黄金、国际、局势、社会、体育、娱乐等',
  categories,
};

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(join(DATA_DIR, `${TARGET_DATE}.json`), `${JSON.stringify(day, null, 2)}\n`, 'utf8');

// 演示数据不再随包发布：索引仅保留真实日期；旧的真实日期会继续保留
const previousDays = index.days.filter((entry) => entry.date !== TARGET_DATE);
index.days = [
  {
    date: TARGET_DATE,
    file: `data/${TARGET_DATE}.json`,
    counts,
  },
  ...previousDays,
].sort((a, b) => b.date.localeCompare(a.date));
index.updatedAt = new Date().toISOString();

// 更新分类描述，确保与真实数据结构一致
if (categoryMap.has('aistocks')) {
  categoryMap.get('aistocks').description = '10 条 AI 公司与资本市场真实新闻';
}
if (categoryMap.has('monthly')) {
  categoryMap.get('monthly').description = '近一月 10 条真实要闻回顾';
}
writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(`\n✅ 已写入 news/data/${TARGET_DATE}.json`);
for (const id of ORDER) {
  if (id !== 'hotsearch') console.log(`   ${id}: ${result[id].length}`);
}
console.log(`   行情表：股票 ${stockTable ? '✓' : '✗'}，黄金 ${goldTable ? '✓' : '✗'}`);
console.log('   下一步：node scripts/fetch-hotsearch.mjs --date=' + TARGET_DATE);
