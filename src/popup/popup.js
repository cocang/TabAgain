/* =============================================================================
   TabAgain · 弹出页
   · 最近记录：按页读取（每页条数在设置中选择），列表末尾是分页器，[ 与 ] 翻页
   · 搜索：独立线程，防抖 80ms，新输入中止旧搜索，边找边出结果
   · 虚拟列表 + FLIP：只渲染可见行，移除 / 恢复时可见区平滑合拢
   ============================================================================= */
import { $, t, tn, num, send, VirtualList, tooltip, contextMenu, createToast, flyToCorner, collapseRow, shortcutKeys, kbd, reduceMotion, setFavicon, createPager, slideIn, createDatePicker, openShortcutSettings } from '../shared/ui.js';
import { getSettings, normalize } from '../shared/settings.js';
import { keyOf, buildItems, createItem, renderItem, tipInfo } from '../shared/rows.js';
import { parseQuery } from '../shared/text.js';
import { createSiteRail } from '../shared/site-rail.js';
import { pageAt, countTop, children, topHosts, topBounds, daysWithRecords, countNewer } from '../shared/db.js';

let PAGE = 50;
const searchEl = $('#search');
const searchWrap = $('#search-wrap');
const scroller = $('#scroller');
const toast = createToast($('#toast'));

const state = {
  recent: [],            // 当前页的记录（顶层，倒序）
  latest: null,          // 最近关闭的一条（「恢复上次」与快捷键提示）
  page: 1,               // 浏览页码
  rpage: 1,              // 搜索结果页码
  loading: false,
  results: null,         // 搜索结果；null 表示不在搜索
  searching: false,
  query: '',
  host: '',              // 站点筛选
  expanded: new Map(),   // 已展开的窗口 → 子标签
  total: 0,
  fullSids: new Set(),
  shortcut: [],
  firstPaint: true
};
let items = [];

const ctx = {
  get now() { return Date.now(); },
  get terms() { return state.results ? parseQuery(state.query).terms : []; },
  get fullSids() { return state.fullSids; },
  get latestId() { return !state.results && state.page === 1 && state.latest?.id; },
  get shortcut() { return state.shortcut; },
  showWindowTag: true
};

/* ---------- 虚拟列表 ---------- */
const list = new VirtualList({
  scroller,
  content: $('#list'),
  sticky: $('#sticky'),
  heights: { h: 30, r: 50, w: 50, c: 42 },
  bottomInset: 64,
  keyOf,
  create: (type) => createItem(type),
  render: (el, item, i) => {
    renderItem(el, item, ctx);
    if (state.firstPaint && i < 14 && !reduceMotion.matches) {
      el.classList.add('enter');
      el.style.setProperty('--n', i);
      el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
    }
  },
  renderSticky: (el, item) => { el.querySelector('.label').textContent = item.label; }
});

/* ---------- 分页 ---------- */
const pager = createPager($('#pager'), {
  compact: true,
  onChange: (p, dir) => {
    if (state.results) { state.rpage = p; showPage(dir); }
    else loadPage(p, dir);
  }
});
function pageCount() {
  return Math.max(1, Math.ceil((state.results ? state.results.length : state.total) / PAGE));
}
function syncPager() {
  const p = state.results ? state.rpage : state.page;
  pager.set(p, pageCount(), !!state.results && state.searching);
}
/** 换页后：回到顶部、内容轻推入场、当前项落在第一条 */
function showPage(dir) {
  scroller.scrollTop = 0;
  rebuild();
  slideIn($('#list'), dir);
  list.setActive(selectable()[0] ?? null);
}
function flip(dir) {
  const p = (state.results ? state.rpage : state.page) + dir;
  if (p >= 1 && p <= pageCount()) pager.go(p);
}

