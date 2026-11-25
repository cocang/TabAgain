/* =============================================================================
   文本工具：域名、拼音、搜索字段、查询解析与匹配
   后台（写入时生成搜索字段）、搜索线程、界面高亮共用同一份逻辑，保证三处结果一致。
   ============================================================================= */
import TABLE from './pinyin-data.js';

/* ---------- 拼音 ---------- */
let charMap = null;
function map() {
  if (charMap) return charMap;
  charMap = new Map();
  for (const [py, chars] of Object.entries(TABLE)) for (const ch of chars) charMap.set(ch, py);
  return charMap;
}
export const isCJK = (ch) => ch >= '\u4e00' && ch <= '\u9fff';
export const hasCJK = (text) => /[\u4e00-\u9fff]/.test(text);

/** 逐字拼音：汉字给出音节，其余字符原样（小写） */
export function syllables(text) {
  const m = map();
  return [...text].map((ch) => (isCJK(ch) && m.get(ch)) || ch.toLowerCase());
}

/** 全拼与首字母（只在含汉字时生成，节省空间） */
export function pinyinOf(text) {
  if (!hasCJK(text)) return null;
  const parts = syllables(text);
  const keep = (s) => /^[a-z0-9]+$/.test(s);
  return {
    full: parts.filter(keep).join(''),
    init: parts.filter(keep).map((s) => s[0]).join('')
  };
}

/* ---------- 域名 ---------- */
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'file';
    if (/^https?:$/.test(u.protocol)) return u.hostname.replace(/^www\./, '');
    return u.protocol.replace(':', '') + (u.hostname ? '://' + u.hostname : '');
  } catch { return ''; }
}

/** 文件名等不适合当“域名”展示的情况，用路径尾部代替 */
export function displayHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop() || u.pathname);
  } catch {}
  return hostOf(url) || url;
}

export const MAX_TITLE = 300;
export const clipTitle = (title) => (title || '').slice(0, MAX_TITLE);

/** 写入时预先生成的搜索字段：小写标题 ␟ 域名 ␟ 全拼 ␟ 首字母 */
export function searchField(title, host) {
  const t = (title || '').toLowerCase();
  const py = pinyinOf(title || '');
  return py ? `${t}\u001f${host}\u001f${py.full}\u001f${py.init}` : `${t}\u001f${host}`;
}

/* ---------- 查询解析 ---------- */
const DAY = 864e5;
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

const RANGES = {
  '今天': (n) => [startOfDay(n), Infinity], 'today': (n) => [startOfDay(n), Infinity],
  '昨天': (n) => [startOfDay(n) - DAY, startOfDay(n)], 'yesterday': (n) => [startOfDay(n) - DAY, startOfDay(n)],
  '前天': (n) => [startOfDay(n) - 2 * DAY, startOfDay(n) - DAY],
  '本周': (n) => { const d = new Date(startOfDay(n)); const w = (d.getDay() + 6) % 7; return [d.getTime() - w * DAY, Infinity]; },
  '本週': (n) => { const d = new Date(startOfDay(n)); const w = (d.getDay() + 6) % 7; return [d.getTime() - w * DAY, Infinity]; },
  'week': (n) => [startOfDay(n) - 6 * DAY, Infinity], '近7天': (n) => [startOfDay(n) - 6 * DAY, Infinity],
  '本月': (n) => { const d = new Date(n); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), Infinity]; },
  'month': (n) => { const d = new Date(n); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), Infinity]; }
};

/**
 * 支持：关键词（空格分隔，全部命中）、-排除词、site:域名、今天 / 昨天 / 前天 / 本周 / 本月
 * 返回 { terms, exclude, site, since, until, empty }
 */
export function parseQuery(raw, now = Date.now()) {
  const q = { terms: [], exclude: [], site: '', host: '', since: -Infinity, until: Infinity };
  for (const token of (raw || '').trim().split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower.startsWith('site:') && lower.length > 5) { q.site = lower.slice(5).replace(/^www\./, ''); continue; }
    if (RANGES[lower]) { [q.since, q.until] = RANGES[lower](now); continue; }
    if (lower.startsWith('-') && lower.length > 1) { q.exclude.push(lower.slice(1)); continue; }
    q.terms.push(lower);
  }
  q.empty = !q.terms.length && !q.exclude.length && !q.site && q.since === -Infinity;
  return q;
}

export function matches(rec, q) {
  if (rec.closedAt < q.since || rec.closedAt >= q.until) return false;
  const host = rec.host || '';
  if (q.host && host !== q.host) return false;
  if (q.site && host !== q.site && !host.endsWith('.' + q.site)) return false;
  const s = rec.s || '';
  for (const term of q.terms) if (!s.includes(term) && !(rec.url || '').toLowerCase().includes(term)) return false;
  for (const term of q.exclude) if (s.includes(term)) return false;
  return true;
}

/**
 * 高亮区间：直接匹配 + 拼音匹配（全拼 / 首字母映射回原文字符）
 * 返回按起点排序、互不重叠的 [start, end) 区间（以 UTF-16 下标计）
 */
export function highlightRanges(text, terms) {
  if (!text || !terms.length) return [];
  const lower = text.toLowerCase();
  const ranges = [];
  let chars = null;
  for (const term of terms) {
    let from = 0, at, hit = false;
    while ((at = lower.indexOf(term, from)) > -1) { ranges.push([at, at + term.length]); from = at + term.length; hit = true; }
    if (hit || !hasCJK(text) || !/^[a-z0-9]+$/.test(term)) continue;
    // 拼音匹配
    if (!chars) {
      chars = [];
      let offset = 0;
      for (const [i, ch] of [...text].entries()) { chars.push({ ch, at: offset, py: syllables(ch)[0] }); offset += ch.length; void i; }
    }
    const mark = (startIdx, endIdx) => ranges.push([chars[startIdx].at, chars[endIdx].at + chars[endIdx].ch.length]);
    // 首字母
    const init = chars.map((c) => c.py[0] || ' ').join('');
    let k = init.indexOf(term);
    if (k > -1) { mark(k, k + term.length - 1); continue; }
    // 全拼：在字符边界上拼接
    let full = '', starts = [];
    for (const c of chars) { starts.push(full.length); full += c.py; }
    k = full.indexOf(term);
    if (k > -1) {
      let s = starts.findLastIndex((p) => p <= k);
      let e = starts.findLastIndex((p) => p <= k + term.length - 1);
      mark(s, e);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  }
  return merged;
}
