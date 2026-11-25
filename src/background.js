/* =============================================================================
   TabAgain · 后台 Service Worker
   -----------------------------------------------------------------------------
   · 存储：IndexedDB，每条记录一行；关一个标签只写一行，十万条也不整体重写
   · 热数据：最新 50 条常驻内存，快捷键恢复直接走缓存，耗时与历史总量无关
   · 写入合并：同一帧内的关闭合并为一个事务（一次关 20 个标签 → 1 次写入）
   · 设置缓存：内存一份，storage.onChanged 时失效
   · 事件过滤：tabs.onUpdated 只关心 url / title / pinned / groupId
   · 整窗关闭：合成一条窗口记录，可整窗还原，也可展开单独恢复
   · 会话 ID：sessions.onChanged 时把 Chrome 的 sessionId 写进对应记录，
     恢复时一一对应；Chrome 只保留最近 25 条，更早的按快照重建
   · 清理：超出上限或过期的记录由 chrome.alarms 每天批量删除
   ============================================================================= */

import { normalize, getSettings, isExcluded } from './shared/settings.js';
import { hostOf, clipTitle, searchField } from './shared/text.js';
import * as db from './shared/db.js';

const SNAPSHOT = 'snapshot';
const ACCENT = '#0A84FF';
const HOT_SIZE = 50;
const DAY = 864e5;
const bc = new BroadcastChannel('tabagain');

/* ---------- 串行队列 ---------- */
let chain = Promise.resolve();
function serial(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

/* ---------- 设置缓存 ---------- */
let settings = null;
async function S() { return settings || (settings = await getSettings()); }

/* ---------- 标签快照 ---------- */
const snapshot = new Map();
let persistTimer = null;
function persistSnapshot() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session.set({ [SNAPSHOT]: Object.fromEntries(snapshot) }).catch(() => {});
  }, 150);
}

const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');
const pickFav = (u) => (typeof u === 'string' && /^https?:/i.test(u) && u.length <= 512 ? u : undefined);

function capture(tab) {
  if (!tab || tab.id == null || tab.id === chrome.tabs.TAB_ID_NONE || tab.incognito) return;
  const prev = snapshot.get(tab.id) || {};
  const url = tab.url || tab.pendingUrl || prev.url || '';
  snapshot.set(tab.id, {
    url,
    title: tab.title && tab.title !== url ? tab.title : (prev.url === url && prev.title) || tab.title || '',
    windowId: tab.windowId,
    index: tab.index,
    pinned: !!tab.pinned,
    groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
    // Firefox 没有 _favicon 接口：记下网页自己的图标地址（只收 http/https，且不收超长地址）
    fav: IS_FIREFOX ? pickFav(tab.favIconUrl) || (prev.url === url ? prev.fav : undefined) : undefined
  });
  persistSnapshot();
}

async function refreshWindow(windowId) {
  try { (await chrome.tabs.query({ windowId })).forEach(capture); } catch {}
}

/* ---------- 热数据 ---------- */
let hot = [];          // 最新的顶层记录（按关闭时间倒序）
let total = 0;         // 顶层记录总数
const pending = new Map();   // 尚未落盘的记录
const knownSids = new Set();

const ready = (async () => {
  try {
    const data = await chrome.storage.session.get(SNAPSHOT);
    for (const [id, value] of Object.entries(data[SNAPSHOT] || {})) snapshot.set(Number(id), value);
  } catch {}
  try { (await chrome.tabs.query({})).forEach(capture); } catch {}
  await reloadHot();
})();

async function reloadHot() {
  try {
    hot = await db.pageTop(HOT_SIZE);
    total = await db.countTop();
    for (const r of hot) if (r.sid) knownSids.add(r.sid);
  } catch { hot = []; total = 0; }
  await updateBadge();
}

/* ---------- 记录构造 ---------- */
function isRestorable(url) {
  if (!url) return false;
  if (/^(about:blank|about:newtab|chrome:\/\/newtab|chrome:\/\/new-tab-page|edge:\/\/newtab|chrome-search:)/i.test(url)) return false;
  if (url.startsWith(chrome.runtime.getURL(''))) return false;
  return /^(https?|file|ftp|chrome|chrome-extension|edge|view-source):/i.test(url);
}