function rebuild({ flip = false, transition = false } = {}) {
  const recs = state.results ? state.results.slice((state.rpage - 1) * PAGE, state.rpage * PAGE) : state.recent;
  const next = buildItems(recs, { expanded: state.results ? new Map() : state.expanded });
  const apply = () => { items = next; list.setItems(items, { flip: flip && !transition }); };
  if (transition) list.transition(apply); else apply();
  state.firstPaint = false;

  // 当前项：保持原来那一项，找不到就取第一条可选项
  const keys = selectable();
  if (!keys.includes(list.activeKey)) list.setActive(keys[0] ?? null);
  updateChrome();
}

function selectable() { return items.filter((it) => it.type !== 'h').map(keyOf); }

function updateChrome() {
  const searching = !!state.results;
  const empty = !items.length && !(searching && state.searching) && !state.loading;
  $('#empty').hidden = !empty;
  if (empty) {
    $('#empty-title').textContent = searching ? t('noResultTitle') : t('emptyTitle');
    $('#empty-hint').textContent = searching ? t('noResultHint') : t('emptyHint');
    $('#empty').querySelector('.empty-art').hidden = searching;
  }
  $('#btn-last').disabled = !state.latest;
  $('#all-label').textContent = state.total ? t('viewAll', [num(state.total)]) : t('history');
  syncPager();
  const status = $('#status');
  const end = $('#list-end');
  end.hidden = !items.length;
  if (searching) {
    status.textContent = state.searching ? '' : tn('resultCount', state.results.length, [num(state.results.length)]);
  } else if (pager.pages > 1) {
    const from = (state.page - 1) * PAGE + 1;
    status.textContent = t('pageRange', [num(from), num(from + state.recent.length - 1), num(state.total)]);
  } else status.textContent = '';
  status.hidden = !status.textContent;
  fitHeight();
}

/* ---------- 高度自适应：记录不满一屏时收起窗口 ---------- */
const H_MAX = 560, H_MIN = 300, H_EMPTY = 380;
let fitFrame = 0;
function fitHeight() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const root = document.documentElement;
    const cur = root.getBoundingClientRect().height;
    let want;
    if (!items.length) want = state.loading ? cur : H_EMPTY;
    else {
      // 内容放得下时不需要底部渐隐，留白只够让出底栏
      const listH = list.tops[items.length] || 0;
      const end = $('#list-end');
      scroller.classList.add('fits');
      const fitsH = Math.ceil(scroller.offsetTop + listH + (end.hidden ? 72 : end.offsetHeight));
      if (fitsH <= H_MAX) want = fitsH;
      else { scroller.classList.remove('fits'); want = H_MAX; }
    }
    if (items.length && want < H_MAX) scroller.classList.add('fits');
    want = Math.max(H_MIN, Math.min(H_MAX, want));
    // 搜索中只增不减：边输入边跳动很难受，退出搜索再收回
    if (state.results) want = Math.max(want, cur);
    if (Math.abs(want - cur) < 2) return;
    root.style.setProperty('--popup-h', want + 'px');
    if (!state.results) localStorage.setItem('popupH', String(want));
    list.render?.(true);
  });
}

/* ---------- 数据：按页读取 ---------- */
let loadSeq = 0;
async function loadPage(p, dir = 0) {
  const seq = ++loadSeq;
  state.loading = true;
  const dim = setTimeout(() => scroller.classList.add('loading'), 150);   // 深页较慢时先把旧页压暗
  const total = await countTop();
  const pages = Math.max(1, Math.ceil(total / PAGE));
  p = Math.max(1, Math.min(pages, p));
  const recs = await pageAt((p - 1) * PAGE, PAGE, total);
  clearTimeout(dim);
  scroller.classList.remove('loading');
  if (seq !== loadSeq) return;
  state.total = total;
  state.page = p;
  state.recent = recs;
  if (p === 1) state.latest = recs[0] || null;
  state.loading = false;
  state.expanded.clear();
  if (state.results) updateChrome();
  else showPage(dir);
}

