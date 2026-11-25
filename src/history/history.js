/* =============================================================================
   TabAgain · 历史页
   · 全部记录分块流式加载（首块立即渲染），按页显示（每页条数见设置），页内虚拟列表
   · 底部浮动分页器：页码 · 跳页；[ ] 或 Alt+←/→ 翻页；页码写入地址栏 #p=
   · 时间轴滚动条：刻度覆盖全部记录，拖动跨页定位，浮出月份气泡
   · 多选：勾选框 / ⌘ 或 Ctrl 点击 / Shift 连选；按天全选；批量恢复与删除
   ============================================================================= */
import { $, t, tn, num, send, VirtualList, tooltip, contextMenu, createToast, flyToCorner, collapseRow, setFavicon, monthKey, monthLabel, icon, createPager, slideIn } from '../shared/ui.js';
import { getSettings, normalize } from '../shared/settings.js';
import { keyOf, buildItems, createItem, renderItem, tipInfo } from '../shared/rows.js';
import { parseQuery } from '../shared/text.js';
import { createSiteRail } from '../shared/site-rail.js';
import { streamTop, countTop, children, topHosts } from '../shared/db.js';

const scroller = $('#scroller');
const searchEl = $('#search');
const searchWrap = $('#search-wrap');
const toast = createToast($('#toast'));

const state = {
  all: [], loaded: false, total: 0,
  results: null, searching: false, query: '', host: '',
  expanded: new Map(),
  selected: new Set(), anchor: null,
  fullSids: new Set(),
  page: 1, rpage: 1
};
let PAGE = 50;
let items = [];
const worker = new Worker(new URL('../shared/search-worker.js', import.meta.url), { type: 'module' });

const ctx = {
  get now() { return Date.now(); },
  get terms() { return state.results ? parseQuery(state.query).terms : []; },
  get fullSids() { return state.fullSids; },
  get selected() { return state.selected; },
  showWindowTag: true,
  decorateHeader(el, item) {
    let acts = el.querySelector('.head-acts');
    if (!acts) {
      acts = document.createElement('span');
      acts.className = 'head-acts';
      acts.innerHTML = `<button class="head-btn" data-head="select"></button><button class="head-btn" data-head="restore"></button>`;
      el.append(acts);
    }
    const recs = groupRecs(item.gkey);
    const all = recs.length && recs.every((r) => state.selected.has(r.id));
    acts.querySelector('[data-head="select"]').textContent = all ? t('deselectGroup') : t('selectGroup');
    acts.querySelector('[data-head="restore"]').textContent = t('restoreGroup');
  }
};

/* ---------- 虚拟列表 ---------- */
const list = new VirtualList({
  scroller,
  content: $('#list'),
  sticky: $('#sticky'),
  heights: { h: 40, r: 52, w: 52, c: 42 },
  overscan: 10,
  bottomInset: 100,
  keyOf,
  create: (type) => createItem(type, { selectable: true }),
  render: (el, item) => renderItem(el, item, ctx),
  renderSticky: (el, item) => {
    el.querySelector('.label').textContent = item.label;
    el.querySelector('.n').textContent = item.count ? num(item.count) : '';
  },
  onRange: () => updateThumb()
});

/* ---------- 分页 ---------- */
const source = () => state.results || state.all;
const curPage = () => (state.results ? state.rpage : state.page);
const totalOf = () => (state.results ? state.results.length : Math.max(state.total, state.all.length));
const pageCount = () => Math.max(1, Math.ceil(totalOf() / PAGE));
const pageStart = () => (curPage() - 1) * PAGE;

const pager = createPager($('#pager'), { onChange: (p, dir) => setPage(p, { dir }) });

