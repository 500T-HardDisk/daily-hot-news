/**
 * 热点新闻 Webview 前端逻辑（纯原生 JS，无任何外部依赖）。
 * 与扩展宿主通过 postMessage 通信，数据全部由宿主下发。
 */
(function () {
  const vscode = acquireVsCodeApi();
  const mode = document.body.dataset.mode === 'panel' ? 'panel' : 'sidebar';

  const $ = (id) => document.getElementById(id);
  const saved = vscode.getState() || {};

  const state = {
    data: null,
    // 不恢复上次选择的日期：每次打开默认查看最新新闻
    date: null,
    category: saved.category || null,
    query: typeof saved.query === 'string' ? saved.query : '',
    selectedId: null,
    summaryLines: 2,
  };

  /* ---------------- 工具函数 ---------------- */

  function persist() {
    vscode.setState({ category: state.category, query: state.query });
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function formatDate(date) {
    if (!date) {
      return '--';
    }
    const parts = date.split('-');
    if (parts.length !== 3) {
      return date;
    }
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const weekday = isNaN(d.getTime()) ? '' : ` ${WEEKDAYS[d.getDay()]}`;
    return `${date}${weekday}`;
  }
   

  function daysBetween(later, earlier) {
    const a = new Date(`${later}T00:00:00`);
    const b = new Date(`${earlier}T00:00:00`);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) {
      return NaN;
    }
    return Math.round((a - b) / 86400000);
  }

  /** 日期下拉的展示文案：最新 / 昨天 / 前天 / 星期几。 */
  function dateOptionLabel(date, latest) {
    const diff = daysBetween(latest, date);
    if (diff === 0) {
      return `${date} · 最新`;
    }
    if (diff === 1) {
      return `${date} · 昨天`;
    }
    if (diff === 2) {
      return `${date} · 前天`;
    }
    return formatDate(date);
  }

  function toast(message) {
    let node = document.getElementById('toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => node.classList.remove('show'), 1600);
  }

  /* ---------------- 数据计算 ---------------- */

  function categories() {
    return (state.data && state.data.categories) || [];
  }

  function items() {
    return (state.data && state.data.items) || [];
  }

  function categoryOf(id) {
    return categories().find((c) => c.id === id);
  }

  function countByCategory() {
    const counts = { all: items().length };
    for (const cat of categories()) {
      counts[cat.id] = 0;
    }
    for (const item of items()) {
      counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
    }
    return counts;
  }

  function normalizeQuery(value) {
    return value.trim().toLowerCase();
  }

  function matchesQuery(item, query) {
    if (!query) {
      return true;
    }
    const haystack = [item.title, item.summary, item.source, (item.tags || []).join(' ')]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function visibleItems() {
    const query = normalizeQuery(state.query);
    return items().filter((item) => {
      if (state.category && state.category !== 'all' && item.categoryId !== state.category) {
        return false;
      }
      return matchesQuery(item, query);
    });
  }

  /* ---------------- 渲染 ---------------- */

  function renderHeader() {
    const data = state.data;
    $('date-label').textContent = formatDate(state.date);
    const counts = countByCategory();
    const active = state.category && state.category !== 'all' ? categoryOf(state.category) : null;
    const parts = [`${data.total} 条`, `${Object.keys(counts).length - 1} 个分类`];
    if (active) {
      parts.push(active.name);
    }
    $('meta-label').textContent = parts.join(' · ');

    const headline = $('headline');
    if (data.headline) {
      headline.textContent = data.headline;
      headline.hidden = false;
    } else {
      headline.hidden = true;
    }

    const select = $('date-select');
    const latest = data.dates && data.dates.length ? data.dates[0] : null;
    if (data.dates && data.dates.length > 1) {
      select.innerHTML = data.dates
        .map(
          (d) =>
            `<option value="${esc(d)}"${d === state.date ? ' selected' : ''}>${esc(
              dateOptionLabel(d, latest)
            )}</option>`
        )
        .join('');
      select.hidden = false;
      select.title = `共 ${data.dates.length} 天，默认展示最新（${latest}）`;
    } else {
      select.hidden = true;
    }

    const latestBtn = $('btn-latest');
    if (latestBtn) {
      latestBtn.hidden = !latest || state.date === latest;
    }

    $('footer-label').textContent = `共 ${data.total} 条 · 更新于 ${data.updatedAt ? data.updatedAt.replace('T', ' ').slice(0, 16) : '--'}${latest ? ` · 历史共 ${data.dates.length} 天` : ''}`;
  }

  function renderChips() {
    const counts = countByCategory();
    const html = [];
    html.push(
      `<button class="chip${!state.category || state.category === 'all' ? ' active' : ''}" data-category="all">全部<span class="count">${counts.all}</span></button>`
    );
    for (const cat of categories()) {
      const active = state.category === cat.id ? ' active' : '';
      const label = `${cat.emoji ? esc(cat.emoji) + ' ' : ''}${esc(cat.name)}`;
      html.push(
        `<button class="chip${active}" data-category="${esc(cat.id)}" title="${esc(cat.description || cat.name)}">${label}<span class="count">${counts[cat.id] || 0}</span></button>`
      );
    }
    $('categories').innerHTML = html.join('');
  }

  function itemHtml(item, query) {
    const selected = state.selectedId === item.id ? ' selected' : '';
    const summary =
      state.summaryLines > 0 && item.summary
        ? `<p class="item-summary" style="-webkit-line-clamp:${state.summaryLines}">${highlight(item.summary, query)}</p>`
        : '';
    const tags = (item.tags || [])
      .slice(0, 3)
      .map((t) => `<span class="tag">#${esc(t)}</span>`)
      .join('');
    const tableTag = item.table ? '<span class="tag tag-table">📊 表格</span>' : '';
    return `<article class="item${selected}" data-id="${esc(item.id)}" data-date="${esc(item.date)}" tabindex="0">
      <div class="item-head">
        ${item.time ? `<span class="time">${esc(item.time)}</span>` : ''}
        <span class="badge">${esc(item.categoryName)}</span>
        ${item.source ? `<span class="source">${esc(item.source)}</span>` : ''}
      </div>
      <h3 class="item-title">${highlight(item.title, query)}</h3>
      ${summary}
      ${tags || tableTag ? `<div class="tags">${tableTag}${tags}</div>` : ''}
    </article>`;
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) {
      return safe;
    }
    // 在已转义的文本上做安全高亮，避免注入。
    const escapedQuery = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp(escapedQuery, 'gi'), (m) => `<mark>${m}</mark>`);
    } catch {
      return safe;
    }
  }

  function renderList() {
    const list = $('list');
    const data = state.data;
    if (!data) {
      return;
    }

    const query = normalizeQuery(state.query);
    const list_ = visibleItems();

    if (!items().length) {
      list.innerHTML = `<div class="empty"><span class="big">📰</span>今日暂无新闻数据。<br />请检查 news/index.json 与 data 目录。</div>`;
      return;
    }

    if (!list_.length) {
      list.innerHTML = `<div class="empty"><span class="big">🔍</span>${
        query ? '没有匹配的新闻，换个关键词试试。' : '该分类今日暂无内容。'
      }</div>`;
      return;
    }

    const grouped = state.category === 'all' || !state.category;
    const html = [];
    if (grouped) {
      for (const cat of categories()) {
        const group = list_.filter((i) => i.categoryId === cat.id);
        if (!group.length) {
          continue;
        }
        html.push(
          `<h2 class="group-label">${cat.emoji ? esc(cat.emoji) + ' ' : ''}${esc(cat.name)}</h2>`
        );
        html.push(...group.map((item) => itemHtml(item, query)));
      }
    } else {
      const cat = categoryOf(state.category);
      html.push(`<h2 class="group-label">${esc(cat ? cat.name : state.category)}</h2>`);
      html.push(...list_.map((item) => itemHtml(item, query)));
    }

    list.innerHTML = html.join('');
    if (state.selectedId) {
      const node = list.querySelector(`.item[data-id="${cssEscape(state.selectedId)}"]`);
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function findItem(id) {
    return items().find((item) => item.id === id);
  }

  function renderTable(table) {
    if (!table || !Array.isArray(table.columns) || !table.columns.length) {
      return '';
    }
    const head = table.columns.map((c) => `<th>${esc(c)}</th>`).join('');
    const body = (table.rows || [])
      .map((row) => {
        const cells = table.columns.map((_, i) => `<td>${esc(row[i] ?? '')}</td>`).join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    return `<div class="table-wrap">
      ${table.caption ? `<div class="table-caption">${esc(table.caption)}</div>` : ''}
      <table class="detail-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
  }

  function renderPoints(points) {
    if (!Array.isArray(points) || !points.length) {
      return '';
    }
    return `<ul class="detail-points">${points
      .map((p) => `<li>${esc(p)}</li>`)
      .join('')}</ul>`;
  }

  function renderDetail() {
    if (mode !== 'panel') {
      return;
    }
    const detail = $('detail');
    const item = state.selectedId ? findItem(state.selectedId) : null;

    if (!item) {
      detail.innerHTML = `<div class="detail-empty"><span class="big">📰</span><span>从左侧选择一条新闻查看全文</span><span style="opacity:.6">纯文字内容，可一键复制</span></div>`;
      return;
    }

    const related = items()
      .filter((i) => i.categoryId === item.categoryId && i.id !== item.id)
      .slice(0, 6);

    detail.innerHTML = `
      <div class="detail-cat">${esc(item.categoryName)}</div>
      <h2 class="detail-title">${esc(item.title)}</h2>
      <div class="detail-meta">
        ${item.time ? `<span>🕘 ${esc(item.time)}</span>` : ''}
        ${item.source ? `<span>来源：${esc(item.source)}</span>` : ''}
        <span>${esc(formatDate(item.date))}</span>
        ${item.tags && item.tags.length ? `<span>${item.tags.map((t) => '#' + esc(t)).join(' ')}</span>` : ''}
      </div>
      <div class="detail-body">${esc(item.summary || item.title)}</div>
      ${renderTable(item.table)}
      ${renderPoints(item.points)}
      ${item.url ? `<div class="detail-body" style="font-size:11.5px;opacity:.7;margin-top:10px">原文链接（可复制）：${esc(item.url)}</div>` : ''}
      <div class="detail-actions">
        <button class="btn primary" data-copy="${esc(item.id)}">复制全文</button>
        <button class="btn" data-copy-title="${esc(item.id)}">只复制标题</button>
      </div>
      ${
        related.length
          ? `<div class="related"><h4>同类更多</h4>${related
              .map(
                (r) =>
                  `<button class="related-item" data-related="${esc(r.id)}">${esc(r.title)}</button>`
              )
              .join('')}</div>`
          : ''
      }
    `;
  }

  function renderAll() {
    renderHeader();
    renderChips();
    renderList();
    renderDetail();
  }

  function renderError(message) {
    state.data = null;
    $('date-label').textContent = '--';
    $('meta-label').textContent = '';
    $('headline').hidden = true;
    $('categories').innerHTML = '';
    $('date-select').hidden = true;
    const latestBtn = $('btn-latest');
    if (latestBtn) {
      latestBtn.hidden = true;
    }
    $('footer-label').textContent = '数据加载失败';
    $('list').innerHTML = `<div class="empty"><span class="big">⚠️</span>${esc(
      message || '未知错误'
    )}<br />请检查 news/index.json 与 news/data 目录。</div>`;
    if (mode === 'panel') {
      $('detail').innerHTML = '<div class="detail-empty"><span class="big">⚠️</span><span>数据加载失败</span></div>';
    }
  }

  /* ---------------- 状态同步 ---------------- */

  function applyData(payload) {
    const previousDate = state.date;
    state.data = payload;
    state.summaryLines = typeof payload.settings.summaryLines === 'number' ? payload.settings.summaryLines : 2;
    state.date = payload.date;

    const valid = new Set(['all', ...payload.categories.map((c) => c.id)]);
    if (!state.category || !valid.has(state.category)) {
      const preferred = payload.settings.defaultCategory || 'all';
      state.category = valid.has(preferred) ? preferred : 'all';
    }

    if (payload.focusId) {
      state.selectedId = payload.focusId;
    } else if (payload.date !== previousDate) {
      state.selectedId = null;
    }

    persist();
    renderAll();
  }

  /* ---------------- 事件绑定 ---------------- */

  $('categories').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) {
      return;
    }
    state.category = chip.dataset.category;
    persist();
    renderChips();
    renderList();
    $('list').scrollTop = 0;
  });

  $('list').addEventListener('click', (event) => {
    const node = event.target.closest('.item');
    if (!node) {
      return;
    }
    selectItem(node.dataset.id);
  });

  $('list').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const node = event.target.closest('.item');
    if (!node) {
      return;
    }
    event.preventDefault();
    selectItem(node.dataset.id);
  });

  function selectItem(id) {
    const item = findItem(id);
    if (!item) {
      return;
    }
    if (mode === 'panel') {
      state.selectedId = id;
      renderList();
      renderDetail();
      if (window.innerWidth < 720 && typeof $('detail').scrollIntoView === 'function') {
        $('detail').scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      state.selectedId = id;
      post({ type: 'openItem', id, date: state.date });
    }
  }

  $('detail').addEventListener('click', (event) => {
    const copyBtn = event.target.closest('[data-copy]');
    if (copyBtn) {
      post({ type: 'copyItem', id: copyBtn.dataset.copy, full: true });
      return;
    }
    const titleBtn = event.target.closest('[data-copy-title]');
    if (titleBtn) {
      post({ type: 'copyItem', id: titleBtn.dataset.copyTitle, titleOnly: true });
      return;
    }
    const related = event.target.closest('[data-related]');
    if (related) {
      selectItem(related.dataset.related);
    }
  });

  let searchTimer;
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    persist();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 90);
  });

  $('search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.target.value = '';
      state.query = '';
      persist();
      renderList();
    }
  });

  $('date-select').addEventListener('change', (event) => {
    post({ type: 'selectDate', date: event.target.value });
  });

  const latestButton = $('btn-latest');
  if (latestButton) {
    latestButton.addEventListener('click', () => {
      const dates = (state.data && state.data.dates) || [];
      if (dates.length) {
        post({ type: 'selectDate', date: dates[0] });
      }
    });
  }

  $('btn-refresh').addEventListener('click', () => post({ type: 'refresh' }));

  const panelBtn = $('btn-panel');
  if (panelBtn) {
    panelBtn.addEventListener('click', () => post({ type: 'openPanel' }));
  }

  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (event.key === '/' && tag !== 'input' && tag !== 'textarea') {
      event.preventDefault();
      $('search').focus();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }
    switch (message.type) {
      case 'data':
        applyData(message.payload);
        break;
      case 'setCategory':
        state.category = message.category;
        persist();
        renderChips();
        renderList();
        break;
      case 'setQuery':
        state.query = message.query || '';
        $('search').value = state.query;
        persist();
        renderList();
        break;
      case 'toast':
        toast(message.message);
        break;
      case 'error':
        renderError(message.message);
        break;
      default:
        break;
    }
  });

  // 恢复上次搜索词
  if (state.query) {
    $('search').value = state.query;
  }

  post({ type: 'ready' });
})();