/** 删除 / 恢复后：重新读取当前页，下一页的记录补上空位；本页空了就退回上一页 */
let refillTimer = 0;
function refillSoon() {
  clearTimeout(refillTimer);
  refillTimer = setTimeout(async () => {
    const seq = ++loadSeq;
    const total = await countTop();
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(state.page, pages);
    const [recs, top] = await Promise.all([pageAt((p - 1) * PAGE, PAGE, total), p === 1 ? null : pageAt(0, 1)]);
    if (seq !== loadSeq) return;
    const moved = p !== state.page;
    state.total = total;
    state.page = p;
    state.recent = recs;
    state.latest = p === 1 ? recs[0] || null : top?.[0] || null;
    if (state.results) return updateChrome();
    if (moved) showPage(-1); else rebuild({ flip: true });
  }, 160);
}

async function reload() {
  state.expanded.clear();
  await loadPage(state.page);
  if (state.results) runSearch();
  loadChips();
}

/* ---------- 搜索（独立线程） ---------- */
const worker = new Worker(new URL('../shared/search-worker.js', import.meta.url), { type: 'module' });
let qid = 0;
let debounce = 0;

function runSearch() {
  const raw = state.query;
  if (!raw.trim() && !state.host) {
    state.results = null;
    state.searching = false;
    setSpinner(false);
    rebuild({ transition: true });
    scroller.scrollTop = 0;
    return;
  }
  const id = ++qid;
  state.rpage = 1;
  state.searching = true;
  setSpinner(true);
  worker.postMessage({ type: 'search', qid: id, raw, host: state.host, first: 50 });
}

