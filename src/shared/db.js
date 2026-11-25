/* =============================================================================
   IndexedDB 存储层
   -----------------------------------------------------------------------------
   records：每条记录一行，关一个标签只写一行
     { id, kind: 'tab' | 'window', lvl: 0 顶层 | 1 窗口内的标签, win: 所属窗口记录 id,
       url, title, host, closedAt, windowId, index, pinned, groupId, sid, count, hosts, s }
   索引：closedAt（按时间分页）· url（合并重复）· host（按站点筛选）·
        windowRecId（整窗）· top [lvl, closedAt]（只取顶层）
   hosts：{ host, count } 站点计数，随增删在同一事务内维护
   写入只在后台进行；界面与搜索线程只读。
   ============================================================================= */

export const DB_NAME = 'tabagain';
export const DB_VERSION = 2;
export const RECORDS = 'records';
export const HOSTS = 'hosts';
export const META = 'meta';   // { key: 'top', value: 顶层记录数 }，随增删在同一事务内维护，免去对十万条计数

let opening = null;
export function openDB() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORDS)) {
        const s = db.createObjectStore(RECORDS, { keyPath: 'id' });
        s.createIndex('closedAt', 'closedAt');
        s.createIndex('url', 'url');
        s.createIndex('host', 'host');
        s.createIndex('windowRecId', 'win');
        s.createIndex('top', ['lvl', 'closedAt']);
      }
      if (!db.objectStoreNames.contains(HOSTS)) db.createObjectStore(HOSTS, { keyPath: 'host' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); opening = null; };
      db.onclose = () => { opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

export const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('abort'));
});

/* ---------- 读取 ---------- */
const TOP = (before = Infinity) => IDBKeyRange.bound([0, -Infinity], [0, before], false, true);

