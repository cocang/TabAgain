/* =============================================================================
   界面共用模块：本地化、数字与时间、网站图标、高亮、虚拟列表、
   玻璃提示卡、右键菜单、浮层提示、飞入动效、视图过渡
   ============================================================================= */
import { highlightRanges, displayHost } from './text.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
/** 带数量的文案：数量为 1 时优先取 key + 'One'（英文单数），其余语言两条相同 */
export const tn = (key, n, subs) => (n === 1 && chrome.i18n.getMessage(key + 'One', subs)) || t(key, subs);
export const lang = chrome.i18n.getUILanguage();
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));
}

/* ---------- 数字 ---------- */
const nf = new Intl.NumberFormat(lang);
export const num = (n) => nf.format(n);

/* ---------- 时间与分组 ---------- */
const DAY = 864e5;
const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', weekday: 'short' });
const dayYearFmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' });
const fullFmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
export const monthKey = (ts) => { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); };
export const monthLabel = (ts) => monthFmt.format(ts);
export const fullTime = (ts) => fullFmt.format(ts);

/** 分组：刚刚（5 分钟内）· 今天 · 昨天 · 具体日期 */
export function groupOf(ts, now) {
  const today = startOfDay(now);
  if (now - ts < 5 * 60e3) return { key: 'now', label: t('groupJustNow') };
  if (ts >= today) return { key: 'd' + today, label: t('groupToday') };
  if (ts >= today - DAY) return { key: 'd' + (today - DAY), label: t('groupYesterday') };
  const day = startOfDay(ts);
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return { key: 'd' + day, label: (sameYear ? dayFmt : dayYearFmt).format(ts) };
}

/** 行内时间：分组已经说明了日期，这里只给更具体的信息，不重复「刚刚」 */
export function rowTime(ts, now, groupKey) {
  if (groupKey === 'now') {
    const m = Math.floor((now - ts) / 60e3);
    return m < 1 ? t('lessThanMinute') : t('minutesAgo', [String(m)]);
  }
  return timeFmt.format(ts);
}

/* ---------- 网站图标 ---------- */
export const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');

/** 打开浏览器的快捷键设置：Firefox 有专用接口，Chrome 用内部页面 */
export function openShortcutSettings() {
  if (chrome.commands?.openShortcutSettings) return chrome.commands.openShortcutSettings();
  return chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

export function faviconUrl(url, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', String(size));
  return u.toString();
}

const toneCache = new Map();
const canvas = new OffscreenCanvas(16, 16);
const ctx2d = canvas.getContext('2d', { willReadFrequently: true });

/** 从图标取主色：按不透明度加权平均，同时给出明度，用于生成同色系的淡底 */
function analyse(img) {
  try {
    ctx2d.clearRect(0, 0, 16, 16);
    ctx2d.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx2d.getImageData(0, 0, 16, 16);
    let r = 0, g = 0, b = 0, w = 0, sat = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.1) continue;
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      const s = max ? (max - min) / max : 0;
      const weight = a * (0.35 + s);       // 偏重有色像素，避免白底把主色冲淡
      r += data[i] * weight; g += data[i + 1] * weight; b += data[i + 2] * weight; w += weight; sat += s * a;
    }
    if (!w) return null;
    r /= w; g /= w; b /= w;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { rgb: `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`, lum };
  } catch { return null; }
}

function applyTone(tile, tone) {
  if (!tone) { tile.removeAttribute('data-tone'); tile.style.removeProperty('--fav-rgb'); return; }
  tile.style.setProperty('--fav-rgb', tone.rgb);
  tile.dataset.tone = tone.lum < 0.3 ? 'dark' : tone.lum > 0.85 ? 'light' : 'mid';
}

/* ---------- 图标缺失时：域名首字母 + 由域名哈希出的柔和色 ---------- */
const SLD = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);
/** 站点的「名字」：去掉 www 与后缀，github.com → github，mp.weixin.qq.com → qq，bbc.co.uk → bbc */
export function siteName(host = '') {
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':') || host === 'localhost') return host.replace(/^\[/, '');   // IP 与本机
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  let i = parts.length - 2;
  if (i > 0 && SLD.has(parts[i]) && parts[i + 1].length === 2) i--;
  return parts[i];
}
/** FNV-1a → 色相；避开偏脏的黄绿区（50–80°），让每个网站有自己稳定的颜色 */
export function hueOf(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const hue = (h >>> 0) % 330;
  return hue < 50 ? hue : hue + 30;
}
function letterOf(host) {
  const n = siteName(host);
  if (!n) return '';
  if (n.startsWith('xn--')) return '◆';
  const ch = [...n][0];
  return /[0-9]/.test(ch) ? ch : ch.toUpperCase();
}
function setMonogram(tile, host) {
  tile.classList.add('fallback', 'mono');
  tile.style.setProperty('--fh', hueOf(siteName(host) || host || '?'));
  tile.dataset.letter = letterOf(host);
  tile.removeAttribute('data-tone');
  tile.style.removeProperty('--fav-rgb');
}
function clearMonogram(tile) {
  tile.classList.remove('fallback', 'mono');
  tile.style.removeProperty('--fh');
  delete tile.dataset.letter;
}

