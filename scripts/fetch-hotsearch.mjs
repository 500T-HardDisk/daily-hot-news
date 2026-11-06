#!/usr/bin/env node
/**
 * 抓取真实热搜并写入最新一天的数据。
 *
 * 数据源：今日头条热榜公开接口（https://www.toutiao.com/hot-event/hot-board/）
 * 说明：
 * - 只写入真实标题、热度、排名与原文链接，不生成或补写任何内容；
 * - 每天运行一次即可积累快照；插件运行时会合并最近 7 天的快照并取前 30 条；
 * - 不会删除历史日期文件。
 *
 * 用法：
 *   node scripts/fetch-hotsearch.mjs
 *   node scripts/fetch-hotsearch.mjs --date=2026-11-03
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_FILE = join(ROOT, 'news', 'index.json');
const INDEX = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith('--date='));

function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const dates = [...new Set(INDEX.days.map((d) => d.date))].sort((a, b) => b.localeCompare(a));
const targetDate = dateArg ? dateArg.slice('--date='.length) : dates[0];

if (!targetDate) {
  console.error('❌ index.json 中没有可用日期');
  process.exit(1);
}

const entry = INDEX.days.find((d) => d.date === targetDate);
if (!entry) {
  console.error(`❌ index.json 中没有 ${targetDate}，请先运行 npm run news:new`);
  process.exit(1);
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.toutiao.com/',
  Accept: 'application/json, text/plain, */*',
};

async function fetchToutiaoHotBoard() {
  const response = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    headers: HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`今日头条热榜请求失败：HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error('今日头条热榜返回格式异常');
  }
  return json.data;
}

function toItem(raw, index) {
  const title = String(raw.Title || '').trim();
  const url = String(raw.Url || '').trim();
  if (!title) {
    return undefined;
  }

  const heat = Number(raw.HotValue) || 0;
  const rank = index + 1;
  const label = String(raw.Label || '').trim();
  const time = localTimeString();
  const parts = [`热度 ${heat.toLocaleString('zh-CN')}`, `今日头条热榜第 ${rank} 名`, `抓取于 ${time}`];
  if (label) {
    parts.splice(2, 0, label);
  }

  return {
    time,
    title,
    summary: parts.join(' · '),
    source: '今日头条热榜',
    tags: label ? ['热搜', label] : ['热搜'],
    heat,
    rank,
    url,
  };
}

(async () => {
  try {
    const raw = await fetchToutiaoHotBoard();
    const items = raw
      .map((item, index) => toItem(item, index))
      .filter(Boolean)
      .slice(0, 30);

    if (items.length < 30) {
      console.warn(`⚠️ 热搜条数不足 30（当前 ${items.length}），仍继续写入`);
    }

    const dayFile = join(ROOT, 'news', entry.file);
    const day = JSON.parse(readFileSync(dayFile, 'utf8'));
    day.categories = day.categories || {};
    day.categories.hotsearch = items;
    day.updatedAt = new Date().toISOString();
    writeFileSync(dayFile, `${JSON.stringify(day, null, 2)}\n`, 'utf8');

    entry.counts = entry.counts || {};
    entry.counts.hotsearch = items.length;
    INDEX.updatedAt = new Date().toISOString();
    writeFileSync(INDEX_FILE, `${JSON.stringify(INDEX, null, 2)}\n`, 'utf8');

    console.log(`✅ 已写入 ${items.length} 条真实热搜到 ${entry.file}`);
    console.log(`   数据源：今日头条热榜，抓取时间：${new Date().toLocaleString()}`);
    if (items[0]) {
      console.log(`   榜首：${items[0].title}（热度 ${items[0].heat.toLocaleString('zh-CN')}）`);
    }
  } catch (error) {
    // 热搜失败不阻塞新闻发布，保留当天已有数据
    console.warn(`⚠️ 热搜抓取失败，保留现有数据：${error.message}`);
    process.exit(0);
  }
})();