let acc = { id: 0, recs: [] };
worker.onmessage = ({ data }) => {
  if (data.qid !== qid) return;   // 旧查询的结果直接丢弃
  const firstBatch = acc.id !== data.qid;
  if (firstBatch) acc = { id: data.qid, recs: [] };
  acc.recs.push(...data.recs);
  state.results = acc.recs;
  state.searching = !data.done;
  setSpinner(!data.done);
  if (firstBatch) {
    scroller.scrollTop = 0;
    rebuild({ transition: true });
  } else if (state.rpage === pageCount() || data.done) rebuild();   // 只有正在看的最后一页会因新结果而变化
  else updateChrome();
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
$('#search-clear').addEventListener('click', (e) => {
  e.preventDefault();
  searchEl.value = '';
  searchEl.dispatchEvent(new Event('input'));
  searchEl.focus();
});

/* ---------- 站点筛选条 ---------- */
const shortHost = (h) => h.replace(/^www\./, '').replace(/\.(com|cn|net|org|io|dev|com\.cn|co|app)$/, '');
const rail = createSiteRail($('#chips'), {
  limit: 12,
  shortName: shortHost,
  onSelect(host) { state.host = host; runSearch(); }
});
async function loadChips() {
  const nav = $('#chips');
  if (document.body.classList.contains('no-chips')) { nav.hidden = true; fitHeight(); return; }
  const n = rail.set(await topHosts(Infinity));
  nav.hidden = n < 2;
  if (state.host !== rail.selected) { state.host = rail.selected; runSearch(); }
  fitHeight();
}

/* ---------- 操作 ---------- */
const itemOf = (key) => items.find((it) => keyOf(it) === key);

function dropLocal(ids, updated = []) {
  const gone = new Set(ids);
  const keep = (r) => !gone.has(r.id);
  const patch = (r) => updated.find((u) => u.id === r.id) || r;
  state.recent = state.recent.filter(keep).map(patch);
  if (state.results) state.results = state.results.filter(keep).map(patch);
  for (const [wid, kids] of state.expanded) {
    if (gone.has(wid)) { state.expanded.delete(wid); continue; }
    const left = kids.filter(keep);
    if (left.length) state.expanded.set(wid, left); else state.expanded.delete(wid);
  }
}

/** 选择下一项：被移除项的下一条，没有就上一条 */
function nextActive(key) {
  const keys = selectable();
  const i = keys.indexOf(key);
  return keys[i + 1] ?? keys[i - 1] ?? null;
}

async function restore(key, active) {
  const item = itemOf(key);
  if (!item || item.type === 'h') return;
  if (active) {
    const res = await send({ type: 'restore', id: item.rec.id, active: true });
    if (!res?.ok) { toast(t('restoreFailed')); return reload(); }
    return window.close();
  }
  // 后台打开：光点飞向右上角，行收拢
  const el = list.elementFor(key);
  const fav = el?.querySelector('.fav');
  const next = nextActive(key);
  flyToCorner(fav);
  await collapseRow(el, 'shrink');
  const res = await send({ type: 'restore', id: item.rec.id, active: false });
  if (!res?.ok) { toast(t('restoreFailed')); return reload(); }
  dropLocal([item.rec.id]);
  state.total = Math.max(0, state.total - (item.type === 'c' ? 0 : 1));
  if (list.activeKey === key) list.activeKey = next;
  rebuild({ flip: true });
  refillSoon();
}

async function remove(key) {
  const item = itemOf(key);
  if (!item || item.type === 'h') return;
  const el = list.elementFor(key);
  const next = nextActive(key);
  await collapseRow(el, 'left');
  const res = await send({ type: 'remove', ids: [item.rec.id] });
  if (!res?.ok) return reload();
  dropLocal(res.removed.map((r) => r.id));
  if (list.activeKey === key) list.activeKey = next;
  rebuild({ flip: true });
  refillSoon();
  toast(t('removed'), () => send({ type: 'reinsert', records: res.removed }));
}

async function toggleWindow(key, open) {
  const item = itemOf(key);
  if (!item || item.type !== 'w') return;
  const isOpen = state.expanded.has(key);
  if (open === isOpen) return;
  if (isOpen) state.expanded.delete(key);
  else state.expanded.set(key, await children(key));
  rebuild({ flip: true });
  if (!isOpen) revealChildren(key);
}

async function excludeSite(rec) {
  const res = await send({ type: 'excludeHost', host: rec.host });
  if (res?.ok) toast(t('excludedToast', [rec.host, num(res.count || 0)]));
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
  const row = e.target.closest('.row');
  if (!row || row._leaving) return;
  const key = row.dataset.key;
  if (e.target.closest('.expand')) return toggleWindow(key);
  const act = e.target.closest('.act')?.dataset.act;
  if (act === 'remove') return remove(key);
  if (act === 'bg') return restore(key, false);
  restore(key, !(e.metaKey || e.ctrlKey || e.shiftKey));
});
listEl.addEventListener('auxclick', (e) => {
  const row = e.target.closest('.row');
  if (e.button === 1 && row) { e.preventDefault(); restore(row.dataset.key, false); }
});
listEl.addEventListener('pointermove', (e) => {
  const row = e.target.closest('.row');
  if (!row || row.classList.contains('active') || row._leaving) return;
  list.setActive(row.dataset.key);
});
listEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  const item = itemOf(row.dataset.key);
  if (!item) return;
  list.setActive(row.dataset.key);
  const key = row.dataset.key;
  const menu = [
    { icon: 'restore', label: item.type === 'w' ? t('restoreWindow') : t('restore'), hint: '↩', run: () => restore(key, true) },
    { icon: 'background', label: t('openInBackground'), run: () => restore(key, false) },
    { icon: 'close', label: t('remove'), hint: '⌫', run: () => remove(key) }
  ];
  if (item.type !== 'w' && item.rec.host && /^https?:/.test(item.rec.url)) {
    menu.push('-', { icon: 'eyeOff', label: t('excludeSite', [item.rec.host]), danger: true, run: () => excludeSite(item.rec) });
  }
  contextMenu(menu, e.clientX, e.clientY);
});

