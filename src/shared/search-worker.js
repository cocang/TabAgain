/* =============================================================================
   搜索线程
   -----------------------------------------------------------------------------
   · 只读 IndexedDB，按关闭时间从新到旧分时间窗批量读取（getAll，比逐条游标快一个数量级）
   · 边找边出结果：凑够前 N 条立即返回，其余分批追加
   · 新查询到达时中止旧查询（每个时间窗之间检查一次）
   · 第一次完整扫描后，可检索的字段留在本线程内存里；之后每次输入只扫内存（十万条约 20ms）
     后台的增删通过 BroadcastChannel 同步到这份缓存
   ============================================================================= */
import { openDB, RECORDS, req2p } from './db.js';
import { parseQuery, matches } from './text.js';

let current = 0;
const HOUR = 36e5;

/* ---------- 内存缓存 ---------- */
let cache = null;          // 按关闭时间倒序的完整列表；null 表示尚未建立
let building = null;       // 正在建立中的列表
const slim = (r) => ({ ...r });

const bc = new BroadcastChannel('tabagain');
bc.onmessage = ({ data }) => {
  if (!cache) { building = null; return; }
  if (data.t === 'reset') { cache = null; return; }
  const gone = new Set([...(data.ids || []), ...(data.del || [])]);
  if (gone.size) cache = cache.filter((r) => !gone.has(r.id) && !gone.has(r.win));
  // 新记录：顶层标签直接加入；窗口里的标签需要读取后加入
  if (data.t === 'add' && data.recs?.length) {
    const tabs = data.recs.filter((r) => r.kind === 'tab');
    const wins = data.recs.filter((r) => r.kind === 'window').map((r) => r.id);
    cache = tabs.map(slim).concat(cache);
    if (wins.length) openDB().then((db) => Promise.all(wins.map((id) =>
      req2p(db.transaction(RECORDS).objectStore(RECORDS).index('windowRecId').getAll(id))))).then((lists) => {
      if (cache) cache = lists.flat().map(slim).concat(cache).sort((a, b) => b.closedAt - a.closedAt);
    }).catch(() => {});
  }
  if (data.t === 'sid' && cache) for (const r of cache) if (r.id === data.id) r.sid = data.sid;
};

self.onmessage = async ({ data }) => {
  if (data.type === 'warm') { if (!cache && !building) warm(); return; }
  if (data.type !== 'search') return;
  const qid = (current = data.qid);
  try { await search(qid, data); }
  catch (error) { if (qid === current) postMessage({ qid, error: String(error), done: true, recs: [], found: 0 }); }
};

async function search(qid, { raw, host = '', first = 50 }) {
  const q = parseQuery(raw);
  q.host = host;
  const started = performance.now();
  let found = 0, batch = [], sentFirst = false, lastPost = started;

  const post = (doneFlag) => {
    postMessage({ qid, recs: batch, done: doneFlag, found, ms: Math.round(performance.now() - started) });
    batch = [];
    lastPost = performance.now();
    sentFirst = true;
  };
  const take = (rows) => {
    for (const rec of rows) {
      if (rec.kind === 'window' || !matches(rec, q)) continue;
      batch.push(rec);
      found++;
    }
  };

  // 内存里已有完整列表：直接扫描
  if (cache) {
    for (let i = 0; i < cache.length; i += 5000) {
      take(cache.slice(i, i + 5000));
      if (!sentFirst && batch.length >= first) post(false);
    }
    return post(true);
  }

  const db = await openDB();
  // 站点筛选：直接走 host 索引
  if (host) {
    const rows = await req2p(db.transaction(RECORDS).objectStore(RECORDS).index('host').getAll(host));
    rows.sort((a, b) => b.closedAt - a.closedAt);
    for (let i = 0; i < rows.length; i += 2000) {
      if (qid !== current) return;
      take(rows.slice(i, i + 2000));
      if (!sentFirst && batch.length >= first) post(false);
    }
    return post(true);
  }

  const index = () => db.transaction(RECORDS).objectStore(RECORDS).index('closedAt');
  const oldest = await new Promise((resolve) => {
    const c = index().openKeyCursor();
    c.onsuccess = () => resolve(c.result ? c.result.key : Infinity);
    c.onerror = () => resolve(Infinity);
  });
  let hi = Math.min(q.until, Date.now() + 60e3);
  const floor = Math.max(q.since, oldest);
  const full = q.since === -Infinity && q.until === Infinity;   // 无时间限定的扫描顺便建立缓存
  const collected = full ? [] : null;
  let span = 6 * HOUR;

  while (hi > floor) {
    if (qid !== current) return;
    const lo = Math.max(hi - span, floor);
    const rows = await req2p(index().getAll(IDBKeyRange.bound(lo, hi, false, true)));
    rows.reverse();
    take(rows);
    if (collected) for (const r of rows) collected.push(r);
    hi = lo;
    if (rows.length < 800) span = Math.min(span * 2, 400 * 24 * HOUR);
    else if (rows.length > 4000) span = Math.max(span / 2, HOUR / 4);
    if (!sentFirst ? batch.length >= first : batch.length && performance.now() - lastPost > 120) post(false);
  }
  if (collected && !cache) cache = collected;
  if (qid === current) post(true);
}

/** 预热：空闲时把可检索的记录读进内存 */
async function warm() {
  const db = await openDB();
  const index = () => db.transaction(RECORDS).objectStore(RECORDS).index('closedAt');
  const list = (building = []);
  let hi = Date.now() + 60e3, span = 6 * HOUR;
  const oldest = await new Promise((resolve) => {
    const c = index().openKeyCursor();
    c.onsuccess = () => resolve(c.result ? c.result.key : Infinity);
    c.onerror = () => resolve(Infinity);
  });
  while (hi > oldest) {
    if (building !== list || cache) return;   // 期间有变更或已由搜索建立
    const lo = Math.max(hi - span, oldest);
    const rows = await req2p(index().getAll(IDBKeyRange.bound(lo, hi, false, true)));
    for (let i = rows.length - 1; i >= 0; i--) list.push(rows[i]);
    hi = lo;
    if (rows.length < 1500) span = Math.min(span * 2, 400 * 24 * HOUR); else if (rows.length > 6000) span /= 2;
  }
  if (building === list && !cache) cache = list;
  building = null;
}