function makeTab(snap, closedAt, extra = {}) {
  const host = hostOf(snap.url);
  const title = clipTitle(snap.title || snap.url);
  return {
    id: crypto.randomUUID(), kind: 'tab', lvl: 0,
    url: snap.url, title, host, closedAt,
    windowId: snap.windowId, index: snap.index, pinned: snap.pinned, groupId: snap.groupId,
    ...(snap.fav ? { fav: snap.fav } : {}),
    s: searchField(title, host),
    ...extra
  };
}

/* ---------- 写入合并 ---------- */
let flushTimer = null;
const awaiting = [];   // 等待匹配 sessionId 的新记录

const memDeduped = new Set();   // push 时已在内存里合并掉的旧记录，落盘时不再重复扣减

function push(records) {
  // records[0] 为顶层记录，其余为窗口内标签
  const top = records[0];
  if (settings?.dedupe && top.kind === 'tab') {
    hot = hot.filter((r) => {
      if (r.kind !== 'tab' || r.url !== top.url) return true;
      if (pending.has(r.id)) pending.delete(r.id); else memDeduped.add(r.id);
      total--;
      return false;
    });
  }
  hot.unshift(top);
  if (hot.length > HOT_SIZE) hot.length = HOT_SIZE;
  total++;
  for (const r of records) pending.set(r.id, r);
  awaiting.push(top);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 16);
  scheduleBadge();
}

/** 把内存中的新记录一次性写入（调用方需在串行队列内） */
async function writePending() {
  clearTimeout(flushTimer);
  if (!pending.size) return;
  const batch = [...pending.values()];
  pending.clear();
  const s = await S();
  let replaced = [];
  try { replaced = await db.writeBatch(batch, { dedupe: s.dedupe }); } catch (e) { console.warn(e); }
  const extra = replaced.filter((id) => !memDeduped.delete(id)).length;
  total = Math.max(hot.length, total - extra);
  bc.postMessage({ t: 'add', recs: batch.filter((r) => r.lvl === 0), del: replaced, total });
  scheduleBadge();
}

function flush() { return serial(writePending); }

/* ---------- 整窗关闭 ---------- */
const closingWindows = new Map();   // windowId → { tabs, timer }

function bufferWindowTab(windowId, snap) {
  let w = closingWindows.get(windowId);
  if (!w) closingWindows.set(windowId, (w = { tabs: [], timer: 0 }));
  w.tabs.push(snap);
  clearTimeout(w.timer);
  // windows.onRemoved 通常紧随其后；兜底 1.5 秒
  w.timer = setTimeout(() => flushWindow(windowId), 1500);
}

function flushWindow(windowId) {
  const w = closingWindows.get(windowId);
  if (!w) return;
  closingWindows.delete(windowId);
  clearTimeout(w.timer);
  const tabs = w.tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const closedAt = Date.now();
  if (tabs.length === 1) return push([makeTab(tabs[0], closedAt, { windowClosing: true })]);
  const winId = crypto.randomUUID();
  const kids = tabs.map((snap, i) => makeTab(snap, closedAt, { lvl: 1, win: winId, index: i }));
  const hosts = [...new Set(kids.map((k) => k.host).filter(Boolean))];
  push([{
    id: winId, kind: 'window', lvl: 0, closedAt, windowId,
    title: kids[0].title, count: kids.length, hosts: hosts.slice(0, 4), hostCount: hosts.length,
    icons: kids.filter((k, i, a) => a.findIndex((x) => x.host === k.host) === i).slice(0, 4).map((k) => k.url)
  }, ...kids]);
}

/* ---------- 会话 ID 精确匹配 ---------- */
let sessionTimer = null;
function onSessionsChanged() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(matchSessions, 60);
}