/* Chrome 的 _favicon 对没有图标的网站不会报错，而是返回一个灰色地球：
   取一次「必然没有图标」的地址作为指纹，之后像素完全一致的就视为缺失 */
const fpCanvas = new OffscreenCanvas(16, 16);
const fpCtx = fpCanvas.getContext('2d', { willReadFrequently: true });
function fingerprint(img) {
  try {
    fpCtx.clearRect(0, 0, 16, 16);
    fpCtx.drawImage(img, 0, 0, 16, 16);
    const d = fpCtx.getImageData(0, 0, 16, 16).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  } catch { return null; }
}
let defaultPrint = null;
function defaultFingerprint() {
  return defaultPrint ||= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(fingerprint(img));
    img.onerror = () => resolve(null);
    img.src = faviconUrl('https://tabagain-no-icon.invalid/');
  });
}
const missing = new Set();   // 已确认没有图标的站点

/** 填充图标方块：同站点复用取色结果；没有图标时显示首字母色块
 *  fav：网页自己的图标地址（Firefox 记录的 favIconUrl），Chrome 用 _favicon 接口 */
export function setFavicon(tile, url, host, fav) {
  let img = tile.querySelector('img');
  if (!img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; tile.prepend(img); }
  if (IS_FIREFOX && !fav) { img.dataset.src = ''; setMonogram(tile, host); img.removeAttribute('src'); return; }
  const src = IS_FIREFOX ? fav : faviconUrl(url);
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  if (missing.has(host)) { setMonogram(tile, host); img.removeAttribute('src'); return; }
  clearMonogram(tile);
  applyTone(tile, toneCache.get(host));
  img.onload = async () => {
    if (img.dataset.src !== src) return;
    if (!toneCache.has(host)) {
      const [fp, def] = IS_FIREFOX ? [null, null] : [fingerprint(img), await defaultFingerprint()];
      if (img.dataset.src !== src) return;
      if (fp != null && fp === def) { missing.add(host); return setMonogram(tile, host); }
      toneCache.set(host, analyse(img));
    }
    applyTone(tile, toneCache.get(host));
  };
  img.onerror = () => {
    if (img.dataset.src !== src) return;
    missing.add(host);
    setMonogram(tile, host);
  };
  img.src = src;
}

/* ---------- 高亮 ---------- */
export function highlight(el, text, terms) {
  el.textContent = '';
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) { el.textContent = text; return; }
  let cursor = 0;
  for (const [s, e] of ranges) {
    el.append(text.slice(cursor, s));
    const m = document.createElement('mark');
    m.textContent = text.slice(s, e);
    el.append(m);
    cursor = e;
  }
  el.append(text.slice(cursor));
}

export { displayHost };

/* ---------- 图标 ---------- */
export function icon(name, cls = 'i') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

/* =============================================================================
   虚拟列表
   · 只渲染可见区域（上下各留少量余量），元素按类型复用
   · 行高固定，分组标题单独定高；用前缀和定位，二分查找首个可见项
   · 吸顶分组标题：根据滚动位置计算当前分组，下一组靠近时被推上去
   · FLIP：数据变化时，可见区内的行从旧位置平滑移到新位置
   ============================================================================= */
export class VirtualList {
  constructor({ scroller, content, heights, create, render, renderSticky, keyOf, sticky, overscan = 8, onRange, bottomInset = 8 }) {
    Object.assign(this, { scroller, content, heights, createItem: create, renderItem: render, renderSticky, keyOf, sticky, overscan, onRange, bottomInset });
    this.items = [];
    this.tops = new Float64Array(1);
    this.live = new Map();     // key → element
    this.pool = new Map();     // type → [element]
    this.activeKey = null;
    this.headerIdx = [];
    this.frame = 0;
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(scroller);
  }

  heightOf(item) { return this.heights[item.type] ?? this.heights.r; }

