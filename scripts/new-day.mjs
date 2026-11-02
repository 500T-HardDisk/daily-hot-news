#!/usr/bin/env node
/**
 * 生成某一天的新闻数据模板，并同步写入 index.json。
 *
 * 用法：
 *   node scripts/new-day.mjs                 # 使用今天日期
 *   node scripts/new-day.mjs --date=2026-11-03
 *   node scripts/new-day.mjs --date=2026-11-03 --force   # 覆盖已存在的文件
 *
 * 生成后请直接编辑 news/data/<date>.json，把各分类下的示例条目替换为当天内容。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'news');
const INDEX_FILE = join(NEWS, 'index.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dateArg = args.find((a) => a.startsWith('--date='));

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localIsoString(date = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${localDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

const date = dateArg ? dateArg.slice('--date='.length) : localDateString();

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`❌ 日期格式不正确：${date}（应为 YYYY-MM-DD）`);
  process.exit(1);
}
if (Number.isNaN(Date.parse(`${date}T00:00:00`))) {
  console.error(`❌ 无效日期：${date}`);
  process.exit(1);
}

if (!existsSync(INDEX_FILE)) {
  console.error(`❌ 未找到 ${INDEX_FILE}`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
if (!Array.isArray(index.categories) || !index.categories.length) {
  console.error('❌ index.json 中没有 categories，无法生成模板');
  process.exit(1);
}

const dayFile = join(NEWS, 'data', `${date}.json`);
if (existsSync(dayFile) && !force) {
  console.error(`❌ ${dayFile} 已存在。若确认要覆盖，请加 --force`);
  process.exit(1);
}

const categories = {};
for (const cat of index.categories) {
  categories[cat.id] = [
    {
      time: '08:00',
      title: '（示例）请替换为当天该分类的第一条新闻标题',
      summary: '一句话摘要：说明事件的核心信息、影响范围或关键数据。',
      source: '来源名称',
      tags: ['标签', '可选'],
    },
    {
      time: '12:00',
      title: '（示例）请替换为当天该分类的第二条新闻标题',
      summary: '补充背景或后续进展，保持客观、简短。',
      source: '来源名称',
    },
    {
      time: '18:00',
      title: '（示例）请替换为当天该分类的第三条新闻标题',
      summary: '建议每条新闻至少 1 条摘要，便于在侧边栏快速浏览。',
      source: '来源名称',
    },
  ];
}

const day = {
  date,
  updatedAt: localIsoString(),
  headline: `（示例）${date} 今日看点：请用一句话概括当天最重要的新闻。`,
  categories,
};

mkdirSync(join(NEWS, 'data'), { recursive: true });
writeFileSync(dayFile, `${JSON.stringify(day, null, 2)}\n`, 'utf8');

// 同步索引
index.days = Array.isArray(index.days) ? index.days : [];
const counts = {};
for (const cat of index.categories) {
  counts[cat.id] = categories[cat.id].length;
}

const existing = index.days.find((d) => d.date === date);
if (existing) {
  existing.file = `data/${date}.json`;
  existing.counts = counts;
} else {
  index.days.push({ date, file: `data/${date}.json`, counts });
}

index.days.sort((a, b) => String(b.date).localeCompare(String(a.date)));
index.updatedAt = localIsoString();
writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(`✅ 已生成 ${dayFile}`);
console.log(`✅ 已更新 ${INDEX_FILE}`);
console.log('\n下一步：');
console.log(`   1. 编辑 news/data/${date}.json，替换分类下的示例条目`);
console.log('   2. 运行 node scripts/validate-news.mjs --strict 校验');
console.log('   3. 提交并发布新版本插件，数据将随插件一起分发');