/** 顶层记录，按关闭时间倒序分页 */
export async function pageTop(limit = 100, before = Infinity) {
  const db = await openDB();
  const index = db.transaction(RECORDS).objectStore(RECORDS).index('top');
  const out = [];
  return new Promise((resolve, reject) => {
    const cur = index.openCursor(TOP(before), 'prev');
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || out.length >= limit) return resolve(out);
      out.push(c.value);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

/**
 * 第 offset 条起的 limit 条顶层记录（按关闭时间倒序）
 * 1. 只读键的游标 advance 到页首（不取值，原生层跳过），从较近的一端走：十万条时最多跳五万个键
 * 2. 从页首读出本页：索引键相同（同一毫秒）时用 continuePrimaryKey 精确定位，不重不漏
 */
export async function pageAt(offset = 0, limit = 50, total = null) {
  const db = await openDB();
  const index = db.transaction(RECORDS).objectStore(RECORDS).index('top');
  const all = TOP(Infinity);
  offset = Math.max(0, offset);
  if (total != null && offset >= total) return [];

  let start = null;   // { key, pk }
  if (offset > 0) {
    const fromOld = total != null && total - 1 - offset < offset;
    const skip = fromOld ? total - 1 - offset : offset;
    start = await new Promise((resolve, reject) => {
      const cur = index.openKeyCursor(all, fromOld ? 'next' : 'prev');
      let moved = skip <= 0;
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(null);
        if (!moved) { moved = true; c.advance(skip); return; }
        resolve({ key: c.key, pk: c.primaryKey });
      };
      cur.onerror = () => reject(cur.error);
    });
    if (!start) return [];
  }

  return new Promise((resolve, reject) => {
    const out = [];
    const range = start ? IDBKeyRange.bound([0, -Infinity], start.key) : all;
    const cur = index.openCursor(range, 'prev');
    let positioned = !start;
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(out);
      if (!positioned) {
        positioned = true;
        if (indexedDB.cmp(c.primaryKey, start.pk) !== 0) { c.continuePrimaryKey(start.key, start.pk); return; }
      }
      out.push(c.value);
      if (out.length >= limit) return resolve(out);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

/**
 * 顶层记录分块流式读取：按时间窗 getAll（比逐条游标快一个数量级），窗口大小自适应
 * onChunk(records) 返回 false 可提前结束
 */
export async function streamTop(onChunk, firstChunk = 400, nextChunk = 3000) {
  const db = await openDB();
  const index = () => db.transaction(RECORDS).objectStore(RECORDS).index('top');
  const range = (lo, hi) => IDBKeyRange.bound([0, lo], [0, hi], false, true);
  const oldest = await new Promise((resolve) => {
    const c = index().openKeyCursor(IDBKeyRange.bound([0, -Infinity], [0, Infinity]));
    c.onsuccess = () => resolve(c.result ? c.result.key[1] : Infinity);
    c.onerror = () => resolve(Infinity);
  });
  let hi = Date.now() + 864e5;
  let target = firstChunk;
  let span = 36e5;
  while (hi > oldest) {
    const lo = Math.max(hi - span, oldest);
    const rows = await req2p(index().getAll(range(lo, hi)));
    hi = lo;
    if (rows.length) {
      rows.reverse();
      if ((await onChunk(rows)) === false) return;
      target = nextChunk;
    }
    if (rows.length < target / 2) span = Math.min(span * 2.5, 3650 * 864e5);
    else if (rows.length > target * 2) span = Math.max(span / 2, 6e4);
  }
}

/** 顶层记录数：读计数器；计数器缺失时数一次并保存 */
/* ---------- 日历：哪些日子有记录、某天在第几条 ---------- */
const firstKey = (index, range, dir) => new Promise((resolve, reject) => {
  const r = index.openKeyCursor(range, dir);
  r.onsuccess = () => resolve(r.result ? r.result.key : null);
  r.onerror = () => reject(r.error);
});

/** 最早与最近一条顶层记录的关闭时间 */
export async function topBounds() {
  const db = await openDB();
  const index = db.transaction(RECORDS).objectStore(RECORDS).index('top');
  const [a, b] = await Promise.all([firstKey(index, TOP(), 'next'), firstKey(index, TOP(), 'prev')]);
  return a ? { min: a[1], max: b[1] } : null;
}

/**
 * days: [[start, end), ...] → 每个区间是否有顶层记录
 * 每天只探一下索引（取第一个键即停），一个月 31 次，与记录总数无关
 */
export async function daysWithRecords(days) {
  const db = await openDB();
  const index = db.transaction(RECORDS).objectStore(RECORDS).index('top');
  return Promise.all(days.map(([a, b]) => firstKey(index, IDBKeyRange.bound([0, a], [0, b], false, true), 'prev').then(Boolean)));
}

/** 关闭时间晚于 ts 的顶层记录有多少条（= 那一刻之前最新一条的序号） */
export async function countNewer(ts) {
  const db = await openDB();
  const index = db.transaction(RECORDS).objectStore(RECORDS).index('top');
  return req2p(index.count(IDBKeyRange.bound([0, ts], [0, Infinity], true, false)));
}

export async function countTop() {
  const db = await openDB();
  const meta = await req2p(db.transaction(META).objectStore(META).get('top'));
  if (meta && Number.isFinite(meta.value)) return meta.value;
  const n = await req2p(db.transaction(RECORDS).objectStore(RECORDS).index('top').count(IDBKeyRange.bound([0, -Infinity], [0, Infinity])));
  const tx = db.transaction(META, 'readwrite');
  tx.objectStore(META).put({ key: 'top', value: n });
  await done(tx);
  return n;
}

function bumpTop(store, d) {
  if (!d) return;
  const r = store.get('top');
  r.onsuccess = () => { if (r.result) store.put({ key: 'top', value: Math.max(0, r.result.value + d) }); };
}

export async function children(windowRecId) {
  const db = await openDB();
  const rows = await req2p(db.transaction(RECORDS).objectStore(RECORDS).index('windowRecId').getAll(windowRecId));
  return rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

export async function getMany(ids) {
  const db = await openDB();
  const store = db.transaction(RECORDS).objectStore(RECORDS);
  return (await Promise.all(ids.map((id) => req2p(store.get(id))))).filter(Boolean);
}

export async function topHosts(n = 12) {
  const db = await openDB();
  const all = await req2p(db.transaction(HOSTS).objectStore(HOSTS).getAll());
  return all.filter((h) => h.count > 0 && h.host).sort((a, b) => b.count - a.count).slice(0, n);
}

/* ---------- 写入（仅后台调用） ---------- */
/** deltas: host → { d: 计数增减, url: 该站点的一个页面地址（用于取图标） } */
function bumpHosts(store, deltas) {
  for (const [host, { d, url }] of deltas) {
    if (!host || !d) continue;
    const r = store.get(host);
    r.onsuccess = () => {
      const count = (r.result?.count || 0) + d;
      if (count > 0) store.put({ host, count, url: (d > 0 && url) || r.result?.url || url });
      else store.delete(host);
    };
  }
}
function delta(map, rec, d) {
  if (!rec.host) return;
  const cur = map.get(rec.host) || { d: 0, url: '' };
  cur.d += d;
  if (d > 0) cur.url = rec.url;
  map.set(rec.host, cur);
}
const countable = (rec) => rec.kind === 'tab';

/** 一个事务内：写入新记录、按网址合并重复、维护站点计数。返回被合并掉的记录 id */
export async function writeBatch(records, { dedupe = false } = {}) {
  await countTop();   // 确保计数器存在
  const db = await openDB();
  const tx = db.transaction([RECORDS, HOSTS, META], 'readwrite');
  const store = tx.objectStore(RECORDS);
  const hosts = tx.objectStore(HOSTS);
  const deltas = new Map();
  const replaced = [];
  let top = 0;
  const fresh = new Set(records.map((r) => r.id));

  // 已存在的记录（撤销时重新写入）不重复计数
  const existing = new Set((await Promise.all(records.filter((r) => r.lvl === 0).map((r) => req2p(store.getKey(r.id))))).filter(Boolean));
  for (const rec of records) {
    if (rec.lvl === 0 && !existing.has(rec.id)) top++;
    store.put(rec);
    if (countable(rec)) delta(deltas, rec, 1);
  }
  if (dedupe) {
    const urls = new Set(records.filter((r) => r.kind === 'tab' && r.lvl === 0).map((r) => r.url));
    await Promise.all([...urls].map(async (url) => {
      const same = await req2p(store.index('url').getAll(url));
      for (const old of same) {
        if (fresh.has(old.id) || old.lvl !== 0 || old.kind !== 'tab') continue;
        store.delete(old.id);
        delta(deltas, old, -1);
        replaced.push(old.id);
        top--;
      }
    }));
  }
  bumpHosts(hosts, deltas);
  bumpTop(tx.objectStore(META), top);
  await done(tx);
  return replaced;
}

export async function putRecord(rec) {
  const db = await openDB();
  const tx = db.transaction(RECORDS, 'readwrite');
  tx.objectStore(RECORDS).put(rec);
  await done(tx);
}

/** 删除记录（顶层窗口会连同其中的标签一起删除），返回被删除的完整记录用于撤销 */
export async function deleteRecords(ids) {
  await countTop();
  const db = await openDB();
  const tx = db.transaction([RECORDS, HOSTS, META], 'readwrite');
  const store = tx.objectStore(RECORDS);
  const deltas = new Map();
  const removed = [];
  const touchedWindows = new Set();

  await Promise.all(ids.map(async (id) => {
    const rec = await req2p(store.get(id));
    if (!rec) return;
    removed.push(rec);
    store.delete(id);
    if (countable(rec)) delta(deltas, rec, -1);
    if (rec.kind === 'window') {
      for (const child of await req2p(store.index('windowRecId').getAll(id))) {
        removed.push(child);
        store.delete(child.id);
        delta(deltas, child, -1);
      }
    } else if (rec.win) touchedWindows.add(rec.win);
  }));

  // 窗口里的标签被单独删除 / 恢复后：更新窗口计数，空窗口一并删除
  await Promise.all([...touchedWindows].map(async (wid) => {
    const win = await req2p(store.get(wid));
    if (!win) return;
    const left = await req2p(store.index('windowRecId').count(wid));
    if (!left) { store.delete(wid); removed.push(win); }
    else store.put({ ...win, count: left, partial: true });
  }));

  bumpHosts(tx.objectStore(HOSTS), deltas);
  bumpTop(tx.objectStore(META), -removed.filter((r) => r.lvl === 0).length);
  await done(tx);
  return removed;
}

/** 按时间范围或站点批量删除，返回删除数量。分批进行，避免长事务阻塞读取 */
export async function deleteWhere({ since = -Infinity, until = Infinity, host = '', site = '' } = {}) {
  const db = await openDB();
  let total = 0;
  for (;;) {
    const tx = db.transaction(RECORDS);
    const store = tx.objectStore(RECORDS);
    let rows;
    if (host) rows = await req2p(store.index('host').getAll(host, 3000));
    else if (site) {
      rows = (await req2p(store.getAll(null))).filter((r) => r.host === site || r.host.endsWith('.' + site)).slice(0, 3000);
    } else {
      const lo = since === -Infinity ? null : since;
      const hi = until === Infinity ? null : until;
      const range = lo != null && hi != null ? IDBKeyRange.bound(lo, hi, false, true)
        : lo != null ? IDBKeyRange.lowerBound(lo) : hi != null ? IDBKeyRange.upperBound(hi, true) : null;
      rows = await req2p(store.index('closedAt').getAll(range, 3000));
    }
    // 窗口里的标签随窗口删除；单独命中的标签走 deleteRecords 以维护窗口计数
    const ids = rows.filter((r) => !(r.lvl === 1 && rows.some((w) => w.id === r.win))).map((r) => r.id);
    if (!ids.length) return total;
    total += (await deleteRecords(ids)).filter((r) => r.kind === 'tab').length;
    if (rows.length < 3000) return total;
  }
}

/** 超出数量上限：删除最旧的顶层记录 */
export async function trimTo(limit) {
  const n = await countTop();
  if (n <= limit) return 0;
  let excess = n - limit;
  let removed = 0;
  const db = await openDB();
  while (excess > 0) {
    const take = Math.min(excess, 2000);
    const keys = await req2p(db.transaction(RECORDS).objectStore(RECORDS).index('top')
      .getAllKeys(IDBKeyRange.bound([0, -Infinity], [0, Infinity]), take));
    if (!keys.length) break;
    await deleteRecords(keys);
    excess -= keys.length;
    removed += keys.length;
  }
  return removed;
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction([RECORDS, HOSTS, META], 'readwrite');
  tx.objectStore(RECORDS).clear();
  tx.objectStore(HOSTS).clear();
  tx.objectStore(META).put({ key: 'top', value: 0 });
  await done(tx);
}