tooltip(scroller, (el) => tipInfo(el._item, ctx));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.menu') || picker.isOpen) return;
  const inSearch = document.activeElement === searchEl;
  const keys = selectable();
  const i = keys.indexOf(list.activeKey);
  const key = list.activeKey;
  const move = (to) => { e.preventDefault(); const k = keys[Math.max(0, Math.min(to, keys.length - 1))]; if (k) list.setActive(k, true); };
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return flip(e.key === 'ArrowLeft' ? -1 : 1); }
  if (e.target.matches?.('.pg-input')) return;
  switch (e.key) {
    case 'ArrowDown': return move(i + 1);
    case 'ArrowUp': return move(i - 1);
    case 'PageDown': return move(i + 8);
    case 'PageUp': return move(i - 8);
    case 'Home': if (!inSearch) move(0); return;
    case 'End': if (!inSearch) move(keys.length - 1); return;
    case 'ArrowRight': if (!inSearch || !searchEl.value) { if (itemOf(key)?.type === 'w') { e.preventDefault(); toggleWindow(key, true); } } return;
    case 'ArrowLeft': if (!inSearch || !searchEl.value) { if (itemOf(key)?.type === 'w') { e.preventDefault(); toggleWindow(key, false); } } return;
    case 'Enter': if (key) { e.preventDefault(); restore(key, !(e.shiftKey || e.metaKey || e.ctrlKey)); } return;
    case 'Delete': if (key) { e.preventDefault(); remove(key); } return;
    case 'Backspace': if (key && !searchEl.value) { e.preventDefault(); remove(key); } return;
    case 'Escape':
      if (searchEl.value || state.host) {
        e.preventDefault();
        if (searchEl.value) { searchEl.value = ''; searchEl.dispatchEvent(new Event('input')); }
        else { state.host = ''; rail.select(''); runSearch(); }
      }
      return;
    case '/': if (!inSearch) { e.preventDefault(); searchEl.focus(); } return;
    case '[': if (!inSearch) { e.preventDefault(); flip(-1); } return;
    case ']': if (!inSearch) { e.preventDefault(); flip(1); } return;
    default:
      if (!inSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) searchEl.focus();
  }
});

/* ---------- 按日期跳转 ---------- */
const H_PICKER = 420;   // 日历需要的最小窗口高度
const picker = createDatePicker({
  anchor: $('#btn-cal'),
  getBounds: topBounds,
  hasRecords: daysWithRecords,
  onOpen: () => {
    // 窗口太矮时先撑高，日历才放得下
    const root = document.documentElement;
    if (root.getBoundingClientRect().height < H_PICKER) {
      root.style.setProperty('--popup-h', H_PICKER + 'px');
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  },
  onClose: () => fitHeight(),
  onPick: (dayStart) => jumpToDay(dayStart)
});
$('#btn-cal').addEventListener('click', () => {
  // 打开时定位到当前页第一条所在的月份
  const near = !state.results && state.page > 1 ? state.recent[0]?.closedAt : null;
  picker.toggle({ near });
});

async function jumpToDay(dayStart) {
  const d = new Date(dayStart);
  const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  // 跳转针对全部记录：先退出搜索与站点筛选
  if (searchEl.value || state.host) {
    searchEl.value = '';
    state.query = '';
    state.host = '';
    searchWrap.classList.remove('has-value');
    $('#search-clear').hidden = true;
    rail.select('');
    ++qid;
    state.results = null;
    state.searching = false;
    setSpinner(false);
  }
  const offset = await countNewer(dayEnd - 1);
  const p = Math.floor(offset / PAGE) + 1;
  const dir = p === state.page ? 0 : p > state.page ? 1 : -1;
  await loadPage(p, dir);
  const rec = state.recent[offset - (p - 1) * PAGE];
  if (!rec) return;
  const i = list.indexOfKey(rec.id);
  if (i < 0) return;
  // 那天的分组标题贴在顶部，目标行轻闪
  const head = items[i - 1]?.type === 'h' ? i - 1 : i;
  scroller.scrollTo({ top: Math.max(0, list.tops[head]), behavior: reduceMotion.matches || dir ? 'instant' : 'smooth' });
  list.setActive(rec.id);
  setTimeout(() => {
    const el = list.elementFor(rec.id);
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
  }, 60);
}

$('#btn-settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
$('#btn-all').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('history/history.html');
  const [tab] = await chrome.tabs.query({ url: url + '*' }).catch(() => []);
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else await chrome.tabs.create({ url: url + (state.query ? '#q=' + encodeURIComponent(state.query) : '') });
  window.close();
});
$('#btn-last').addEventListener('click', async (e) => {
  if (e.target.closest('.set')) { openShortcutSettings(); return window.close(); }
  if (state.latest) {
    const res = await send({ type: 'restore', id: state.latest.id, active: true });
    if (res?.ok) window.close(); else { toast(t('restoreFailed')); refillSoon(); }
  }
});

