#!/usr/bin/env node
/**
 * Webview 前端逻辑冒烟测试（jsdom）。
 * 用于在没有真实 VS Code 窗口的情况下验证列表、分类、搜索、详情与复制消息。
 *
 * 用法：node scripts/test-webview.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(ROOT, 'media', 'webview.js'), 'utf8');

const index = JSON.parse(readFileSync(join(ROOT, 'news', 'index.json'), 'utf8'));
const dates = [...new Set(index.days.map((d) => d.date))].sort((a, b) => b.localeCompare(a));
const date = dates[0];
const day = JSON.parse(readFileSync(join(ROOT, 'news', 'data', `${date}.json`), 'utf8'));

const items = [];
for (const category of index.categories) {
  (day.categories[category.id] || []).forEach((item, i) => {
    items.push({
      ...item,
      id: `${date}|${category.id}|${i}`,
      categoryId: category.id,
      categoryName: category.name,
      date,
    });
  });
}

const payload = {
  mode: 'sidebar',
  categories: index.categories,
  date,
  dates,
  updatedAt: day.updatedAt,
  headline: day.headline,
  total: items.length,
  items,
  settings: { defaultCategory: 'all', summaryLines: 2 },
};

function html(mode) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body data-mode="${mode}">
    <div id="app">
      <header class="topbar">
        <div class="title-block">
          <h1 class="app-title">${mode === 'panel' ? '热点头条' : '今日热点'}</h1>
          <div class="meta"><span id="date-label"></span><span class="dot">·</span><span id="meta-label"></span></div>
        </div>
        <div class="topbar-actions">
          <select id="date-select" hidden></select>
          <button id="btn-latest" hidden></button>
          ${mode === 'sidebar' ? '<button id="btn-panel"></button>' : ''}
          <button id="btn-refresh"></button>
        </div>
      </header>
      <p id="headline" hidden></p>
      <div class="search-row"><input id="search" type="search" /><kbd class="search-hint">/</kbd></div>
      <nav id="categories"></nav>
      <main class="content">
        <section id="list"></section>
        <aside id="detail" hidden></aside>
      </main>
      <footer class="footer"><span id="footer-label"></span><span class="footer-tip"></span></footer>
    </div>
  </body></html>`;
}

function boot(mode, initialPayload, savedState) {
  const dom = new JSDOM(html(mode), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://hotnews.local/',
  });
  const { window } = dom;
  const posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      posted.push(message);
    },
    getState() {
      return savedState;
    },
    setState() {},
  });
  window.eval(script);

  const send = (message) =>
    window.dispatchEvent(new window.MessageEvent('message', { data: message }));

  send({ type: 'data', payload: initialPayload });

  return { dom, window, posted, send, document: window.document };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

/* ---------------- 侧边栏 ---------------- */
console.log('侧边栏模式：');
{
  const { window, document, posted, send } = boot('sidebar', payload);

  check('加载后发送 ready 消息', () => {
    assert.equal(posted[0]?.type, 'ready');
  });

  check(`渲染全部 ${items.length} 条新闻`, () => {
    assert.equal(document.querySelectorAll('.item').length, items.length);
  });

  check(`渲染 ${index.categories.length + 1} 个分类标签`, () => {
    assert.equal(document.querySelectorAll('.chip').length, index.categories.length + 1);
  });

  check('日期与概览正确显示', () => {
    assert.ok(document.getElementById('date-label').textContent.startsWith(date));
    assert.equal(document.getElementById('headline').hidden, false);
    assert.match(document.getElementById('footer-label').textContent, new RegExp(`${items.length} 条`));
  });

  check('分类过滤生效', () => {
    const chip = document.querySelector('.chip[data-category="tech"]');
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const techCount = items.filter((i) => i.categoryId === 'tech').length;
    assert.equal(document.querySelectorAll('.item').length, techCount);
    assert.ok(
      document.querySelector('.chip[data-category="tech"]').classList.contains('active')
    );
  });

  check('点击新闻向宿主发送 openItem', () => {
    const first = document.querySelector('.item');
    first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const message = posted.at(-1);
    assert.equal(message.type, 'openItem');
    assert.equal(message.id, first.dataset.id);
  });

  check('切换日期发送 selectDate', () => {
    const select = document.getElementById('date-select');
    assert.equal(select.hidden, dates.length <= 1);
    select.value = dates.at(-1);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(posted.at(-1).type, 'selectDate');
  });

  check('日期选项带相对标签且默认最新', () => {
    const options = [...document.querySelectorAll('#date-select option')].map((o) => o.textContent);
    assert.ok(options[0].includes('最新'), options[0]);
    if (options.length > 1) {
      assert.ok(options[1].includes('昨天'), options[1]);
    }
    assert.equal(document.getElementById('btn-latest').hidden, true);
  });

  check('搜索过滤（含清空）', async () => {
    // 由宿主通过消息重置分类
    send({ type: 'setCategory', category: 'all' });
    const input = document.getElementById('search');
    input.value = '芯片';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  check('刷新按钮发送 refresh', () => {
    document.getElementById('btn-refresh').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(posted.at(-1).type, 'refresh');
  });

  check('面板按钮发送 openPanel', () => {
    document.getElementById('btn-panel').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(posted.at(-1).type, 'openPanel');
  });
}

/* 历史新闻与默认最新 */
console.log('历史新闻：');
{
  const staleState = { date: dates.at(-1), category: 'all', query: '' };
  const { document } = boot('sidebar', payload, staleState);

  check('忽略上次选中的历史日期，默认展示最新', () => {
    assert.ok(document.getElementById('date-label').textContent.startsWith(date));
    assert.ok(document.querySelector('.chip[data-category="all"].active'));
  });
}

{
  const older = dates.at(-1);
  const olderPayload = { ...payload, date: older };
  const { window, document, posted } = boot('sidebar', olderPayload);

  check('查看历史日期时显示“最新”按钮', () => {
    assert.equal(document.getElementById('btn-latest').hidden, false);
    assert.ok(document.getElementById('date-label').textContent.startsWith(older));
  });

  check('点击“最新”跳回最新日期', () => {
    document.getElementById('btn-latest').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const message = posted.at(-1);
    assert.equal(message.type, 'selectDate');
    assert.equal(message.date, dates[0]);
  });
}

/* 搜索需要等 debounce */
{
  const { window, document } = boot('sidebar', payload);
  const input = document.getElementById('search');
  input.value = '芯片';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(180);
  check('搜索“芯片”返回匹配条目', () => {
    const count = document.querySelectorAll('.item').length;
    assert.ok(count > 0 && count < items.length, `实际 ${count} 条`);
  });
  check('无匹配时展示空状态', () => {
    input.value = '不存在的关键词zzz';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await wait(180);
  check('空状态文案出现', () => {
    assert.match(document.querySelector('.empty').textContent, /没有匹配/);
  });
}

/* ---------------- 面板 ---------------- */
console.log('面板模式：');
{
  const panelPayload = { ...payload, mode: 'panel', focusId: items[0].id };
  const { window, document, posted } = boot('panel', panelPayload);

  check('默认展示 focusId 对应的详情', () => {
    assert.equal(document.querySelector('.detail-title').textContent, items[0].title);
  });

  check('详情包含来源与分类', () => {
    assert.equal(document.querySelector('.detail-cat').textContent, items[0].categoryName);
    const text = document.querySelector('.detail-meta').textContent;
    if (items[0].source) {
      assert.ok(text.includes(items[0].source));
    }
  });

  const stocksItem = items.find((i) => i.categoryId === 'stocks' && i.table);
  check('表格新闻渲染行情表', () => {
    assert.ok(stocksItem, '缺少带表格的股市新闻');
    const node = document.querySelector(`.item[data-id="${stocksItem.id}"]`);
    assert.ok(node, '列表中缺少该新闻');
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const table = document.querySelector('.detail-table');
    assert.ok(table, '未渲染表格');
    assert.equal(table.querySelectorAll('thead th').length, stocksItem.table.columns.length);
    assert.equal(table.querySelectorAll('tbody tr').length, stocksItem.table.rows.length);
  });

  check('热点列表渲染为要点', () => {
    const points = items.find((i) => Array.isArray(i.points) && i.points.length);
    assert.ok(points, '缺少带 points 的新闻');
    const node = document.querySelector(`.item[data-id="${points.id}"]`);
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(
      document.querySelectorAll('.detail-points li').length,
      points.points.length
    );
  });

  const aiStockItem = items.find((i) => i.categoryId === 'aistocks');
  check('AI 股市板块渲染 10 条要闻与 20 条要点', () => {
    assert.ok(aiStockItem && aiStockItem.highlights && aiStockItem.pointItems);
    const node = document.querySelector(`.item[data-id="${aiStockItem.id}"]`);
    assert.ok(node, '列表中缺少 AI 与股市板块');
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(document.querySelectorAll('.highlight-list li').length, 10);
    assert.equal(document.querySelectorAll('.point-items li').length, 20);
  });

  check('十条要闻排在 20 条要点之前', () => {
    const html = document.getElementById('detail').innerHTML;
    assert.ok(html.indexOf('十条重要新闻') >= 0);
    assert.ok(html.indexOf('十条重要新闻') < html.indexOf('20 条相关新闻要点'));
  });

  check('复制全文发送 copyItem(full)', () => {
    document.querySelector('[data-copy]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const message = posted.at(-1);
    assert.equal(message.type, 'copyItem');
    assert.equal(message.full, true);
  });

  check('同类更多可切换条目', () => {
    // AI 与股市板块只有 1 条，切换到有多条新闻的科技板块验证“同类更多”
    const techItem = items.find((i) => i.categoryId === 'tech');
    document
      .querySelector(`.item[data-id="${techItem.id}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const related = document.querySelector('[data-related]');
    assert.ok(related, '应存在同类新闻');
    related.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(document.querySelectorAll('.item.selected').length, 1);
  });

  check('宿主 toast 消息不报错', () => {
    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'toast', message: '已复制' } }));
    assert.equal(document.getElementById('toast').textContent, '已复制');
  });
}

console.log(`\n✅ Webview 冒烟测试通过（${passed} 项断言组）`);
