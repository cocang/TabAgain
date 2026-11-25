/* =============================================================================
   行的构造与渲染 · 弹出页与历史页共用
   item: { type: 'h' 分组标题 | 'r' 标签 | 'w' 窗口 | 'c' 窗口内标签, rec, gkey, ... }
   ============================================================================= */
import { t, tn, num, icon, setFavicon, highlight, displayHost, groupOf, rowTime, kbd, fullTime } from './ui.js';

export const keyOf = (item) => (item.type === 'h' ? 'h:' + item.gkey : item.rec.id);

/** 把记录列表展开成带分组标题的条目（窗口展开时插入其中的标签） */
export function buildItems(recs, { now = Date.now(), expanded = new Map(), counts = false } = {}) {
  const items = [];
  let gkey = null, header = null;
  for (const rec of recs) {
    const g = groupOf(rec.closedAt, now);
    if (g.key !== gkey) {
      gkey = g.key;
      header = { type: 'h', gkey, label: g.label, count: 0, ts: rec.closedAt };
      items.push(header);
    }
    header.count++;
    if (rec.kind === 'window') {
      const kids = expanded.get(rec.id);
      items.push({ type: 'w', rec, gkey, open: !!kids });
      if (kids) kids.forEach((k, i) => items.push({ type: 'c', rec: k, gkey, last: i === kids.length - 1 }));
    } else {
      items.push({ type: 'r', rec, gkey });
    }
  }
  if (!counts) items.forEach((it) => it.type === 'h' && delete it.count);
  return items;
}

export function createItem(type, { selectable = false } = {}) {
  if (type === 'h') {
    const el = document.createElement('div');
    el.className = 'section-label';
    el.innerHTML = '<span class="label"></span><span class="n"></span>';
    return el;
  }
  const el = document.createElement('div');
  el.className = 'row' + (type === 'c' ? ' child' : '') + (type === 'w' ? ' window' : '');
  el.setAttribute('role', 'option');
  el.dataset.tip = '';
  // 静态模板：用 DOMParser 生成节点（不经 innerHTML）
  const doc = new DOMParser().parseFromString(`
    ${selectable ? '<button class="check" tabindex="-1" aria-label="' + t('select') + '"><svg class="i off"><use href="#i-checkbox"/></svg><svg class="i on"><use href="#i-checked"/></svg></button>' : ''}
    <span class="fav${type === 'w' ? ' stack' : ''}"></span>
    <span class="text"><span class="title"></span><span class="meta"></span></span>
    ${type === 'w' ? '<button class="expand" tabindex="-1"><svg class="i"><use href="#i-chevron"/></svg></button>' : ''}
    <span class="trail"><span class="kbd latest-kbd"></span><span class="actions">
      <button class="act" data-act="bg" tabindex="-1"><svg class="i i-sm"><use href="#i-background"/></svg></button>
      <button class="act" data-act="remove" tabindex="-1"><svg class="i i-sm"><use href="#i-close"/></svg></button>
    </span></span>`, 'text/html');
  el.append(...doc.body.childNodes);
  el.querySelector('[data-act="bg"]').title = t('openInBackground');
  el.querySelector('[data-act="remove"]').title = t('remove');
  const ex = el.querySelector('.expand');
  if (ex) ex.title = t('expand');
  return el;
}

/**
 * ctx: { now, terms, fullSids:Set, latestId, shortcut:[], selected:Set, showWindowTag }
 */
export function renderItem(el, item, ctx) {
  if (item.type === 'h') {
    el.querySelector('.label').textContent = item.label;
    el.querySelector('.n').textContent = item.count ? num(item.count) : '';
    ctx.decorateHeader?.(el, item);
    return;
  }
  const rec = item.rec;
  el.setAttribute('aria-selected', String(el.classList.contains('active')));
  el.classList.toggle('selected', !!ctx.selected?.has(rec.id));
  el.classList.toggle('open', !!item.open);
  el.classList.toggle('last', !!item.last);

  const fav = el.querySelector('.fav');
  const meta = el.querySelector('.meta');
  meta.textContent = '';
  const terms = ctx.terms || [];

  if (item.type === 'w') {
    // 窗口：叠放最多三个站点图标
    const hosts = rec.hosts || [];
    fav.textContent = '';
    const urls = rec.icons || hosts.map((h) => `https://${h}/`);
    for (const url of urls.slice(0, 4)) {
      const mini = document.createElement('span');
      mini.className = 'mini';
      fav.append(mini);
      setFavicon(mini, url, new URL(url).hostname.replace(/^www\./, ''));
    }
    el.querySelector('.title').textContent = tn('windowTitle', rec.count, [num(rec.count)]);
    const host = document.createElement('span');
    host.className = 'host';
    const more = (rec.hostCount || hosts.length) - Math.min(hosts.length, 2);
    host.textContent = hosts.slice(0, 2).join(t('listSeparator')) + (more > 0 ? ' ' + t('andMore', [String(more)]) : '');
    meta.append(host);
  } else {
    setFavicon(fav, rec.url, rec.host, rec.fav);
    highlight(el.querySelector('.title'), rec.title || rec.url, terms);
    const host = document.createElement('span');
    host.className = 'host';
    highlight(host, displayHost(rec.url), terms);
    meta.append(host);
  }

  if (item.type !== 'c') {
    meta.append(Object.assign(document.createElement('span'), { className: 'dot', textContent: '·' }));
    const time = document.createElement('span');
    time.className = 'time';
    // 搜索结果跨越多个分组时，分组标题仍在，行内只给时刻
    time.textContent = rowTime(rec.closedAt, ctx.now, item.gkey);
    meta.append(time);
  }
  if (isFull(rec, ctx)) {
    const mark = document.createElement('span');
    mark.className = 'full-mark';
    mark.append(icon('history'));
    meta.append(mark);
  }
  if ((rec.windowClosing || (ctx.showWindowTag && rec.lvl === 1)) && item.type !== 'c') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.append(icon('window'), t('windowTag'));
    meta.append(tag);
  }

  const latest = el.querySelector('.latest-kbd');
  latest.textContent = '';
  if (ctx.latestId === rec.id && ctx.shortcut?.length) latest.append(...kbd(ctx.shortcut).childNodes);
}

export const isFull = (rec, ctx) => !!(rec.sid && ctx.fullSids?.has(rec.sid) && !rec.partial && rec.lvl === 0);

/** 提示卡内容 */
export function tipInfo(item, ctx) {
  if (!item || item.type === 'h') return null;
  const rec = item.rec;
  const meta = [{ icon: 'clock', text: fullTime(rec.closedAt) }];
  if (rec.kind === 'window') {
    meta.push({ icon: 'window', text: tn('windowTitle', rec.count, [num(rec.count)]) });
  }
  if (item.type !== 'c') {
    meta.push(isFull(rec, ctx)
      ? { icon: 'history', text: t('tipFull'), accent: true }
      : { icon: 'globe', text: t('tipUrlOnly') });
  }
  return rec.kind === 'window'
    ? { title: (rec.hosts || []).join('、'), url: '', meta }
    : { title: rec.title || rec.url, url: rec.url, meta };
}
