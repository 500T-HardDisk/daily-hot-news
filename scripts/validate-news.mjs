#!/usr/bin/env node
/**
 * 校验 news/index.json 与 news/data/*.json 的完整性。
 *
 * 用法：
 *   node scripts/validate-news.mjs            # 有错误时退出码为 1
 *   node scripts/validate-news.mjs --strict   # 警告也视为错误（CI 推荐）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = join(ROOT, 'news');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const error = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function readJson(file, label) {
  if (!existsSync(file)) {
    error(`${label} 不存在：${file}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    error(`${label} 不是合法的 JSON：${e.message}`);
    return undefined;
  }
}

/* ---------------- index.json ---------------- */

const indexFile = join(NEWS, 'index.json');
const index = readJson(indexFile, 'news/index.json');

let categoryIds = [];

if (index) {
  if (typeof index.version !== 'number') {
    warn('index.json 缺少 version 字段（建议为 1）');
  }
  if (!Array.isArray(index.categories)) {
    error('index.json 的 categories 必须是数组');
  } else {
    if (index.categories.length < 10) {
      error(`分类数量为 ${index.categories.length}，至少需要 10 类`);
    }
    const seen = new Set();
    for (const [i, cat] of index.categories.entries()) {
      const at = `categories[${i}]`;
      if (!cat || typeof cat !== 'object') {
        error(`${at} 必须是对象`);
        continue;
      }
      if (typeof cat.id !== 'string' || !ID_RE.test(cat.id)) {
        error(`${at}.id 非法（需为小写字母、数字或连字符）：${JSON.stringify(cat.id)}`);
      } else if (seen.has(cat.id)) {
        error(`${at}.id 重复：${cat.id}`);
      } else {
        seen.add(cat.id);
      }
      if (typeof cat.name !== 'string' || !cat.name.trim()) {
        error(`${at}.name 不能为空`);
      }
    }
    categoryIds = index.categories.map((c) => c?.id).filter((id) => typeof id === 'string');
  }

  if (!Array.isArray(index.days) || index.days.length === 0) {
    error('index.json 的 days 必须是非空数组');
  } else {
    const dates = new Set();
    for (const [i, entry] of index.days.entries()) {
      const at = `days[${i}]`;
      if (!entry || typeof entry !== 'object') {
        error(`${at} 必须是对象`);
        continue;
      }
      if (typeof entry.date !== 'string' || !DATE_RE.test(entry.date)) {
        error(`${at}.date 格式应为 YYYY-MM-DD：${JSON.stringify(entry.date)}`);
      } else if (dates.has(entry.date)) {
        error(`${at}.date 重复：${entry.date}`);
      } else {
        dates.add(entry.date);
      }
      if (typeof entry.file !== 'string' || !entry.file.endsWith('.json')) {
        error(`${at}.file 应为相对 news 目录的 json 路径`);
      }
    }

    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    const declared = index.days.map((d) => d?.date);
    if (JSON.stringify(sorted) !== JSON.stringify(declared)) {
      warn('index.json 的 days 建议按日期倒序排列（最新在前）');
    }
  }

  if (index.updatedAt && Number.isNaN(Date.parse(index.updatedAt))) {
    warn(`index.json 的 updatedAt 不是可解析的时间：${index.updatedAt}`);
  }
}

/* ---------------- data/*.json ---------------- */

let totalItems = 0;
let usedDates = [];