async function matchSessions() {
  const now = Date.now();
  while (awaiting.length && now - awaiting[0].closedAt > 30e3) awaiting.shift();
  if (!awaiting.length) return;
  let list = [];
  try { list = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS }); } catch { return; }
  for (const s of list) {
    const sid = s.tab?.sessionId || s.window?.sessionId;
    if (!sid || knownSids.has(sid)) continue;
    const at = (s.lastModified || 0) * 1000;
    let best = -1, bestDiff = Infinity;
    awaiting.forEach((rec, i) => {
      if (rec.sid) return;
      const ok = s.tab ? rec.kind === 'tab' && rec.url === s.tab.url
        : rec.kind === 'window' && s.window.tabs?.length === rec.count;
      const diff = Math.abs(at - rec.closedAt);
      if (ok && diff < 15e3 && diff < bestDiff) { best = i; bestDiff = diff; }
    });
    if (best < 0) continue;
    const rec = awaiting.splice(best, 1)[0];
    rec.sid = sid;
    knownSids.add(sid);
    if (!pending.has(rec.id)) serial(() => db.putRecord(rec).catch(() => {}));
    bc.postMessage({ t: 'sid', id: rec.id, sid });
  }
}

/* ---------- 删除 ---------- */
async function removeIds(ids) {
  // 仍在内存里的记录直接丢弃
  const memRemoved = [];
  for (const id of ids) {
    const rec = pending.get(id);
    if (!rec) continue;
    if (rec.kind === 'window') for (const [k, r] of pending) if (r.win === id) { pending.delete(k); memRemoved.push(r); }
    pending.delete(id);
    memRemoved.push(rec);
  }
  await writePending();       // 窗口内单个标签可能还在内存里，先落盘再统一处理
  const rest = ids.filter((id) => !memRemoved.some((r) => r.id === id));
  const removed = memRemoved.concat(rest.length ? await db.deleteRecords(rest) : []);

  const gone = new Set(removed.map((r) => r.id));
  const topGone = removed.filter((r) => r.lvl === 0);
  hot = hot.filter((r) => !gone.has(r.id));
  total = Math.max(0, total - topGone.length);

  // 窗口内的标签被单独移除：刷新窗口记录（计数 / 部分恢复标记）
  const touched = [...new Set(removed.filter((r) => r.lvl === 1 && !gone.has(r.win)).map((r) => r.win))];
  let updated = [];
  if (touched.length) {
    updated = await db.getMany(touched);
    hot = hot.map((r) => updated.find((u) => u.id === r.id) || r);
  }
  if (hot.length < 10 && total > hot.length) await reloadHot();
  bc.postMessage({ t: 'del', ids: [...gone], updated, total });
  scheduleBadge();
  return removed;
}

/* ---------- 恢复 ---------- */
async function targetWindow(preferredId) {
  if (preferredId != null) {
    try {
      const w = await chrome.windows.get(preferredId);
      if (w && w.type === 'normal' && !w.incognito) return w.id;
    } catch {}
  }
  try {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (w && !w.incognito) return w.id;
  } catch {}
  return null;
}

async function trySession(sid) {
  if (!sid) return false;
  try { await chrome.sessions.restore(sid); return true; } catch { return false; }
}

async function openTab(rec, active) {
  const s = await S();
  if (active && s.preferSession && rec.lvl === 0 && (await trySession(rec.sid))) return;

  const windowId = await targetWindow(rec.windowId);
  if (windowId == null) { await chrome.windows.create({ url: rec.url, focused: true }); return; }
  const props = { url: rec.url, active, windowId, pinned: !!rec.pinned };
  if (s.position === 'original' && rec.lvl === 0 && windowId === rec.windowId && Number.isInteger(rec.index)) props.index = rec.index;
  const tab = await chrome.tabs.create(props);
  if (rec.groupId > -1 && windowId === rec.windowId) {
    try { await chrome.tabs.group({ groupId: rec.groupId, tabIds: [tab.id] }); } catch {}
  }
  if (active) { try { await chrome.windows.update(windowId, { focused: true }); } catch {} }
}

async function openWindow(rec, active) {
  const s = await S();
  // 部分标签已被单独恢复时，整窗会话会把它们再打开一次，改为按剩余标签重建
  if (s.preferSession && !rec.partial && (await trySession(rec.sid))) return;
  const kids = await db.children(rec.id);
  if (!kids.length) throw new Error('empty window');
  const win = await chrome.windows.create({ url: kids.map((k) => k.url), focused: active });
  await Promise.all((win.tabs || []).map((tab, i) => (kids[i]?.pinned ? chrome.tabs.update(tab.id, { pinned: true }).catch(() => {}) : null)));
}