/* ---------- 后台变更 ---------- */
const bc = new BroadcastChannel('tabagain');
bc.onmessage = ({ data }) => {
  picker.invalidate();
  if (data.total != null) state.total = data.total;
  if (data.t === 'add') {
    dropLocal(data.del || []);
    const newest = data.recs.reduce((a, r) => (!a || r.closedAt > a.closedAt ? r : a), null);
    if (newest && (!state.latest || newest.closedAt >= state.latest.closedAt)) state.latest = newest;
    if (state.page === 1) {
      // 第一页：新记录从顶部插入，超出的挤到下一页
      const ids = new Set(state.recent.map((r) => r.id));
      const fresh = data.recs.filter((r) => !ids.has(r.id));
      state.recent = fresh.concat(state.recent).sort((a, b) => b.closedAt - a.closedAt).slice(0, PAGE);
    }
    refreshSids().then(() => (state.results ? updateChrome() : rebuild({ flip: state.page === 1 })));
  } else if (data.t === 'del') {
    dropLocal(data.ids, data.updated);
    rebuild({ flip: true });
    refillSoon();
  } else if (data.t === 'sid') {
    for (const r of state.recent) if (r.id === data.id) r.sid = data.sid;
    refreshSids().then(() => list.render(true));
  } else if (data.t === 'reset') reload();
};

/** Chrome 当前仍保留的会话：这些记录可以完整还原（含前进 / 后退） */
async function refreshSids() {
  try {
    const list = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS });
    state.fullSids = new Set(list.map((s) => s.tab?.sessionId || s.window?.sessionId).filter(Boolean));
  } catch { state.fullSids = new Set(); }
}

async function loadShortcut() {
  state.shortcut = await shortcutKeys();
  const holder = $('#shortcut');
  holder.textContent = '';
  if (state.shortcut.length) holder.append(...kbd(state.shortcut).childNodes);
  else holder.append(Object.assign(document.createElement('span'), { className: 'set', textContent: t('noShortcut') }));
}

setInterval(() => { if (!document.hidden) list.render(true); }, 30e3);

/* ---------- 设置 ---------- */
function applySettings(s) {
  document.body.classList.toggle('no-chips', !s.showChips);
  if (s.pageSize !== PAGE) {
    const firstIndex = (state.page - 1) * PAGE;   // 换每页条数时，停在包含当前第一条的那一页
    PAGE = s.pageSize;
    state.page = Math.floor(firstIndex / PAGE) + 1;
    state.rpage = 1;
    return true;
  }
  return false;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const s = normalize(changes.settings.newValue);
  const chipsBefore = !document.body.classList.contains('no-chips');
  if (applySettings(s)) reload();
  else if (chipsBefore !== s.showChips) loadChips();
});

applySettings(await getSettings());
await Promise.all([loadShortcut(), refreshSids()]);
await reload();