if (index && Array.isArray(index.days)) {
  for (const entry of index.days) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.date !== 'string') {
      continue;
    }
    usedDates.push(entry.date);

    const file = join(NEWS, entry.file);
    const label = `news/${entry.file}`;
    const day = readJson(file, label);
    if (!day) {
      continue;
    }

    if (day.date !== entry.date) {
      error(`${label} 的 date（${day.date}）与 index.json 中的日期（${entry.date}）不一致`);
    }
    if (day.updatedAt && Number.isNaN(Date.parse(day.updatedAt))) {
      warn(`${label} 的 updatedAt 不是可解析的时间：${day.updatedAt}`);
    }

    if (!day.categories || typeof day.categories !== 'object' || Array.isArray(day.categories)) {
      error(`${label} 缺少 categories 对象`);
      continue;
    }

    for (const key of Object.keys(day.categories)) {
      if (categoryIds.length && !categoryIds.includes(key)) {
        error(`${label} 中出现了未在 index.json 定义分类的键：${key}`);
      }
    }

    for (const id of categoryIds) {
      const list = day.categories[id];
      if (list === undefined) {
        warn(`${label} 缺少分类 “${id}” 字段（可留空数组）`);
        continue;
      }
      if (!Array.isArray(list)) {
        error(`${label} 的 categories.${id} 必须是数组`);
        continue;
      }

      const expected = entry.counts?.[id];
      if (typeof expected === 'number' && expected !== list.length) {
        warn(`${label} 的 categories.${id} 条数为 ${list.length}，与 index.json counts 中的 ${expected} 不一致`);
      }

      const titles = new Set();
      for (const [i, item] of list.entries()) {
        const at = `${label} → ${id}[${i}]`;
        if (!item || typeof item !== 'object') {
          error(`${at} 必须是对象`);
          continue;
        }
        if (typeof item.title !== 'string' || item.title.trim().length < 4) {
          error(`${at}.title 缺失或过短`);
        } else if (titles.has(item.title)) {
          warn(`${at}.title 与同分类其他条目重复：${item.title}`);
        } else {
          titles.add(item.title);
        }
        if (item.summary !== undefined && typeof item.summary !== 'string') {
          error(`${at}.summary 必须是字符串`);
        }
        if (item.source !== undefined && typeof item.source !== 'string') {
          error(`${at}.source 必须是字符串`);
        }
        if (item.time !== undefined && !TIME_RE.test(item.time)) {
          warn(`${at}.time 建议使用 HH:mm 格式：${item.time}`);
        }
        if (item.tags !== undefined && !Array.isArray(item.tags)) {
          error(`${at}.tags 必须是字符串数组`);
        }
        if (item.points !== undefined) {
          if (!Array.isArray(item.points)) {
            error(`${at}.points 必须是字符串数组`);
          } else {
            item.points.forEach((point, j) => {
              if (typeof point !== 'string' || !point.trim()) {
                error(`${at}.points[${j}] 必须是非空字符串`);
              }
            });
          }
        }
        if (item.table !== undefined) {
          const table = item.table;
          if (!table || typeof table !== 'object' || Array.isArray(table)) {
            error(`${at}.table 必须是对象`);
          } else {
            if (!Array.isArray(table.columns) || table.columns.length < 2) {
              error(`${at}.table.columns 至少需要 2 列`);
            } else if (!table.columns.every((c) => typeof c === 'string' && c.trim())) {
              error(`${at}.table.columns 必须是非空字符串数组`);
            }
            if (!Array.isArray(table.rows)) {
              error(`${at}.table.rows 必须是二维数组`);
            } else {
              table.rows.forEach((row, r) => {
                if (!Array.isArray(row)) {
                  error(`${at}.table.rows[${r}] 必须是数组`);
                  return;
                }
                if (Array.isArray(table.columns) && row.length !== table.columns.length) {
                  error(
                    `${at}.table.rows[${r}] 列数为 ${row.length}，与表头 ${table.columns.length} 列不一致`
                  );
                }
                row.forEach((cell, c) => {
                  if (typeof cell !== 'string') {
                    error(`${at}.table.rows[${r}][${c}] 必须是字符串`);
                  }
                });
              });
            }
          }
        }
        if (item.url !== undefined && !/^https?:\/\//.test(String(item.url))) {
          warn(`${at}.url 不是 http(s) 链接：${item.url}`);
        }
        totalItems += 1;
      }

      // 每个板块的文字量：标题 + 摘要 + 热点 + 表格文字
      const textLength = list.reduce((sum, item) => {
        if (!item || typeof item !== 'object') {
          return sum;
        }
        const points = Array.isArray(item.points) ? item.points.join('') : '';
        const table = item.table
          ? `${item.table.caption || ''}${(item.table.rows || []).flat().join('')}`
          : '';
        return sum + String(item.title || '').length + String(item.summary || '').length + points.length + table.length;
      }, 0);

      if (list.length && textLength < 1000) {
        warn(
          `${label} 的 categories.${id} 文字量约 ${textLength} 字，建议每类不少于 1000 字` +
            (id === 'geopolitics' ? '（全球局势要求 1000 字以上）' : '')
        );
      }
    }

    // 全球股市必须保留固定结构：行情表格 + 热点罗列
    if (categoryIds.includes('stocks')) {
      const stocks = day.categories.stocks;
      if (!Array.isArray(stocks) || !stocks.length) {
        error(`${label} 缺少“stocks（全球股市）”板块内容`);
      } else {
        const table = stocks.map((it) => it?.table).find((t) => t && Array.isArray(t.rows));
        if (!table) {
          error(`${label} 的全球股市板块必须包含 table 行情表`);
        } else {
          const markets = table.rows.map((row) => String(row?.[0] || '')).join(' ');
          for (const market of ['美股', '港股', 'A股', '韩股']) {
            if (!markets.includes(market)) {
              error(`${label} 的全球股市表格缺少“${market}”行`);
            }
          }
        }
        const points = stocks.flatMap((it) => (Array.isArray(it?.points) ? it.points : []));
        if (points.filter((p) => typeof p === 'string' && p.trim()).length < 3) {
          error(`${label} 的全球股市板块需要至少 3 条 points 热点罗列`);
        }
      }
    }
  }

  // 历史新闻保留：data 目录下的文件都应登记在 index.json 中
  const dataDir = join(NEWS, 'data');
  if (existsSync(dataDir)) {
    const referenced = new Set(
      index.days
        .filter((d) => d && typeof d.file === 'string')
        .map((d) => join(NEWS, d.file).toLowerCase())
    );
    for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
      if (!referenced.has(join(dataDir, file).toLowerCase())) {
        warn(`news/data/${file} 未在 index.json 的 days 中登记（历史新闻应保留并登记）`);
      }
    }
  }
}

/* ---------------- 结果 ---------------- */

if (warnings.length) {
  console.log(`\n⚠️  警告 ${warnings.length} 条：`);
  for (const w of warnings) {
    console.log(`   - ${w}`);
  }
}

if (errors.length) {
  console.error(`\n❌ 校验失败，共 ${errors.length} 个错误：`);
  for (const e of errors) {
    console.error(`   - ${e}`);
  }
  process.exit(1);
}

if (strict && warnings.length) {
  console.error('\n❌ --strict 模式下警告视为失败。');
  process.exit(1);
}

console.log('\n✅ 新闻数据校验通过');
console.log(`   分类：${categoryIds.length} 类`);
console.log(`   日期：${usedDates.length} 天（${usedDates[0] ?? '-'} ~ ${usedDates[usedDates.length - 1] ?? '-'}）`);
console.log(`   条目：${totalItems} 条`);