function setPage(p, { dir = 0, scrollTo = 0 } = {}) {
  p = Math.max(1, Math.min(pageCount(), p));
  if (state.results) state.rpage = p; else state.page = p;
  clearSelection(false);
  scroller.scrollTop = scrollTo;
  rebuild();
  if (dir) slideIn($('#list'), dir);
  if (!state.results) history.replaceState(null, '', p > 1 ? '#p=' + p : location.pathname);
}
function flipPage(dir) {
  const p = curPage() + dir;
  if (p >= 1 && p <= pageCount()) { pager.go(p); }
}
function syncPager(animate) {
  pager.set(curPage(), pageCount(), !!state.results && state.searching, animate);
  document.body.classList.toggle('paged', !$('#pager').hidden);
}

function rebuild({ flip = false, transition = false } = {}) {
  // 本页超出范围（删除后页数变少）时退回最后一页
  if (curPage() > pageCount()) { if (state.results) state.rpage = pageCount(); else state.page = pageCount(); }
  const start = pageStart();
  const recs = source().slice(start, start + PAGE);
  const next = buildItems(recs, { expanded: state.results ? new Map() : state.expanded, counts: true });
  const apply = () => { items = next; list.setItems(items, { flip: flip && !transition }); };
  if (transition) list.transition(apply); else apply();
  const keys = selectable();
  if (list.activeKey && !keys.includes(list.activeKey)) list.setActive(null);
  buildTimeline();
  updateChrome();
}

const selectable = () => items.filter((it) => it.type !== 'h').map(keyOf);
const groupRecs = (gkey) => items.filter((it) => it.gkey === gkey && (it.type === 'r' || it.type === 'w')).map((it) => it.rec);

function updateChrome() {
  $('#count').textContent = state.total ? tn('countRecords', state.total, [num(state.total)]) : '';
  const searching = !!state.results;
  const empty = !items.length && !(searching && state.searching) && state.loaded;
  $('#empty').hidden = !empty;
  if (empty) {
    $('#empty-title').textContent = searching ? t('noResultTitle') : t('emptyTitle');
    $('#empty-hint').textContent = searching ? t('noResultHint') : t('emptyHint');
  }
  syncPager(true);
  const status = $('#status');
  const n = items.filter((it) => it.type === 'r' || it.type === 'w').length;
  if (n && pageCount() > 1) {
    const from = pageStart() + 1;
    status.textContent = t('pageRange', [num(from), num(from + n - 1), num(totalOf())]) + (state.results && state.searching ? '…' : '');
  } else if (searching && !state.searching && n) status.textContent = tn('resultCount', state.results.length, [num(state.results.length)]);
  else status.textContent = '';
  status.hidden = !status.textContent;

  const info = $('#filter-info');
  info.hidden = !state.host;
  if (state.host) {
    const n = state.results?.length ?? 0;
    $('#filter-text').textContent = state.searching ? state.host : t('siteRecords', [state.host, num(n)]);
    $('#filter-delete').textContent = t('deleteSite');
    $('#filter-delete').hidden = state.searching || !n;
  }
  document.body.classList.toggle('selecting', state.selected.size > 0);
  const bar = $('#selbar');
  bar.classList.toggle('show', state.selected.size > 0);
  if (state.selected.size) $('#sel-count').textContent = t('selectedCount', [num(state.selected.size)]);
}

/* ---------- 加载 ---------- */
async function loadAll() {
  state.loaded = false;
  state.total = await countTop();
  const acc = [];
  let first = true, lastBuild = 0;
  await streamTop(async (chunk) => {
    for (const r of chunk) acc.push(r);
    state.all = acc;
    // 首块立即渲染；之后每 400ms 合并一次重建，避免 O(n²)
    const now = performance.now();
    const need = state.page * PAGE;   // 当前页已读全就不必再重建列表，只更新时间轴
    if (!state.results && (first || (now - lastBuild > 400 && (acc.length - chunk.length < need || now - lastBuild > 1500)))) { rebuild(); lastBuild = performance.now(); }
    first = false;
  }, 300, 4000);
  state.all = acc;
  state.loaded = true;
  if (!state.results) rebuild();
  else updateChrome();
  worker.postMessage({ type: 'warm' });   // 空闲时把搜索索引读进内存，之后每次输入只扫内存
}

