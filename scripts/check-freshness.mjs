#!/usr/bin/env node
/**
 * 检查新闻数据是否“新鲜”。
 *
 * 用法：
 *   node scripts/check-freshness.mjs            # 最新日期距今超过 1 天则失败
 *   node scripts/check-freshness.mjs --max-age=2
 *
 * CI 中用于提醒维护者每日更新新闻。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(join(ROOT, 'news', 'index.json'), 'utf8'));

const maxAgeArg = process.argv.find((a) => a.startsWith('--max-age='));
const maxAgeDays = maxAgeArg ? Number(maxAgeArg.split('=')[1]) : 1;

const dates = (index.days || []).map((d) => d.date).filter(Boolean).sort((a, b) => b.localeCompare(a));
if (!dates.length) {
  console.error('❌ index.json 中没有任何新闻日期');
  process.exit(1);
}

function todayString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const latest = dates[0];
const ageMs = Date.parse(`${todayString()}T00:00:00`) - Date.parse(`${latest}T00:00:00`);
const ageDays = Math.round(ageMs / 86400000);

console.log(`最新新闻日期：${latest}`);
console.log(`距今：${ageDays} 天（阈值 ${maxAgeDays} 天）`);

if (!Number.isFinite(ageDays)) {
  console.error('❌ 日期解析失败');
  process.exit(1);
}

if (ageDays > maxAgeDays) {
  console.error('\n❌ 新闻数据需要更新：请运行 `npm run news:new` 补充当天内容。');
  process.exit(1);
}

console.log('\n✅ 新闻数据是最新的');