async function findRecord(id) {
  return hot.find((r) => r.id === id) || pending.get(id) || (await db.getMany([id]))[0];
}

function restoreEntry(id, active = true) {
  return serial(async () => {
    const rec = await findRecord(id);
    if (!rec) return { ok: false, reason: 'missing' };
    // 先从热数据出队：连续按快捷键时下一次拿到的是下一条
    const at = hot.findIndex((r) => r.id === id);
    if (at > -1) hot.splice(at, 1);
    try {
      if (rec.kind === 'window') await openWindow(rec, active);
      else await openTab(rec, active);
    } catch (error) {
      if (at > -1) hot.splice(at, 0, rec);   // 失败放回
      return { ok: false, reason: String(error?.message || error) };
    }
    await removeIds([id]);
    return { ok: true };
  });
}

async function restoreLatest() {
  await ready;
  if (hot.length) return restoreEntry(hot[0].id, true);
  try { await chrome.sessions.restore(); return { ok: true }; }   // 自身记录为空：交给浏览器原生恢复
  catch { flashEmpty(); return { ok: false, reason: 'empty' }; }
}

/** 批量恢复：超过 10 个时放进新窗口 */
function restoreMany(ids) {
  return serial(async () => {
    const recs = (await db.getMany(ids)).concat(ids.map((id) => pending.get(id)).filter(Boolean));
    const urls = [];
    for (const rec of recs.sort((a, b) => b.closedAt - a.closedAt)) {
      if (rec.kind === 'window') (await db.children(rec.id)).forEach((k) => urls.push(k.url));
      else urls.push(rec.url);
    }
    if (!urls.length) return { ok: false };
    if (urls.length > 10) {
      await chrome.windows.create({ url: urls, focused: true });
    } else {
      const windowId = await targetWindow(null);
      for (const url of urls) await chrome.tabs.create(windowId == null ? { url, active: false } : { url, active: false, windowId });
    }
    await removeIds(ids);
    return { ok: true, count: urls.length };
  });
}

/* ---------- 角标 ---------- */
let badgeTimer = null;
function scheduleBadge() { clearTimeout(badgeTimer); badgeTimer = setTimeout(updateBadge, 80); }

async function updateBadge() {
  try {
    const s = await S();
    if (!s.badge) return chrome.action.setBadgeText({ text: '' });
    await chrome.action.setBadgeBackgroundColor({ color: ACCENT });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.action.setBadgeText({ text: total ? (total > 99 ? '99+' : String(total)) : '' });
  } catch {}
}

async function flashEmpty() {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#8E8E93' });
    await chrome.action.setBadgeText({ text: '0' });
    setTimeout(updateBadge, 1200);
  } catch {}
}

/* ---------- 清理（每天一次，或设置收紧时） ---------- */
function cleanup() {
  return serial(async () => {
    await flushPendingNow();
    const s = await S();
    let removed = 0;
    if (s.retention > 0) removed += await db.deleteWhere({ until: Date.now() - s.retention * DAY });
    removed += await db.trimTo(s.limit);
    if (removed) { await reloadHot(); bc.postMessage({ t: 'reset', total }); }
  });
}

const flushPendingNow = writePending;

function ensureAlarm() {
  chrome.alarms.get('cleanup').then((a) => {
    if (!a) chrome.alarms.create('cleanup', { periodInMinutes: 24 * 60, delayInMinutes: 5 });
  }).catch(() => {});
}

/* ---------- 事件 ---------- */
const WATCH = IS_FIREFOX ? ['url', 'title', 'pinned', 'groupId', 'favIconUrl'] : ['url', 'title', 'pinned', 'groupId'];

chrome.tabs.onCreated.addListener(async (tab) => { await ready; capture(tab); });
chrome.tabs.onUpdated.addListener(async (_id, info, tab) => {
  if (!WATCH.some((k) => k in info)) return;   // 声音、加载状态、休眠等变化直接忽略
  await ready;
  capture(tab);
});
chrome.tabs.onMoved.addListener(async (_id, info) => { await ready; refreshWindow(info.windowId); });
chrome.tabs.onAttached.addListener(async (_id, info) => { await ready; refreshWindow(info.newWindowId); });
chrome.tabs.onDetached.addListener(async (_id, info) => { await ready; refreshWindow(info.oldWindowId); });
chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  await ready;
  snapshot.delete(removedId);
  try { capture(await chrome.tabs.get(addedId)); } catch {}
});

chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  await ready;
  const snap = snapshot.get(tabId);
  snapshot.delete(tabId);
  persistSnapshot();
  if (!snap || !isRestorable(snap.url)) return;
  const s = await S();
  if (isExcluded(hostOf(snap.url), s.exclude)) return;
  if (info.isWindowClosing) return bufferWindowTab(info.windowId, { ...snap, windowId: info.windowId });
  push([makeTab({ ...snap, windowId: info.windowId }, Date.now())]);
  refreshWindow(info.windowId);   // 关闭后同窗口标签的位置会变化
});

chrome.windows.onRemoved.addListener((windowId) => flushWindow(windowId));
chrome.sessions.onChanged.addListener(onSessionsChanged);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'restore-last') restoreLatest();
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'cleanup') cleanup(); });


/* =============================================================================
   鼠标手势（默认关闭）
   · 安装时不申请网站权限；用户在设置里开启时才请求，关闭时交还
   · 授权后动态注册内容脚本，并注入已打开的网页
   · 预览：手势画出时就告诉网页「将重新打开哪一页」，图标在后台取好再传过去
   ============================================================================= */
const GESTURE_ORIGINS = ['<all_urls>'];
const GESTURE_ID = 'tabagain-gesture';
const GESTURE_FILES = ['gesture/core.js', 'gesture/gesture.js'];

async function injectGestureTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] }).catch(() => []);
  await Promise.all(tabs.filter((tab) => !tab.discarded).map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: GESTURE_FILES }).catch(() => {})));
}

let gestureSync = Promise.resolve();
function syncGesture({ inject = false } = {}) {
  gestureSync = gestureSync.then(async () => {
    if (!chrome.scripting?.registerContentScripts) return;
    const s = await S();
    const granted = await chrome.permissions.contains({ origins: GESTURE_ORIGINS }).catch(() => false);
    const want = s.gestures && granted;
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [GESTURE_ID] }).catch(() => []);
    if (want && !reg.length) {
      await chrome.scripting.registerContentScripts([{
        id: GESTURE_ID, js: GESTURE_FILES, matches: ['<all_urls>'],
        runAt: 'document_start', allFrames: false, persistAcrossSessions: true
      }]).catch((e) => console.warn('gesture register', e));
      inject = true;
    } else if (!want && reg.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [GESTURE_ID] }).catch(() => {});
    }
    if (want && inject) await injectGestureTabs();
    // 权限在浏览器里被收回：同步关掉开关
    if (s.gestures && !granted) await chrome.storage.local.set({ settings: { ...s, gestures: false } });
  }).catch((e) => console.warn('gesture sync', e));
  return gestureSync;
}
chrome.permissions.onAdded?.addListener(() => syncGesture());
chrome.permissions.onRemoved?.addListener(() => syncGesture());

/* 网站图标 → base64（Chrome 走 _favicon，Firefox 用记录下的 favIconUrl）；没有图标时返回 null，由网页画首字母色块 */
const iconCache = new Map();
let defaultIconHash = null;
function hashBytes(buf) {
  const d = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0) + ':' + d.length;
}
function toB64(buf) {
  const d = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < d.length; i += 0x8000) out += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return btoa(out);
}
async function fetchIcon(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const type = res.headers.get('content-type') || 'image/png';
  return { buf: await res.arrayBuffer(), type };
}
function chromeFavicon(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}
async function iconOf(rec) {
  if (rec.kind === 'window') return null;
  const key = IS_FIREFOX ? rec.fav : rec.host;
  if (!key) return null;
  if (iconCache.has(key)) return iconCache.get(key);
  let out = null;
  try {
    if (IS_FIREFOX) {
      const { buf, type } = await fetchIcon(rec.fav);
      if (buf.byteLength && buf.byteLength < 200000 && !type.includes('svg')) out = { b64: toB64(buf), mime: type };
    } else {
      defaultIconHash ||= fetchIcon(chromeFavicon('https://tabagain-no-icon.invalid/')).then((r) => hashBytes(r.buf)).catch(() => '');
      const [{ buf, type }, def] = await Promise.all([fetchIcon(chromeFavicon(rec.url)), defaultIconHash]);
      if (hashBytes(buf) !== def) out = { b64: toB64(buf), mime: type };
    }
  } catch {}
  if (iconCache.size > 80) iconCache.delete(iconCache.keys().next().value);
  iconCache.set(key, out);
  return out;
}