/* ---------- 搜索 ---------- */
let qid = 0, debounce = 0, acc = { id: 0, recs: [] };

function runSearch() {
  if (!state.query.trim() && !state.host) {
    state.results = null; state.searching = false; setSpinner(false);
    scroller.scrollTop = 0;
    rebuild({ transition: true });
    return;
  }
  state.searching = true;
  state.rpage = 1;
  setSpinner(true);
  worker.postMessage({ type: 'search', qid: ++qid, raw: state.query, host: state.host, first: Math.max(60, PAGE) });
}
worker.onmessage = ({ data }) => {
  if (data.qid !== qid) return;
  const firstBatch = acc.id !== data.qid;
  if (firstBatch) acc = { id: data.qid, recs: [] };
  acc.recs.push(...data.recs);
  state.results = acc.recs;
  state.searching = !data.done;
  setSpinner(!data.done);
  if (firstBatch) { scroller.scrollTop = 0; clearSelection(false); rebuild({ transition: true }); }
  else if (state.rpage >= pageCount() - 1 || data.done) rebuild();   // 只有末页会因新结果而变化
  else { syncPager(); buildTimeline(); }
};
function setSpinner(on) {
  let sp = searchWrap.querySelector('.spinner');
  if (on && !sp) { sp = document.createElement('span'); sp.className = 'spinner'; searchWrap.append(sp); }
  if (!on && sp) sp.remove();
}
searchEl.addEventListener('input', () => {
  state.query = searchEl.value;
  searchWrap.classList.toggle('has-value', !!searchEl.value);
  $('#search-clear').hidden = !searchEl.value;
  clearTimeout(debounce);
  debounce = setTimeout(runSearch, 80);
});
$('#search-clear').addEventListener('click', (e) => { e.preventDefault(); searchEl.value = ''; searchEl.dispatchEvent(new Event('input')); searchEl.focus(); });

/* ---------- 站点筛选 ---------- */
const rail = createSiteRail($('#chips'), {
  limit: 20,
  onSelect(host) { state.host = host; runSearch(); }
});
async function loadChips() {
  const nav = $('#chips');
  if (document.body.classList.contains('no-chips')) { nav.hidden = true; return; }
  const n = rail.set(await topHosts(Infinity));
  nav.hidden = n < 2;
  if (state.host && !rail.selected) { state.host = ''; runSearch(); }
}
$('#filter-delete').addEventListener('click', () => {
  const host = state.host;
  const n = state.results?.length || 0;
  confirmDialog({
    icon: 'trash', danger: true,
    title: t('deleteSiteTitle', [host]), body: tn('deleteSiteBody', n, [num(n)]), ok: t('delete'),
    run: async () => {
      await send({ type: 'clearRange', host });
      state.host = '';
      rail.select('');
      toast(t('deletedCount', [num(n)]));
    }
  });
});

/* ---------- 时间轴滚动条 ---------- */
const scrub = { months: [], dragging: false };

function buildTimeline() {
  const track = $('#track');
  const recs = source();
  const N = recs.length;
  const months = [];
  let last = null;
  for (let i = 0; i < N; i++) {
    const ts = recs[i].closedAt;
    const mk = monthKey(ts);
    if (mk !== last) { months.push({ mk, ts, idx: i }); last = mk; }
  }
  scrub.months = months;
  track.textContent = '';
  const h = track.clientHeight || scroller.clientHeight;
  const show = N > 0 && (pageCount() > 1 || list.total > scroller.clientHeight * 2.5);
  $('#scrubber').classList.toggle('ready', show && state.loaded);
  if (!show) return;
  let lastLabelY = -99;
  const frag = document.createDocumentFragment();
  months.forEach((m, i) => {
    const y = (m.idx / N) * h;
    const d = new Date(m.ts);
    const yearStart = i === 0 || new Date(months[i - 1].ts).getFullYear() !== d.getFullYear();
    const tick = document.createElement('i');
    tick.className = 'tick' + (yearStart && i ? ' year' : '');
    tick.style.top = y + 'px';
    frag.append(tick);
    if (y - lastLabelY > 16) {
      const label = document.createElement('span');
      label.className = 'tick-label' + (yearStart && i ? ' year' : '');
      label.style.top = y + 'px';
      label.textContent = yearStart && i ? String(d.getFullYear()) : new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { month: 'short' }).format(d);
      frag.append(label);
      lastLabelY = y;
    }
  });
  // 页边界：细点标出每一页的起点（页数不多时）
  const pages = pageCount();
  if (pages > 1 && pages <= 60) {
    for (let p = 1; p < pages; p++) {
      const dot = document.createElement('i');
      dot.className = 'page-dot';
      dot.style.top = (p * PAGE / N) * h + 'px';
      frag.append(dot);
    }
  }
  track.append(frag);
  updateThumb();
}

