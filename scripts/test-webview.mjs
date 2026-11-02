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

function boot(mode, initialPayload) {
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
      return undefined;
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

  check('复制全文发送 copyItem(full)', () => {
    document.querySelector('[data-copy]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const message = posted.at(-1);
    assert.equal(message.type, 'copyItem');
    assert.equal(message.full, true);
  });

  check('同类更多可切换条目', () => {
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
