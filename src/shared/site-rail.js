/* TabAgain · 网站筛选栏（弹出窗口与历史页共用）

   规则
   - 栏内最多显示 limit 个网站（按记录数排序），其余收进末尾的「所有网站」面板，面板可搜索
   - 从面板选中的网站若不在栏内，临时放在最前面，取消选中后移除
   - 横向滚动：触控板 / Shift+滚轮原生滚动；普通滚轮的竖向滚动转为横向；鼠标可按住拖动（带惯性）
   - 有更多内容的一侧才出现渐隐与圆形箭头；点按箭头翻过大半屏
   - 选中态是一块在气泡之间滑动的胶囊，而不是每个气泡各自变色
   - 键盘：← → 在气泡间移动，Home / End 到两端，Enter / 空格 选中或取消 */
import { t, num, setFavicon, reduceMotion } from './ui.js';

const svgUse = (name, cls = 'i') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const pretty = (h) => h.replace(/^www\./, '');

export function createSiteRail(nav, { limit = 20, shortName = pretty, onSelect }) {
  nav.textContent = '';
  nav.classList.add('rail');
  const track = el('div', 'chips-track');
  track.setAttribute('role', 'toolbar');
  track.setAttribute('aria-label', t('sitesLabel'));
  const glider = el('span', 'chip-glider');
  glider.setAttribute('aria-hidden', 'true');
  const prev = el('button', 'rail-arrow prev'), next = el('button', 'rail-arrow next');
  for (const [b, dir] of [[prev, -1], [next, 1]]) {
    b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true');
    b.append(svgUse('chevron', 'i i-sm'));
    b.addEventListener('click', () => page(dir));
  }
  nav.append(prev, track, next);

  let hosts = [], selected = '', chips = [], panel = null;

  /* ---------- 渲染 ---------- */
  function chipFor(h, extra = '') {
    const b = el('button', 'chip' + extra);
    b.type = 'button';
    b.dataset.host = h.host;
    b.title = `${h.host} · ${num(h.count)}`;
    const fav = el('span', 'fav');
    setFavicon(fav, h.url || `https://${h.host}/`, h.host);
    b.append(fav, el('span', 'name', shortName(h.host)), el('span', 'n', num(h.count)));
    return b;
  }

  function render() {
    track.textContent = '';
    track.append(glider);
    const top = hosts.slice(0, limit);
    const pinned = selected && !top.some((h) => h.host === selected) ? hosts.find((h) => h.host === selected) : null;
    if (pinned) {
      track.append(chipFor(pinned, ' pinned'));
      track.append(el('span', 'chip-sep'));
    }
    for (const h of top) track.append(chipFor(h));
    if (hosts.length > limit) {
      const more = el('button', 'chip chip-more');
      more.type = 'button';
      more.setAttribute('aria-haspopup', 'dialog');
      more.append(svgUse('chips', 'i i-sm'), el('span', 'name', t('sitesAll')), el('span', 'n', num(hosts.length)));
      more.addEventListener('click', (e) => { e.stopPropagation(); if (!dragMoved) openPanel(more); });
      track.append(more);
    }
    chips = [...track.querySelectorAll('.chip')];
    roving(chips.find((c) => c.dataset.host === selected) || chips[0]);
    syncPressed(false);
    requestAnimationFrame(edges);
  }

  function syncPressed(animate = true) {
    let on = null;
    for (const c of chips) {
      if (!c.dataset.host) continue;
      const p = c.dataset.host === selected;
      c.setAttribute('aria-pressed', String(p));
      if (p) on = c;
    }
    moveGlider(on, animate);
    return on;
  }

  function moveGlider(chip, animate) {
    if (!animate || reduceMotion.matches) glider.style.transition = 'none';
    if (chip) {
      glider.style.width = chip.offsetWidth + 'px';
      glider.style.transform = `translateX(${chip.offsetLeft}px)`;
      glider.classList.add('on');
    } else glider.classList.remove('on');
    if (!animate || reduceMotion.matches) { void glider.offsetWidth; glider.style.transition = ''; }
  }

  function reveal(chip, smooth = true) {
    if (!chip) return;
    const pad = 36;
    const l = chip.offsetLeft, r = l + chip.offsetWidth;
    let to = track.scrollLeft;
    if (l - pad < track.scrollLeft) to = l - pad;
    else if (r + pad > track.scrollLeft + track.clientWidth) to = r + pad - track.clientWidth;
    if (to !== track.scrollLeft) track.scrollTo({ left: to, behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto' });
  }

  function choose(host, { notify = true } = {}) {
    const wasPinned = !!track.querySelector('.chip.pinned');
    selected = host === selected ? '' : host;
    const needsPin = selected && !hosts.slice(0, limit).some((h) => h.host === selected);
    if (wasPinned || needsPin) {
      render();
      if (needsPin) track.scrollTo({ left: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    } else {
      const on = syncPressed(true);
      if (on) reveal(on);
    }
    if (notify) onSelect?.(selected);
  }

  /* ---------- 渐隐与箭头 ---------- */
  function edges() {
    const max = track.scrollWidth - track.clientWidth;
    const l = track.scrollLeft > 2, r = track.scrollLeft < max - 2;
    nav.classList.toggle('more-left', l);
    nav.classList.toggle('more-right', r);
  }
  track.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(() => { edges(); syncPressed(false); }).observe(track);

  function page(dir) {
    stopGlide();
    const by = Math.max(120, track.clientWidth * 0.72) * dir;
    track.scrollBy({ left: by, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  /* ---------- 滚轮：竖向转横向 ---------- */
  track.addEventListener('wheel', (e) => {
    if (track.scrollWidth <= track.clientWidth + 1) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.ctrlKey) return;   // 触控板横扫、缩放交给浏览器
    e.preventDefault();
    stopGlide();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? track.clientWidth : 1;
    track.scrollLeft += e.deltaY * unit;
  }, { passive: false });

  /* ---------- 鼠标拖动（带惯性） ---------- */
  let drag = null, dragMoved = false, glideRaf = 0;
  const stopGlide = () => { cancelAnimationFrame(glideRaf); glideRaf = 0; };
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (track.scrollWidth <= track.clientWidth + 1) return;
    stopGlide();
    dragMoved = false;
    drag = { id: e.pointerId, x: e.clientX, left: track.scrollLeft, samples: [{ x: e.clientX, t: e.timeStamp }] };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!dragMoved) {
      if (Math.abs(dx) < 5) return;
      dragMoved = true;
      track.setPointerCapture(e.pointerId);
      nav.classList.add('dragging');
    }
    track.scrollLeft = drag.left - dx;
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = drag.samples, moved = dragMoved;
    drag = null;
    nav.classList.remove('dragging');
    if (!moved) return;
    // 松手后的惯性：按最后几帧的速度减速滑行
    const a = s[0], b = s[s.length - 1];
    let v = b.t > a.t ? -(b.x - a.x) / (b.t - a.t) : 0;    // px/ms
    if (reduceMotion.matches || Math.abs(v) < 0.15) return;
    v = Math.max(-4, Math.min(4, v));
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      track.scrollLeft += v * dt;
      v *= Math.pow(0.94, dt / 16);
      const max = track.scrollWidth - track.clientWidth;
      if (Math.abs(v) < 0.02 || track.scrollLeft <= 0 || track.scrollLeft >= max) { glideRaf = 0; return; }
      glideRaf = requestAnimationFrame(step);
    };
    glideRaf = requestAnimationFrame(step);
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  // 拖动结束时的那次点按不算选中
  track.addEventListener('click', (e) => {
    if (dragMoved) { e.stopPropagation(); e.preventDefault(); dragMoved = false; return; }
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.host) return;
    roving(chip);
    choose(chip.dataset.host);
  }, true);
  track.addEventListener('dragstart', (e) => e.preventDefault());

  /* ---------- 键盘 ---------- */
  function roving(chip) {
    for (const c of chips) c.tabIndex = c === chip ? 0 : -1;
  }
  track.addEventListener('keydown', (e) => {
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight') j = Math.min(chips.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = chips.length - 1;
    else return;
    e.preventDefault(); e.stopPropagation();
    roving(chips[j]);
    chips[j].focus({ preventScroll: true });
    reveal(chips[j]);
  });

  /* ---------- 所有网站面板 ---------- */
  function openPanel(anchor) {
    if (panel) return closePanel();
    const box = el('div', 'site-panel');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', t('sitesAll'));
    const head = el('div', 'sp-head');
    head.append(el('b', '', t('sitesAll')), el('span', 'sp-count', t('sitesCount', [num(hosts.length)])));
    const field = el('label', 'sp-search');
    const input = el('input');
    input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off';
    input.placeholder = t('sitesSearch');
    field.append(svgUse('search', 'i i-sm'), input);
    const list = el('div', 'sp-list');
    list.setAttribute('role', 'listbox');
    const empty = el('p', 'sp-empty', t('sitesNone'));
    box.append(head, field, list, empty);
    document.body.append(box);

    let rows = [], active = 0;
    const MAX_ROWS = 300;
    function fill() {
      const q = input.value.trim().toLowerCase();
      const found = q ? hosts.filter((h) => h.host.toLowerCase().includes(q)) : hosts;
      list.textContent = '';
      rows = found.slice(0, MAX_ROWS).map((h) => {
        const r = el('button', 'sp-row');
        r.type = 'button';
        r.dataset.host = h.host;
        r.setAttribute('role', 'option');
        r.setAttribute('aria-selected', String(h.host === selected));
        r.tabIndex = -1;
        const fav = el('span', 'fav');
        setFavicon(fav, h.url || `https://${h.host}/`, h.host);
        const name = el('span', 'name');
        const host = pretty(h.host);
        const at = q ? host.toLowerCase().indexOf(q) : -1;
        if (at >= 0) name.append(host.slice(0, at), el('mark', '', host.slice(at, at + q.length)), host.slice(at + q.length));
        else name.textContent = host;
        const check = svgUse('check', 'i i-sm sp-check');
        r.append(fav, name, el('span', 'n', num(h.count)), check);
        return r;
      });
      list.append(...rows);
      if (found.length > MAX_ROWS) list.append(el('p', 'sp-more', t('sitesRefine', [num(found.length - MAX_ROWS)])));
      empty.hidden = found.length > 0;
      setActive(Math.max(0, rows.findIndex((r) => r.dataset.host === selected)), false);
    }
    function setActive(i, scroll = true) {
      rows[active]?.classList.remove('active');
      active = Math.max(0, Math.min(rows.length - 1, i));
      const r = rows[active];
      if (!r) return;
      r.classList.add('active');
      if (scroll) r.scrollIntoView({ block: 'nearest' });
    }
    function pick(host) { closePanel(); choose(host); }

    input.addEventListener('input', fill);
    list.addEventListener('click', (e) => { const r = e.target.closest('.sp-row'); if (r) pick(r.dataset.host); });
    list.addEventListener('pointermove', (e) => { const r = e.target.closest('.sp-row'); if (r) setActive(rows.indexOf(r), false); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) pick(rows[active].dataset.host); }
      else if (e.key === 'Escape') { e.preventDefault(); closePanel(); anchor.focus({ preventScroll: true }); }
      e.stopPropagation();   // 面板里打字不触发页面快捷键
      return;
      e.stopPropagation();
    });

    // 位置：贴着「所有网站」气泡，放不下时向左对齐、向上展开
    const a = anchor.getBoundingClientRect();
    const w = Math.min(320, innerWidth - 16);
    box.style.width = w + 'px';
    const left = Math.max(8, Math.min(a.right - w, innerWidth - w - 8));
    const below = innerHeight - a.bottom - 12;
    const maxH = Math.max(200, Math.min(420, below > 260 ? below : a.top - 12));
    box.style.left = left + 'px';
    box.style.maxHeight = maxH + 'px';
    if (below > 260 || below >= a.top) box.style.top = a.bottom + 6 + 'px';
    else { box.style.bottom = innerHeight - a.top + 6 + 'px'; box.classList.add('up'); }
    box.style.transformOrigin = `${a.left + a.width / 2 - left}px ${box.classList.contains('up') ? '100%' : '0'}`;

    fill();
    anchor.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => box.classList.add('show'));
    input.focus({ preventScroll: true });

    const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closePanel(); };
    addEventListener('pointerdown', onDown, true);
    addEventListener('blur', closePanel);
    addEventListener('resize', closePanel);
    panel = {
      box,
      close() {
        removeEventListener('pointerdown', onDown, true);
        removeEventListener('blur', closePanel);
        removeEventListener('resize', closePanel);
        anchor.setAttribute('aria-expanded', 'false');
        box.classList.remove('show');
        box.classList.add('hide');
        setTimeout(() => box.remove(), 180);
      }
    };
  }
  function closePanel() { const p = panel; panel = null; p?.close(); }

  return {
    /** 全部网站（按记录数从多到少） */
    set(list) {
      hosts = list.filter((h) => h.host && h.count > 0);
      if (selected && !hosts.some((h) => h.host === selected)) selected = '';
      const left = track.scrollLeft;
      render();
      track.scrollLeft = left;
      return hosts.length;
    },
    /** 只更新选中态，不触发 onSelect */
    select(host = '') { if (host !== selected) choose(host, { notify: false }); },
    get selected() { return selected; },
    get count() { return hosts.length; },
    close: closePanel
  };
}