/** 当前位置在全部记录中的序号（页起点 + 页内滚动比例） */
function updateThumb() {
  const N = source().length;
  if (!N) return;
  const h = $('#track').clientHeight;
  const thumb = $('#thumb');
  const n = Math.min(PAGE, N - pageStart());
  const room = Math.max(1, list.total - scroller.clientHeight);
  const visible = Math.min(1, scroller.clientHeight / Math.max(1, list.total));
  const at = pageStart() + Math.min(1, scroller.scrollTop / room) * n * (1 - visible);
  thumb.style.top = (at / N) * h + 'px';
  thumb.style.height = Math.max(18, (n * visible / N) * h) + 'px';
}

function monthAt(idx) {
  let m = scrub.months[0];
  for (const x of scrub.months) { if (x.idx <= idx) m = x; else break; }
  return m;
}

/** 拖到全部记录中的第 idx 条：必要时换页，再在页内滚到那一行 */
function scrubTo(clientY) {
  const track = $('#track').getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientY - track.top) / track.height));
  const recs = source();
  const idx = Math.min(recs.length - 1, Math.floor(frac * recs.length));
  if (idx < 0) return;
  const p = Math.floor(idx / PAGE) + 1;
  if (p !== curPage()) {
    if (state.results) state.rpage = p; else state.page = p;
    clearSelection(false);
    rebuild();
    if (!state.results) history.replaceState(null, '', p > 1 ? '#p=' + p : location.pathname);
  }
  const i = list.indexOfKey(recs[idx].id);
  if (i > -1) scroller.scrollTop = Math.max(0, list.tops[i] - list.heights.h - 8);
  const m = monthAt(idx);
  const bubble = $('#bubble');
  bubble.textContent = m ? monthLabel(m.ts) : '';
  bubble.style.top = frac * track.height + 'px';
}

const scrubber = $('#scrubber');
scrubber.addEventListener('pointerdown', (e) => {
  scrub.dragging = true;
  scrubber.setPointerCapture(e.pointerId);
  scrubber.classList.add('dragging', 'show-bubble');
  scrubTo(e.clientY);
});
scrubber.addEventListener('pointermove', (e) => {
  if (scrub.dragging) return scrubTo(e.clientY);
  const track = $('#track').getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientY - track.top) / track.height));
  const m = monthAt(Math.floor(frac * source().length));
  $('#bubble').textContent = m ? monthLabel(m.ts) : '';
  $('#bubble').style.top = frac * track.height + 'px';
  scrubber.classList.add('show-bubble');
});
const endScrub = () => { scrub.dragging = false; scrubber.classList.remove('dragging', 'show-bubble'); };
scrubber.addEventListener('pointerup', endScrub);
scrubber.addEventListener('pointercancel', endScrub);
scrubber.addEventListener('pointerleave', () => { if (!scrub.dragging) scrubber.classList.remove('show-bubble'); });
new ResizeObserver(() => buildTimeline()).observe(scroller);