  setItems(items, { flip = false } = {}) {
    const before = flip ? this.snapshot() : null;
    this.items = items;
    const tops = new Float64Array(items.length + 1);
    const headers = [];
    for (let i = 0; i < items.length; i++) {
      tops[i + 1] = tops[i] + this.heightOf(items[i]);
      if (items[i].type === 'h') headers.push(i);
    }
    this.tops = tops;
    this.headerIdx = headers;
    this.content.style.height = tops[items.length] + 'px';
    this.render(true);
    if (before) this.flip(before);
  }

  get total() { return this.tops[this.items.length] || 0; }

  indexAt(y) {
    let lo = 0, hi = this.items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(false); });
  }

  render(force) {
    const top = this.scroller.scrollTop;
    const h = this.scroller.clientHeight;
    const n = this.items.length;
    const first = n ? Math.max(0, this.indexAt(top) - this.overscan) : 0;
    const last = n ? Math.min(n - 1, this.indexAt(top + h) + this.overscan) : -1;
    const keep = new Set();

    for (let i = first; i <= last; i++) {
      const item = this.items[i];
      const key = this.keyOf(item);
      keep.add(key);
      let el = this.live.get(key);
      const fresh = !el;
      if (fresh) {
        el = this.take(item.type);
        this.live.set(key, el);
      }
      if (fresh || force || el._item !== item) {
        if (!el._leaving) el.getAnimations().forEach((a) => a.effect?.getComputedTiming().fill === 'forwards' && a.cancel());
        el._item = item;
        el.dataset.key = key;
        this.renderItem(el, item, i);
      }
      el.dataset.index = i;
      el.style.transform = `translateY(${this.tops[i]}px)`;
      el.classList.toggle('active', key === this.activeKey);
    }
    for (const [key, el] of this.live) {
      if (keep.has(key) || el._leaving) continue;
      this.live.delete(key);
      this.give(el);
    }
    this.updateSticky(top);
    this.onRange?.(first, last, top);
  }

  take(type) {
    const list = this.pool.get(type);
    const el = list?.pop() || this.create(type);
    el.hidden = false;
    if (!el.isConnected) this.content.append(el);
    return el;
  }
  give(el) {
    el.hidden = true;
    el.classList.remove('active', 'enter');
    el.style.viewTransitionName = '';
    el.getAnimations().forEach((a) => a.cancel());
    const type = el.dataset.type;
    if (!this.pool.has(type)) this.pool.set(type, []);
    this.pool.get(type).push(el);
  }
  create(type) {
    const el = this.createItem(type);
    el.dataset.type = type;
    el.classList.add('vitem');
    return el;
  }

  updateSticky(top) {
    if (!this.sticky) return;
    const hs = this.headerIdx;
    if (!hs.length || top <= this.tops[hs[0]] + 0.5) { this.sticky.hidden = true; return; }
    // 最后一个顶部已滚过的分组标题
    let lo = 0, hi = hs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.tops[hs[mid]] <= top) lo = mid; else hi = mid - 1; }
    const cur = this.items[hs[lo]];
    const next = hs[lo + 1];
    const hh = this.heights.h;
    const push = next != null ? Math.min(0, this.tops[next] - top - hh) : 0;
    this.sticky.hidden = false;
    if (this.sticky._item !== cur) { this.sticky._item = cur; this.renderSticky(this.sticky, cur); }
    this.sticky.style.transform = `translateY(${push}px)`;
  }

  /* 可见行的当前位置 */
  snapshot() {
    const map = new Map();
    for (const [key, el] of this.live) if (!el.hidden) map.set(key, this.tops[+el.dataset.index] ?? null);
    return map;
  }

  flip(before) {
    if (reduceMotion.matches) return;
    const top = this.scroller.scrollTop, h = this.scroller.clientHeight;
    for (const [key, el] of this.live) {
      const old = before.get(key);
      const now = this.tops[+el.dataset.index];
      if (old == null) {
        if (now >= top - 60 && now <= top + h) {
          el.animate([{ opacity: 0, transform: `translateY(${now + 6}px)` }, { opacity: 1, transform: `translateY(${now}px)` }],
            { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
        }
        continue;
      }
      if (old === now) continue;
      if (Math.abs(old - now) > h) continue;
      el.animate([{ transform: `translateY(${old}px)` }, { transform: `translateY(${now}px)` }],
        { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
  }

  elementFor(key) { return this.live.get(key); }

  indexOfKey(key) { return this.items.findIndex((it) => this.keyOf(it) === key); }

  setActive(key, scroll = false) {
    this.activeKey = key;
    for (const [k, el] of this.live) el.classList.toggle('active', k === key);
    if (scroll && key != null) this.scrollIntoView(this.indexOfKey(key));
  }

  scrollIntoView(i) {
    if (i < 0) return;
    const top = this.tops[i], bottom = this.tops[i + 1];
    const st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    const padTop = this.sticky ? this.heights.h + 4 : 4;
    const padBottom = this.bottomInset || 8;
    if (top < st + padTop) this.scroller.scrollTop = top - padTop;
    else if (bottom > st + h - padBottom) this.scroller.scrollTop = bottom - h + padBottom;
  }

  /** 视图过渡：只给完全处于可视区的行命名，避免可视区外的行在过渡中“飞出”滚动区 */
  nameVisible() {
    const st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    for (const [key, el] of this.live) {
      const y = this.tops[+el.dataset.index];
      const visible = !el.hidden && y >= st && y + this.heightOf(el._item) <= st + h && el.dataset.type !== 'h';
      el.style.viewTransitionName = visible ? 'v' + key.replace(/[^a-zA-Z0-9_-]/g, '') : '';
    }
  }
  clearNames() { for (const el of this.live.values()) el.style.viewTransitionName = ''; }

  transition(update) {
    if (!document.startViewTransition || reduceMotion.matches || document.hidden) { update(); return; }
    this.nameVisible();
    const vt = document.startViewTransition(() => { this.clearNames(); update(); this.nameVisible(); });
    vt.finished.finally(() => this.clearNames());
  }
}

/* =============================================================================
   玻璃提示卡：悬停 600ms 后出现，显示完整标题、网址与关闭时间
   ============================================================================= */
export function tooltip(root, getInfo) {
  const card = document.createElement('div');
  card.className = 'tip glass';
  card.setAttribute('role', 'tooltip');
  card.innerHTML = '<b class="tip-title"></b><span class="tip-url"></span><span class="tip-meta"></span>';
  document.body.append(card);
  let timer = 0, target = null;

  const hide = () => { clearTimeout(timer); target = null; card.classList.remove('show'); };
  const show = (el) => {
    const info = getInfo(el);
    if (!info) return;
    card.querySelector('.tip-title').textContent = info.title;
    card.querySelector('.tip-url').textContent = info.url || '';
    card.querySelector('.tip-url').hidden = !info.url;
    const meta = card.querySelector('.tip-meta');
    meta.textContent = '';
    for (const line of info.meta) {
      const span = document.createElement('span');
      if (line.icon) span.append(icon(line.icon, 'i i-xs'));
      span.append(line.text);
      if (line.accent) span.className = 'accent';
      meta.append(span);
    }
    const r = el.getBoundingClientRect();
    card.style.left = '0px'; card.style.top = '0px';
    card.classList.add('measure');
    const w = card.offsetWidth, h = card.offsetHeight;
    card.classList.remove('measure');
    const margin = 10;
    let x = Math.min(Math.max(margin, r.left + 44), innerWidth - w - margin);
    let below = r.bottom + 6 + h < innerHeight - 56;
    let y = below ? r.bottom + 6 : r.top - h - 6;
    if (y < margin) y = margin;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.dataset.side = below ? 'below' : 'above';
    card.classList.add('show');
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === target) return;
    hide();
    if (!el || e.pointerType === 'touch') return;
    target = el;
    timer = setTimeout(() => target === el && el.isConnected && !el.hidden && show(el), 600);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('wheel', hide, { passive: true });
  root.addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('keydown', hide, true);
  return { hide };
}

/* =============================================================================
   右键菜单
   ============================================================================= */
export function contextMenu(items, x, y) {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu glass';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === '-') { menu.append(Object.assign(document.createElement('hr'), {})); continue; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.className = item.danger ? 'danger' : '';
    if (item.icon) b.append(icon(item.icon, 'i i-sm'));
    const label = document.createElement('span');
    label.textContent = item.label;
    b.append(label);
    if (item.hint) { const h = document.createElement('small'); h.textContent = item.hint; b.append(h); }
    b.addEventListener('click', () => { close(); item.run(); });
    menu.append(b);
  }
  document.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(x, innerWidth - w - 6) + 'px';
  menu.style.top = (y + h > innerHeight - 6 ? Math.max(6, y - h) : y) + 'px';
  menu.style.transformOrigin = `${x > innerWidth - w - 6 ? 'right' : 'left'} ${y + h > innerHeight - 6 ? 'bottom' : 'top'}`;
  requestAnimationFrame(() => menu.classList.add('show'));
  menu.querySelector('button')?.focus({ preventScroll: true });

  const onKey = (e) => {
    const btns = [...menu.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Enter') { e.stopPropagation(); }
  };
  const onDown = (e) => { if (!menu.contains(e.target)) close(); };
  function close() {
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('blur', close);
    menu.classList.remove('show');
    menu.classList.add('hide');
    setTimeout(() => menu.remove(), 160);
  }
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onDown, true);
  addEventListener('blur', close);
  return close;
}

/* =============================================================================
   浮层提示（可撤销）
   ============================================================================= */
export function createToast(el) {
  let timer = 0, undo = null;
  const text = el.querySelector('.toast-text');
  const btn = el.querySelector('.toast-undo');
  btn?.addEventListener('click', () => { const fn = undo; undo = null; el.classList.remove('show'); fn?.(); });
  return (message, onUndo, ms = 4000) => {
    text.textContent = message;
    undo = onUndo || null;
    if (btn) btn.hidden = !undo;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => { el.classList.remove('show'); undo = null; }, ms);
  };
}

/* =============================================================================
   飞入动效：行收缩成一个光点，沿弧线飞向右上角（工具栏 / 标签栏方向）后消失
   ============================================================================= */
export function flyToCorner(fromEl) {
  if (reduceMotion.matches || !fromEl) return Promise.resolve();
  const r = fromEl.getBoundingClientRect();
  const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
  const tx = innerWidth - 22, ty = -14;
  const dot = document.createElement('div');
  dot.className = 'fly-dot';
  dot.style.left = sx + 'px';
  dot.style.top = sy + 'px';
  document.body.append(dot);
  const dx = tx - sx, dy = ty - sy;
  const anim = dot.animate([
    { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.18 },
    { transform: `translate(calc(-50% + ${dx * 0.42}px), calc(-50% + ${dy * 0.18 - 46}px)) scale(.9)`, opacity: 1, offset: 0.55 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.35)`, opacity: 0 }
  ], { duration: 640, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
  return anim.finished.then(() => dot.remove(), () => dot.remove());
}

/** 行收拢：先淡出 / 缩小，再由列表 FLIP 合拢间隙 */
export function collapseRow(el, direction = 'left') {
  if (!el || reduceMotion.matches) return Promise.resolve();
  el._leaving = true;
  const base = el.style.transform;
  const dx = direction === 'shrink' ? 0 : direction === 'right' ? 22 : -16;
  const frames = direction === 'shrink'
    ? [{ opacity: 1, transform: `${base} scale(1)` }, { opacity: 0, transform: `${base} scale(.92)` }]
    : [{ opacity: 1, transform: base }, { opacity: 0, transform: `${base} translateX(${dx}px)` }];
  return el.animate(frames, { duration: 200, easing: 'cubic-bezier(.55,0,.75,.25)', fill: 'forwards' })
    .finished.catch(() => {}).then(() => { el._leaving = false; });
}

/* ---------- 快捷键 ---------- */
export async function shortcutKeys() {
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'restore-last');
    const raw = cmd?.shortcut || '';
    return raw ? (raw.includes('+') ? raw.split('+') : [...raw]).map((k) => k.trim()).filter(Boolean) : [];
  } catch { return []; }
}

export function kbd(keys) {
  const wrap = document.createElement('span');
  wrap.className = 'kbd';
  keys.forEach((k) => wrap.append(Object.assign(document.createElement('kbd'), { textContent: k })));
  return wrap;
}

/* =============================================================================
   分页器
   · full：‹ 1 … 4 5 [6] 7 8 … 200 › ＋「跳至」输入框；当前页有滑动高亮
   · compact：‹ [6] / 200 ›，中间数字可直接输入跳页
   · more=true 表示总页数仍在增长（搜索未完成），末尾显示「+」
   ============================================================================= */
export function createPager(root, { compact = false, onChange }) {
  root.classList.add('pager', compact ? 'compact' : 'full');
  root.setAttribute('role', 'navigation');
  root.setAttribute('aria-label', t('pagination'));
  let page = 1, pages = 1, more = false;

  const btn = (cls, name, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg ' + cls;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.append(icon(name, 'i i-sm'));
    return b;
  };
  const prev = btn('pg-prev', 'chevron', t('pagePrev'));
  const next = btn('pg-next', 'chevron', t('pageNext'));
  const nums = document.createElement('div');
  nums.className = 'pg-nums';
  const thumb = document.createElement('span');
  thumb.className = 'pg-thumb';

  let input, jump;
  if (compact) {
    input = document.createElement('input');
    input.className = 'pg-input';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', t('pageJump'));
    const of = document.createElement('span');
    of.className = 'pg-of';
    nums.append(input, of);
  } else {
    nums.append(thumb);
    jump = document.createElement('label');
    jump.className = 'pg-jump';
    jump.append(t('pageJump'));
    input = document.createElement('input');
    input.className = 'pg-input';
    input.inputMode = 'numeric';
    jump.append(input);
  }
  root.append(prev, nums, next);
  if (jump) root.append(jump);

  const go = (p, from) => {
    p = Math.max(1, Math.min(pages, Math.round(p) || 1));
    if (p === page) { render(); return; }
    const dir = p > page ? 1 : -1;
    page = p;
    render();
    onChange(page, dir, from);
  };
  prev.addEventListener('click', () => go(page - 1, 'prev'));
  next.addEventListener('click', () => go(page + 1, 'next'));
  nums.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) go(+b.dataset.page, 'num');
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); go(parseInt(input.value.replace(/\D/g, ''), 10), 'jump'); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = compact ? String(page) : ''; input.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = (parseInt(input.value, 10) || page) + (e.key === 'ArrowUp' ? 1 : -1);
      input.value = String(Math.max(1, Math.min(pages, v)));
    }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => { if (compact) input.value = String(page); });

  /** 1 … 4 5 [6] 7 8 … 200：首尾各一，当前页两侧各二，缺口只差一页时直接补上 */
  function sequence() {
    const out = [];
    const win = 2;
    const lo = Math.max(2, page - win), hi = Math.min(pages - 1, page + win);
    out.push(1);
    if (lo > 3) out.push('…'); else for (let p = 2; p < lo; p++) out.push(p);
    for (let p = lo; p <= hi; p++) out.push(p);
    if (hi < pages - 2) out.push('…'); else for (let p = hi + 1; p < pages; p++) out.push(p);
    if (pages > 1) out.push(pages);
    return out;
  }

  function placeThumb(animate) {
    const on = nums.querySelector('.pg-num[aria-current="page"]');
    if (!on) { thumb.style.opacity = '0'; return; }
    if (!animate) thumb.style.transition = 'none';
    thumb.style.opacity = '1';
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => (thumb.style.transition = ''));
  }

  function render(animate = true) {
    prev.disabled = page <= 1;
    next.disabled = page >= pages && !more;
    root.hidden = pages <= 1 && !more;
    if (compact) {
      if (document.activeElement !== input) input.value = String(page);
      input.style.width = Math.max(2, String(pages).length) + 0.6 + 'ch';
      nums.querySelector('.pg-of').textContent = '/ ' + num(pages) + (more ? '+' : '');
      return;
    }
    const seq = sequence();
    const keep = [...nums.querySelectorAll('.pg-num, .pg-gap')];
    keep.forEach((n) => n.remove());
    for (const p of seq) {
      if (p === '…') {
        const g = document.createElement('span');
        g.className = 'pg-gap';
        g.textContent = '…';
        nums.append(g);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pg-num';
      b.dataset.page = p;
      b.textContent = num(p);
      if (p === page) b.setAttribute('aria-current', 'page');
      nums.append(b);
    }
    if (more) {
      const g = document.createElement('span');
      g.className = 'pg-gap more';
      g.textContent = '…';
      nums.append(g);
    }
    if (document.activeElement !== input) input.value = '';
    input.placeholder = String(page);
    input.style.width = Math.max(2, String(pages).length) + 1.4 + 'ch';
    placeThumb(animate && !reduceMotion.matches);
  }

  return {
    get page() { return page; },
    get pages() { return pages; },
    set(p, total, isMore = false, animate = false) {
      pages = Math.max(1, total);
      more = isMore;
      page = Math.max(1, Math.min(pages, p));
      render(animate);
    },
    go,
    focusInput() { input.focus(); }
  };
}

/** 换页：内容沿方向轻推入场 */
export function slideIn(el, dir) {
  if (reduceMotion.matches || !dir) return;
  el.animate(
    [{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' }
  );
}

/* =============================================================================
   日期选择：有记录的日子带圆点，点一下跳到那天
   · 每月只向数据库探 31 次（每天取一个键即停），与记录总数无关
   · 键盘：方向键逐日 / 逐周，PageUp / PageDown 换月，Enter 选择，Esc 关闭
   · opts: { anchor, getBounds(), hasRecords(days) → bool[], onPick(dayStart), onOpen(), onClose() }
   ============================================================================= */
export function createDatePicker({ anchor, getBounds, hasRecords, onPick, onOpen, onClose }) {
  const lang = (chrome?.i18n?.getUILanguage?.() || navigator.language || 'zh-CN');
  const zh = /^zh/i.test(lang);
  const weekStart = zh ? 1 : 0;   // 中文从周一开始
  const monthFmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' });
  const dayFmt = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const wdFmt = new Intl.DateTimeFormat(lang, { weekday: zh ? 'narrow' : 'short' });

  const el = document.createElement('div');
  el.className = 'dp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('datePick'));
  el.hidden = true;
  el.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav dp-prev"></button>
      <div class="dp-title" aria-live="polite"></div>
      <button type="button" class="dp-nav dp-next"></button>
    </div>
    <div class="dp-week" aria-hidden="true"></div>
    <div class="dp-grid" role="grid"></div>
    <div class="dp-foot"><span class="dp-hint"></span><button type="button" class="dp-today"></button></div>`;
  document.body.append(el);
  const $$ = (s) => el.querySelector(s);
  const prevBtn = $$('.dp-prev'), nextBtn = $$('.dp-next'), grid = $$('.dp-grid'), title = $$('.dp-title'), hint = $$('.dp-hint'), todayBtn = $$('.dp-today');
  prevBtn.append(icon('chevron', 'i i-sm')); prevBtn.title = t('monthPrev'); prevBtn.setAttribute('aria-label', prevBtn.title);
  nextBtn.append(icon('chevron', 'i i-sm')); nextBtn.title = t('monthNext'); nextBtn.setAttribute('aria-label', nextBtn.title);
  todayBtn.textContent = t('today');
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + ((i + weekStart) % 7));   // 2024-01-07 是周日
    $$('.dp-week').append(Object.assign(document.createElement('span'), { textContent: wdFmt.format(d) }));
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  let view = startOfDay(new Date()); view.setDate(1);
  let bounds = null, selected = null, focusDay = null, seq = 0;
  const cache = new Map();   // 'YYYY-M' → Map(dayStart → bool)

  const monthKey = (d) => d.getFullYear() + '-' + d.getMonth();
  const minMonth = () => { if (!bounds) return null; const d = new Date(bounds.min); return new Date(d.getFullYear(), d.getMonth(), 1); };
  const maxMonth = () => { const d = new Date(Math.max(Date.now(), bounds?.max || 0)); return new Date(d.getFullYear(), d.getMonth(), 1); };

  async function marksFor(month) {
    const key = monthKey(month);
    if (cache.has(key)) return cache.get(key);
    const days = [];
    const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= n; i++) {
      const a = new Date(month.getFullYear(), month.getMonth(), i), b = new Date(month.getFullYear(), month.getMonth(), i + 1);
      days.push([a.getTime(), b.getTime()]);
    }
    const res = await hasRecords(days);
    const m = new Map(days.map(([a], i) => [a, res[i]]));
    cache.set(key, m);
    return m;
  }

  function cells() {
    const first = new Date(view);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }

  async function render(dir = 0) {
    const id = ++seq;
    title.textContent = monthFmt.format(view);
    const lo = minMonth(), hi = maxMonth();
    prevBtn.disabled = !!lo && view <= lo;
    nextBtn.disabled = view >= hi;
    const today = startOfDay(new Date());
    grid.textContent = '';
    const list = cells();
    // 第六行整行都在下个月时收起，日历高度随月份变化，更紧凑
    const rows = list.slice(35).every((d) => d.getMonth() !== view.getMonth()) ? 5 : 6;
    grid.style.setProperty('--rows', rows);
    for (const d of list.slice(0, rows * 7)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dp-day';
      b.dataset.ts = String(d.getTime());
      b.textContent = String(d.getDate());
      b.tabIndex = -1;
      b.setAttribute('aria-label', dayFmt.format(d));
      if (d.getMonth() !== view.getMonth()) b.classList.add('out');
      if (sameDay(d, today)) b.classList.add('today');
      if (sameDay(d, selected)) b.classList.add('sel');
      if (d > today) b.classList.add('future');
      b.setAttribute('aria-disabled', 'true');
      grid.append(b);
    }
    if (dir) slideIn(grid, dir);
    hint.textContent = '';
    const marks = await marksFor(view);
    if (id !== seq) return;
    let count = 0;
    grid.querySelectorAll('.dp-day').forEach((b, i) => {
      const has = marks.get(+b.dataset.ts);
      if (has) { b.classList.add('has'); b.removeAttribute('aria-disabled'); b.style.setProperty('--i', i); count++; }
    });
    grid.classList.remove('marked'); void grid.offsetWidth; grid.classList.add('marked');
    hint.textContent = count ? tn('dateDays', count, [String(count)]) : t('dateNone');
    const want = grid.querySelector(`.dp-day[data-ts="${focusDay?.getTime()}"]`);
    const target = (want && !want.classList.contains('out') && want.classList.contains('has') ? want : null)
      || grid.querySelector('.dp-day.sel.has') || [...grid.querySelectorAll('.dp-day.has:not(.out)')].pop() || grid.querySelector('.dp-day:not(.out)');
    grid.querySelectorAll('.dp-day').forEach((b) => (b.tabIndex = b === target ? 0 : -1));
    if (!el.hidden && el.contains(document.activeElement) && document.activeElement.classList.contains('dp-day')) target?.focus();
  }

  function shift(months) {
    const lo = minMonth(), hi = maxMonth();
    const next = new Date(view.getFullYear(), view.getMonth() + months, 1);
    if ((lo && next < lo) || next > hi) return false;
    view = next;
    render(months > 0 ? 1 : -1);
    return true;
  }
  prevBtn.addEventListener('click', () => shift(-1));
  nextBtn.addEventListener('click', () => shift(1));
  todayBtn.addEventListener('click', () => {
    const now = startOfDay(new Date());
    const m = new Date(now.getFullYear(), now.getMonth(), 1);
    focusDay = now;
    if (+m !== +view) { const dir = m > view ? 1 : -1; view = m; render(dir); }
    else { const b = grid.querySelector(`.dp-day[data-ts="${now.getTime()}"]`); if (b?.classList.contains('has')) pick(b); else b?.focus(); }
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.dp-day');
    if (b && b.classList.contains('has')) pick(b);
  });

  function pick(b) {
    const d = new Date(+b.dataset.ts);
    selected = d;
    grid.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    if (b.classList.contains('out')) { view = new Date(d.getFullYear(), d.getMonth(), 1); }
    setTimeout(() => { close(); onPick(d.getTime()); }, reduceMotion.matches ? 0 : 140);
  }

  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const cur = document.activeElement?.closest?.('.dp-day');
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); shift(e.key === 'PageUp' ? -1 : 1); return; }
    if (!cur) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const d = new Date(+cur.dataset.ts); d.setDate(d.getDate() + step);
      focusDay = d;
      const b = grid.querySelector(`.dp-day[data-ts="${d.getTime()}"]:not(.out)`);
      if (b) { grid.querySelectorAll('.dp-day').forEach((x) => (x.tabIndex = -1)); b.tabIndex = 0; b.focus(); }
      else shift(step > 0 ? 1 : -1) || (focusDay = new Date(+cur.dataset.ts));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (cur.classList.contains('has')) pick(cur);
    }
  });

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const above = r.top - h - 8 >= 8 || r.bottom + h + 8 > vh;
    const left = Math.max(8, Math.min(vw - w - 8, r.right - w + 6));
    el.style.left = left + 'px';
    el.style.top = (above ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
    el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${above ? '100%' : '0'}`;
    el.classList.toggle('above', above);
  }

  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  async function open({ near } = {}) {
    if (!el.hidden) return;
    await onOpen?.();
    bounds = await getBounds();
    const base = near ? new Date(near) : (selected || new Date());
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    if (bounds) {
      const lo = minMonth(), hi = maxMonth();
      if (view < lo) view = lo; if (view > hi) view = hi;
    }
    focusDay = near ? startOfDay(new Date(near)) : null;
    el.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    anchor.classList.add('on');
    await render();
    place();
    if (!reduceMotion.matches) el.animate(
      [{ opacity: 0, transform: `scale(.94) translateY(${el.classList.contains('above') ? 6 : -6}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1.15)' }
    );
    (grid.querySelector('.dp-day[tabindex="0"]') || grid).focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function close(refocus = false) {
    if (el.hidden) return;
    document.removeEventListener('pointerdown', outside, true);
    anchor.setAttribute('aria-expanded', 'false');
    anchor.classList.remove('on');
    const done = () => { el.hidden = true; onClose?.(); };
    if (reduceMotion.matches) done();
    else el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: 140, easing: 'ease-in' }).finished.then(done);
    if (refocus) anchor.focus();
  }
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');
  return {
    open, close,
    toggle: (o) => (el.hidden ? open(o) : close()),
    get isOpen() { return !el.hidden; },
    invalidate() { cache.clear(); },
    select(ts) { selected = ts ? startOfDay(new Date(ts)) : null; }
  };
}