async function gesturePeek() {
  await ready;
  const list = hot.slice(0, 2);
  const items = await Promise.all(list.map(async (r) => ({
    kind: r.kind, title: r.title, host: r.host || (r.hosts && r.hosts[0]) || '', count: r.count || 1, icon: await iconOf(r)
  })));
  return { ok: true, items };
}

/* 连画：上一次手势完成后 1 秒内开始的下一笔，计数累加（与连按 Alt+Z 一致：每一笔都立即恢复一页） */
let combo = { at: 0, n: 0 };
async function gestureRestore(count, startedAt) {
  const n = Math.max(1, Math.min(5, Number(count) || 1));
  let restored = 0;
  for (let i = 0; i < n; i++) {
    const r = await restoreLatest();
    if (!r?.ok) break;
    restored++;
  }
  const now = Date.now();
  const start = Number(startedAt) || now;
  combo = restored ? { at: now, n: start - combo.at <= 1000 ? combo.n + restored : restored } : combo;
  return { ok: restored > 0, restored, combo: restored ? combo.n : 0 };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    await ready;
    switch (msg && msg.type) {
      case 'restore': return restoreEntry(msg.id, msg.active !== false);
      case 'restoreLatest': return restoreLatest();
      case 'restoreMany': return restoreMany(msg.ids || []);
      case 'remove': return serial(async () => ({ ok: true, removed: await removeIds(msg.ids || []) }));
      case 'reinsert':
        return serial(async () => {
          await flushPendingNow();
          await db.writeBatch(msg.records || []);
          await reloadHot();
          bc.postMessage({ t: 'add', recs: (msg.records || []).filter((r) => r.lvl === 0), del: [], total });
          return { ok: true };
        });
      case 'clearRange':   // { since?, until?, host?, site? }
        return serial(async () => {
          await flushPendingNow();
          const n = msg.all ? (await db.clearAll(), total) : await db.deleteWhere(msg);
          await reloadHot();
          bc.postMessage({ t: 'reset', total });
          return { ok: true, count: n };
        });
      case 'excludeHost':
        return serial(async () => {
          const s = await S();
          const host = String(msg.host || '').replace(/^www\./, '');
          if (host && !s.exclude.includes(host)) {
            await chrome.storage.local.set({ settings: { ...s, exclude: [...s.exclude, host] } });
            settings = null;
          }
          await flushPendingNow();
          const n = await db.deleteWhere({ site: host });
          await reloadHot();
          bc.postMessage({ t: 'reset', total });
          return { ok: true, count: n };
        });
      case 'stats': return { ok: true, total };
      case 'gesturePeek': return gesturePeek();
      case 'gestureRestore': return gestureRestore(msg.count, msg.startedAt);
      case 'gestureSync': return syncGesture().then(() => ({ ok: true }));
      default: return { ok: false };
    }
  })().then(reply, (error) => reply({ ok: false, reason: String(error) }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const prev = normalize(changes.settings.oldValue);
  settings = normalize(changes.settings.newValue);
  if (settings.limit < prev.limit || settings.retention !== prev.retention) cleanup();
  if (settings.gestures !== prev.gestures) syncGesture();
  updateBadge();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings: raw } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: normalize(raw) });
  settings = null;
  await reloadHot();
  ensureAlarm();
  syncGesture({ inject: reason === 'update' });   // 更新后旧网页里的手势脚本已失效，重新注入
  if (reason === 'install') chrome.runtime.openOptionsPage().catch(() => {});   // 设置页会自动弹出引导
});

chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  syncGesture();
  const s = await S();
  if (!s.keepOnRestart) await serial(async () => { await db.clearAll(); await reloadHot(); });
});