/* ---------- 选择 ---------- */
function toggleSelect(key, range = false) {
  const it = items.find((x) => keyOf(x) === key);
  if (!it || it.type === 'c') return;
  if (range && state.anchor) {
    const keys = items.filter((x) => x.type === 'r' || x.type === 'w').map(keyOf);
    const a = keys.indexOf(state.anchor), b = keys.indexOf(key);
    if (a > -1 && b > -1) keys.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((k) => state.selected.add(k));
  } else {
    if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
    state.anchor = key;
  }
  list.render(true);
  updateChrome();
}
function clearSelection(render = true) {
  if (!state.selected.size && !state.anchor) return;
  state.selected.clear(); state.anchor = null;
  if (render) { list.render(true); updateChrome(); }
}

/* ---------- 操作 ---------- */
const itemOf = (key) => items.find((it) => keyOf(it) === key);

function dropLocal(ids, updated = []) {
  const gone = new Set(ids);
  const keep = (r) => !gone.has(r.id);
  const patch = (r) => updated.find((u) => u.id === r.id) || r;
  state.all = state.all.filter(keep).map(patch);
  if (state.results) state.results = state.results.filter(keep).map(patch);
  for (const id of gone) state.selected.delete(id);
  for (const [wid, kids] of state.expanded) {
    if (gone.has(wid)) { state.expanded.delete(wid); continue; }
    const left = kids.filter(keep);
    if (left.length) state.expanded.set(wid, left); else state.expanded.delete(wid);
  }
}

async function restore(key, active) {
  const item = itemOf(key);
  if (!item || item.type === 'h') return;
  const el = list.elementFor(key);
  if (!active) { flyToCorner(el?.querySelector('.fav')); await collapseRow(el, 'shrink'); }
  const res = await send({ type: 'restore', id: item.rec.id, active });
  if (!res?.ok) { toast(t('restoreFailed')); return list.render(true); }
  dropLocal([item.rec.id]);
  rebuild({ flip: true });
}

async function removeKeys(keys) {
  const recs = keys.map(itemOf).filter(Boolean).map((it) => it.rec);
  if (!recs.length) return;
  await Promise.all(keys.slice(0, 30).map((k) => collapseRow(list.elementFor(k), 'left')));
  const res = await send({ type: 'remove', ids: recs.map((r) => r.id) });
  if (!res?.ok) return list.render(true);
  dropLocal(res.removed.map((r) => r.id));
  rebuild({ flip: true });
  const n = res.removed.filter((r) => r.kind === 'tab').length;
  toast(n > 1 ? t('deletedCount', [num(n)]) : t('removed'), () => send({ type: 'reinsert', records: res.removed }));
}

async function restoreKeys(keys) {
  const recs = keys.map(itemOf).filter(Boolean).map((it) => it.rec);
  const tabs = recs.reduce((n, r) => n + (r.kind === 'window' ? r.count : 1), 0);
  const go = async () => {
    const res = await send({ type: 'restoreMany', ids: recs.map((r) => r.id) });
    if (!res?.ok) return toast(t('restoreFailed'));
    dropLocal(recs.map((r) => r.id));
    clearSelection();
    rebuild({ flip: true });
    toast(tn('restoredCount', res.count, [num(res.count)]));
  };
  if (tabs > 10) {
    confirmDialog({ icon: 'window', title: t('restoreManyTitle', [num(tabs)]), body: t('restoreManyBody'), ok: t('restore'), run: go });
  } else go();
}

async function toggleWindow(key, open) {
  const item = itemOf(key);
  if (!item || item.type !== 'w') return;
  const isOpen = state.expanded.has(key);
  if (open === isOpen) return;
  if (isOpen) state.expanded.delete(key); else state.expanded.set(key, await children(key));
  rebuild({ flip: true });
  if (!isOpen) revealChildren(key);
}

/* ---------- 对话框 ---------- */
function confirmDialog({ icon: name, danger, title, body, ok, extra, run }) {
  const dlg = $('#dialog');
  const ic = $('#dlg-icon');
  ic.className = 'dlg-icon' + (danger ? ' danger' : '');
  ic.textContent = '';
  ic.append(icon(name));
  $('#dlg-title').textContent = title;
  $('#dlg-body').textContent = body || '';
  $('#dlg-body').hidden = !body;
  const ex = $('#dlg-extra');
  ex.textContent = '';
  if (extra) ex.append(extra);
  const okBtn = $('#dlg-ok');
  okBtn.textContent = ok;
  okBtn.className = 'btn ' + (danger ? 'destructive' : 'primary');
  $('#scrim').hidden = false;
  dlg.hidden = false;
  okBtn.focus();
  const close = () => { $('#scrim').hidden = true; dlg.hidden = true; okBtn.onclick = null; };
  okBtn.onclick = async () => { close(); await run(); };
  $('#dlg-cancel').onclick = close;
  $('#scrim').onclick = close;
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
}

/** 按时间范围清除 */
function clearRangeDialog() {
  const ranges = [
    ['hour', t('rangeHour'), () => ({ since: Date.now() - 36e5 })],
    ['today', t('rangeToday'), () => { const d = new Date(); d.setHours(0, 0, 0, 0); return { since: d.getTime() }; }],
    ['week', t('range7d'), () => ({ since: Date.now() - 7 * 864e5 })],
    ['all', t('rangeAll'), () => ({ all: true })]
  ];
  let pick = 'hour';
  const seg = document.createElement('div');
  seg.className = 'segmented';
  seg.setAttribute('role', 'radiogroup');
  seg.innerHTML = '<span class="thumb"></span>';
  for (const [v, label] of ranges) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.dataset.value = v;
    b.textContent = label;
    b.setAttribute('aria-checked', String(v === pick));
    seg.append(b);
  }
  const place = () => {
    const on = seg.querySelector('[aria-checked="true"]');
    const thumb = seg.querySelector('.thumb');
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.left = '2px';
    thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`;
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pick = b.dataset.value;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    place();
  });
  confirmDialog({
    icon: 'trash', danger: true, title: t('clearRangeTitle'), body: t('clearRangeBody'), ok: t('clear'), extra: seg,
    run: async () => {
      const range = ranges.find((r) => r[0] === pick)[2]();
      const res = await send({ type: 'clearRange', ...range });
      toast(t('deletedCount', [num(res?.count || 0)]));
    }
  });
  requestAnimationFrame(place);
}

/** 展开后让窗口里的标签完整进入视野 */
function revealChildren(key) {
  const kids = state.expanded.get(key) || [];
  const last = kids.length ? list.indexOfKey(kids[kids.length - 1].id) : -1;
  const head = list.indexOfKey(key);
  if (last < 0) return;
  const needed = list.tops[last + 1] - scroller.clientHeight + list.bottomInset;   // 最后一个子项露出所需的位置
  const target = Math.min(list.tops[head] - 8, needed);                              // 但不把窗口行本身推出视野
  if (target > scroller.scrollTop) scroller.scrollTo({ top: target, behavior: 'smooth' });
}

/* ---------- 事件 ---------- */
const listEl = $('#list');
listEl.addEventListener('click', (e) => {
  const head = e.target.closest('[data-head]');
  if (head) {
    const gkey = head.closest('.vitem')._item.gkey;
    const recs = groupRecs(gkey);
    if (head.dataset.head === 'restore') return restoreKeys(recs.map((r) => r.id));
    const all = recs.every((r) => state.selected.has(r.id));
    recs.forEach((r) => (all ? state.selected.delete(r.id) : state.selected.add(r.id)));
    list.render(true); updateChrome();
    return;
  }
  const row = e.target.closest('.row');
  if (!row || row._leaving) return;
  const key = row.dataset.key;
  if (e.target.closest('.check')) return toggleSelect(key, e.shiftKey);
  if (e.target.closest('.expand')) return toggleWindow(key);
  const act = e.target.closest('.act')?.dataset.act;
  if (act === 'remove') return removeKeys(state.selected.has(key) ? [...state.selected] : [key]);
  if (act === 'bg') return restore(key, false);
  if (e.metaKey || e.ctrlKey) return toggleSelect(key);
  if (e.shiftKey) return toggleSelect(key, true);
  if (state.selected.size) return toggleSelect(key);
  restore(key, true);
});
listEl.addEventListener('auxclick', (e) => {
  const row = e.target.closest('.row');
  if (e.button === 1 && row) { e.preventDefault(); restore(row.dataset.key, false); }
});
listEl.addEventListener('pointermove', (e) => {
  const row = e.target.closest('.row');
  if (row && !row.classList.contains('active') && !row._leaving) list.setActive(row.dataset.key);
});
listEl.addEventListener('pointerleave', () => list.setActive(null));
listEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  const key = row.dataset.key;
  const item = itemOf(key);
  if (!item) return;
  const multi = state.selected.has(key) && state.selected.size > 1;
  const menu = multi ? [
    { icon: 'restore', label: t('restoreSelected', [num(state.selected.size)]), run: () => restoreKeys([...state.selected]) },
    { icon: 'trash', label: t('deleteSelected', [num(state.selected.size)]), run: () => removeKeys([...state.selected]) }
  ] : [
    { icon: 'restore', label: item.type === 'w' ? t('restoreWindow') : t('restore'), run: () => restore(key, true) },
    { icon: 'background', label: t('openInBackground'), run: () => restore(key, false) },
    ...(item.type !== 'c' ? [{ icon: 'checkbox', label: state.selected.has(key) ? t('deselect') : t('select'), hint: '⌘', run: () => toggleSelect(key) }] : []),
    { icon: 'close', label: t('remove'), run: () => removeKeys([key]) }
  ];
  if (!multi && item.type !== 'w' && item.rec.host && /^https?:/.test(item.rec.url)) {
    menu.push('-', { icon: 'eyeOff', label: t('excludeSite', [item.rec.host]), danger: true, run: async () => {
      const res = await send({ type: 'excludeHost', host: item.rec.host });
      if (res?.ok) toast(t('excludedToast', [item.rec.host, num(res.count || 0)]));
    } });
  }
  contextMenu(menu, e.clientX, e.clientY);
});

tooltip(scroller, (el) => tipInfo(el._item, ctx));

$('#sel-restore').addEventListener('click', () => restoreKeys([...state.selected]));
$('#sel-delete').addEventListener('click', () => removeKeys([...state.selected]));
$('#sel-cancel').addEventListener('click', clearSelection);
$('#btn-clear').addEventListener('click', clearRangeDialog);
$('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.menu') || !$('#dialog').hidden) return;
  const inSearch = document.activeElement === searchEl;
  const keys = selectable();
  const i = keys.indexOf(list.activeKey);
  const key = list.activeKey;
  const move = (to) => { e.preventDefault(); const k = keys[Math.max(0, Math.min(to, keys.length - 1))]; if (k) list.setActive(k, true); };
  if (e.target.matches?.('.pg-input')) return;
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return flipPage(e.key === 'ArrowLeft' ? -1 : 1); }
  if (!inSearch && (e.key === '[' || e.key === ']')) { e.preventDefault(); return flipPage(e.key === '[' ? -1 : 1); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !inSearch) {
    e.preventDefault();
    items.filter((x) => x.type === 'r' || x.type === 'w').forEach((x) => state.selected.add(keyOf(x)));
    list.render(true); updateChrome();
    return;
  }
  switch (e.key) {
    case 'ArrowDown': return move(i + 1);
    case 'ArrowUp': return move(i < 0 ? 0 : i - 1);
    case 'PageDown': if (i >= keys.length - 1 && !inSearch) return flipPage(1); return move(i + 10);
    case 'PageUp': if (i <= 0 && !inSearch && curPage() > 1) return flipPage(-1); return move(i - 10);
    case 'ArrowRight': if (!inSearch && itemOf(key)?.type === 'w') { e.preventDefault(); toggleWindow(key, true); } return;
    case 'ArrowLeft': if (!inSearch && itemOf(key)?.type === 'w') { e.preventDefault(); toggleWindow(key, false); } return;
    case ' ': if (!inSearch && key) { e.preventDefault(); toggleSelect(key); } return;
    case 'Enter':
      if (state.selected.size && !inSearch) { e.preventDefault(); return restoreKeys([...state.selected]); }
      if (key) { e.preventDefault(); restore(key, !(e.shiftKey || e.metaKey || e.ctrlKey)); }
      return;
    case 'Delete': case 'Backspace':
      if (inSearch && searchEl.value) return;
      if (state.selected.size) { e.preventDefault(); return removeKeys([...state.selected]); }
      if (key) { e.preventDefault(); removeKeys([key]); }
      return;
    case 'Escape':
      if (state.selected.size) { e.preventDefault(); return clearSelection(); }
      if (searchEl.value) { e.preventDefault(); searchEl.value = ''; searchEl.dispatchEvent(new Event('input')); }
      return;
    case '/': if (!inSearch) { e.preventDefault(); searchEl.focus(); } return;
    default:
      if (!inSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) searchEl.focus();
  }
});

/* ---------- 后台变更 ---------- */
const bc = new BroadcastChannel('tabagain');
let resetTimer = 0;
bc.onmessage = ({ data }) => {
  if (data.total != null) state.total = data.total;
  if (data.t === 'add') {
    dropLocal(data.del || []);
    const ids = new Set(state.all.map((r) => r.id));
    const fresh = data.recs.filter((r) => !ids.has(r.id));
    if (fresh.length) state.all = fresh.concat(state.all).sort((a, b) => b.closedAt - a.closedAt);
    refreshSids().then(() => (state.results ? updateChrome() : rebuild({ flip: state.page === 1 && scroller.scrollTop < 200 })));
    loadChipsSoon();
  } else if (data.t === 'del') {
    dropLocal(data.ids, data.updated);
    rebuild({ flip: true });
    loadChipsSoon();
  } else if (data.t === 'sid') {
    for (const r of state.all) if (r.id === data.id) r.sid = data.sid;
    refreshSids().then(() => list.render(true));
  } else if (data.t === 'reset') {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(async () => { state.expanded.clear(); await loadAll(); loadChips(); if (state.results) runSearch(); }, 50);
  }
};
let chipsTimer = 0;
function loadChipsSoon() { clearTimeout(chipsTimer); chipsTimer = setTimeout(loadChips, 600); }

async function refreshSids() {
  try {
    const l = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS });
    state.fullSids = new Set(l.map((s) => s.tab?.sessionId || s.window?.sessionId).filter(Boolean));
  } catch { state.fullSids = new Set(); }
}

setInterval(() => { if (!document.hidden) list.render(true); }, 60e3);

/* ---------- 启动 ---------- */
/* ---------- 设置 ---------- */
function applySettings(s) {
  document.body.classList.toggle('no-chips', !s.showChips);
  if (s.pageSize === PAGE) return false;
  const first = pageStart();   // 换每页条数：停在包含当前第一条的那一页
  PAGE = s.pageSize;
  const p = Math.floor(first / PAGE) + 1;
  if (state.results) state.rpage = p; else state.page = p;
  return true;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const s = normalize(changes.settings.newValue);
  const chipsBefore = !document.body.classList.contains('no-chips');
  if (applySettings(s)) { scroller.scrollTop = 0; rebuild(); }
  if (chipsBefore !== s.showChips) loadChips();
});
applySettings(await getSettings());
state.page = Math.max(1, parseInt(new URLSearchParams(location.hash.slice(1)).get('p'), 10) || 1);

const hashQ = new URLSearchParams(location.hash.slice(1)).get('q');
if (hashQ) { searchEl.value = hashQ; state.query = hashQ; searchWrap.classList.add('has-value'); $('#search-clear').hidden = false; }
await refreshSids();
loadChips();
if (hashQ) runSearch();
await loadAll();
