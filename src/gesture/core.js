/* TabAgain · 鼠标手势核心
   识别器 + 轨迹与提示胶囊（网页内容脚本与设置页「试一试」共用同一份代码）
   - 不读取、不修改网页内容：只监听鼠标事件，绘制在独立的封闭 Shadow DOM 里
   - 普通脚本（非模块），挂在 globalThis.TabAgainGesture */
(() => {
  'use strict';
  if (globalThis.TabAgainGesture?.version === 2) return;

  /* =========================================================================
     一、识别器
     思路：点列 → 去抖 → Douglas–Peucker 折线化 → 吸收过短的笔画与收尾小钩
          → 8 方向分类 → 按「横 / 斜下」分组 → 逐个 Z 做几何校验
     宽容：斜线画成直角（→↓←→）、横线略有倾斜、收尾带钩都算；
     不模糊：尺寸、横线长度、上下位置、斜线方向都要满足，随手一划不会触发。
     ========================================================================= */
  const DIRS = ['R', 'DR', 'D', 'DL', 'L', 'UL', 'U', 'UR'];   // 屏幕坐标，y 向下
  const dirOf = (dx, dy) => DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  const PRESETS = {
    z:  { strokes: 3 },
    ul: { strokes: 2, a: 'U', b: 'L' },
    dr: { strokes: 2, a: 'D', b: 'R' },
    lu: { strokes: 2, a: 'L', b: 'U' },          // ←↑：crxMouse 等手势扩展的默认写法
    rl: { strokes: 2, a: 'R', b: 'L', back: true } // →←：折返，两笔叠在同一条线上
  };

  function clean(points) {
    const out = [];
    for (const p of points) if (!out.length || dist(out[out.length - 1], p) >= 2) out.push(p);
    return out;
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const a = pts[s], b = pts[e];
      const len = dist(a, b) || 1e-6;
      let max = 0, at = -1;
      for (let i = s + 1; i < e; i++) {
        const p = pts[i];
        // 到线段（而非直线）的距离：折返笔画（→←）的拐点在首尾连线之外，必须保留
        const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
        const d = t < 0 ? dist(a, p) : t > 1 ? dist(b, p)
          : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
        if (d > max) { max = d; at = i; }
      }
      if (max > eps && at > -1) { keep[at] = 1; stack.push([s, at], [at, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  function segsOf(v) {
    const out = [];
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i], b = v[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      out.push({ a, b, dx, dy, len: Math.hypot(dx, dy), ang: Math.atan2(dy, dx), dir: dirOf(dx, dy) });
    }
    return out;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  /** 折线化：返回有方向的笔画列表 */
  function strokesOf(points) {
    const pts = clean(points);
    if (pts.length < 2) return { segs: [], box: bbox(pts.length ? pts : [{ x: 0, y: 0 }]), length: 0 };
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
    const box = bbox(pts);
    const eps = Math.min(22, Math.max(5, Math.max(box.w, box.h) * 0.1));
    let v = rdp(pts, eps);

    // 吸收过短的笔画（拐角处的圆弧、抖动）
    const tiny = Math.max(8, length * 0.07);
    for (let guard = 0; guard < 64 && v.length > 2; guard++) {
      const s = segsOf(v);
      let at = -1, min = tiny;
      s.forEach((g, i) => { if (g.len < min) { min = g.len; at = i; } });
      if (at < 0) break;
      if (at === 0) v.splice(1, 1);                                      // 起笔小段：并入下一段
      else if (at === s.length - 1) v.splice(v.length - 2, 1);           // 收笔小段：并入上一段
      else v.splice(at, 2, { x: (v[at].x + v[at + 1].x) / 2, y: (v[at].y + v[at + 1].y) / 2 });
    }
    // 同向或几乎共线的相邻笔画合并
    for (let guard = 0; guard < 64; guard++) {
      const s = segsOf(v);
      let merged = false;
      for (let i = 0; i < s.length - 1; i++) {
        let d = Math.abs(s[i].ang - s[i + 1].ang);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (s[i].dir === s[i + 1].dir || d < 0.35) { v.splice(i + 1, 1); merged = true; break; }
      }
      if (!merged) break;
    }
    let segs = segsOf(v);
    // 收尾 / 起笔的小钩
    while (segs.length > 1 && segs[segs.length - 1].len < length * 0.12) segs.pop();
    while (segs.length > 1 && segs[0].len < length * 0.12) segs.shift();
    return { segs, box, length };
  }

  const H = new Set(['R', 'UR', 'DR']);     // Z 的横：允许略有倾斜
  const M = new Set(['D', 'DL', 'L']);      // Z 的斜：允许画成直角
  function groupsOf(segs, classOf) {
    const out = [];
    for (const s of segs) {
      const c = classOf(s.dir);
      const last = out[out.length - 1];
      if (last && last.c === c) { last.segs.push(s); last.dx += s.dx; last.dy += s.dy; last.len += s.len; }
      else out.push({ c, segs: [s], dx: s.dx, dy: s.dy, len: s.len });
    }
    for (const g of out) {
      g.a = g.segs[0].a; g.b = g.segs[g.segs.length - 1].b;
      g.my = g.segs.reduce((n, s) => n + (s.a.y + s.b.y) / 2 * s.len, 0) / (g.len || 1);
    }
    return out;
  }
  const zClass = (d) => (H.has(d) ? 'h' : M.has(d) ? 'm' : 'x');

  function matchZ(st, live) {
    const { segs, box } = st;
    const res = { status: 'none', strokes: 0, count: 0, reason: '' };
    if (!segs.length) return res;
    const g = groupsOf(segs, zClass);
    // 实时进度：横 → 斜 → 横 → 斜 → 横 …
    const minH = 22, minM = 18;
    let strokes = 0, count = 0;
    for (let i = 0; i < g.length; i++) {
      const want = i % 2 === 0 ? 'h' : 'm';
      if (g[i].c !== want) break;
      if (want === 'h' ? g[i].dx < minH : g[i].dy < minM) break;
      if (i === 0) strokes = 1;
      else if (want === 'm') strokes = 2;
      else { strokes = 3; count++; }
    }
    res.strokes = strokes;
    res.count = count;
    if (live && strokes < 3) { res.status = strokes ? 'partial' : 'none'; return res; }

    // 完整校验
    const bad = (reason) => Object.assign(res, { status: live ? 'partial' : 'none', reason, count: live ? res.count : 0 });
    if (g.some((x) => x.c === 'x')) return bad(g[0].c !== 'h' ? 'first' : 'shape');
    if (g[0].c !== 'h') return bad('first');
    if (g.length < 3) return bad(box.w < 56 || box.h < 34 ? 'small' : g.length === 1 ? 'shape' : 'last');
    if (g.length % 2 === 0) return bad('last');
    const k = (g.length - 1) / 2;
    for (let i = 0; i < k; i++) {
      const top = g[i * 2], mid = g[i * 2 + 1], bot = g[i * 2 + 2];
      const zb = bbox([top.a, top.b, mid.a, mid.b, bot.a, bot.b]);
      const minW = k > 1 ? 40 : 56, minHt = k > 1 ? 28 : 34;
      if (zb.w < minW || zb.h < minHt) return bad('small');
      const flat = (h) => Math.abs(h.dy) <= h.dx * 0.65 && h.segs.reduce((n, x) => n + (x.dir === 'R' ? 0 : x.len), 0) <= h.len * 0.5;
      if (top.dx < zb.w * 0.4 || !flat(top)) return bad('first');
      if (!flat(bot)) return bad('last');
      if (bot.dx < zb.w * 0.4) return bad('last');
      if (mid.dx > -Math.max(12, zb.w * 0.15) || mid.dy < Math.max(24, zb.h * 0.4)) return bad('diagonal');
      if (bot.my - top.my < zb.h * 0.45) return bad('diagonal');
    }
    return Object.assign(res, { status: 'match', count: k, strokes: 3, reason: '' });
  }

  function matchArrow(st, preset, live) {
    const P = PRESETS[preset];
    const { segs, length } = st;
    const res = { status: 'none', strokes: 0, count: 0, reason: '' };
    const s = segs.filter((x) => x.len >= Math.max(16, length * 0.12));
    if (!s.length) return res;
    if (s[0].dir === P.a && s[0].len >= 24) res.strokes = 1;
    if (res.strokes && s[1]?.dir === P.b && s[1].len >= 24) res.strokes = 2;
    let ok = s.length === 2 && res.strokes === 2 && s[0].len >= 30 && s[1].len >= 30 &&
      s[0].len >= length * 0.22 && s[1].len >= length * 0.22;
    // 折返：回来的一笔至少走回去一半，且两笔大致在同一条水平线上
    if (ok && P.back) ok = s[1].len >= s[0].len * 0.5 && Math.abs(s[1].b.y - s[0].a.y) <= Math.max(36, s[0].len * 0.45);
    if (ok) return Object.assign(res, { status: 'match', count: 1 });
    res.status = live && res.strokes ? 'partial' : 'none';
    res.reason = length < 60 ? 'small' : s[0].dir !== P.a ? 'first' : 'last';
    return res;
  }

  /** points: [{x, y}]；preset: z | ul | dr | lu | rl；live: 绘制中的实时判断 */
  function recognize(points, preset = 'z', live = false) {
    const st = strokesOf(points);
    return preset === 'z' ? matchZ(st, live) : matchArrow(st, preset in PRESETS ? preset : 'z', live);
  }

  /* =========================================================================
     二、站点首字母色块（与扩展页的规则一致）
     ========================================================================= */
  const SLD = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);
  function siteName(host = '') {
    if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':') || host === 'localhost') return host.replace(/^\[/, '');
    const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.').filter(Boolean);
    if (parts.length <= 1) return parts[0] || '';
    let i = parts.length - 2;
    if (i > 0 && SLD.has(parts[i]) && parts[i + 1].length === 2) i--;
    return parts[i];
  }
  function hueOf(name) {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    const hue = (h >>> 0) % 330;
    return hue < 50 ? hue : hue + 30;
  }
  function letterOf(host) {
    const n = siteName(host);
    if (!n) return '·';
    if (n.startsWith('xn--')) return '◆';
    const ch = [...n][0];
    return /[0-9]/.test(ch) ? ch : ch.toUpperCase();
  }

  /* =========================================================================
     三、轨迹与提示胶囊
     ========================================================================= */
  const SVG = 'http://www.w3.org/2000/svg';
  const GLYPHS = {
    z:  { s: ['M5.75 6.5h12.5', 'M18.25 6.5 5.75 17.5', 'M5.75 17.5h12.5'], len: [12.5, 16.7, 12.5] },
    ul: { s: ['M15.5 18.5V6.5', 'M15.5 6.5H5.5M9 3 5.5 6.5 9 10'], len: [12, 20] },
    dr: { s: ['M8.5 5.5v12', 'M8.5 17.5h10M15 14l3.5 3.5L15 21'], len: [12, 20] },
    lu: { s: ['M18.5 17.5h-12', 'M6.5 17.5v-11M3 10l3.5-3.5L10 10'], len: [12, 21] },
    rl: { s: ['M5 8.5h11.5', 'M16.5 8.5a3.5 3.5 0 0 1 0 7H5.5M9 12l-3.5 3.5L9 19'], len: [11.5, 33] }
  };
  const BLUE = [61, 139, 255], PURPLE = [123, 92, 255];
  const mix = (t) => `rgb(${BLUE.map((c, i) => Math.round(c + (PURPLE[i] - c) * t)).join(',')})`;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.stage { position: absolute; inset: 0; overflow: hidden; pointer-events: none;
  font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "PingFang TC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft JhengHei UI", "Noto Sans SC", "Noto Sans TC", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; letter-spacing: -0.005em;
  --bg: rgba(252, 252, 254, .78); --edge: rgba(255, 255, 255, .9); --line: rgba(16, 22, 36, .1);
  --fg: #10131a; --fg2: rgba(16, 19, 26, .58); --dim: rgba(16, 19, 26, .2); --fail: #ff3b30;
  --shadow: 0 1px 2px rgba(16, 22, 36, .06), 0 10px 30px -8px rgba(24, 36, 72, .28), 0 24px 60px -24px rgba(24, 36, 72, .3); }
.stage.dark { --bg: rgba(40, 42, 52, .74); --edge: rgba(255, 255, 255, .1); --line: rgba(255, 255, 255, .08);
  --fg: #f4f5f8; --fg2: rgba(236, 238, 244, .6); --dim: rgba(236, 238, 244, .22); --fail: #ff453a;
  --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -8px rgba(0, 0, 0, .55), 0 24px 60px -24px rgba(0, 0, 0, .6); }
canvas.trail { position: absolute; left: 0; top: 0; transition: opacity 260ms cubic-bezier(.32, .72, 0, 1), filter 260ms; }
canvas.trail.out { opacity: 0; }
canvas.trail.fail { opacity: 0; filter: grayscale(1); transition-duration: 420ms; }

.hud { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 0;
  height: 44px; padding: 6px; border-radius: 15px; max-width: 340px;
  background: var(--bg); color: var(--fg);
  -webkit-backdrop-filter: saturate(180%) blur(22px); backdrop-filter: saturate(180%) blur(22px);
  box-shadow: var(--shadow), inset 0 0 0 .5px var(--line), inset 0 .5px 0 var(--edge);
  opacity: 0; transform: translate3d(var(--x, 0), var(--y, 0), 0) scale(.86);
  transition: opacity 180ms cubic-bezier(.32, .72, 0, 1), scale 320ms, gap 320ms cubic-bezier(.32, .72, 0, 1);
  will-change: transform; }
.hud.show { opacity: 1; transform: translate3d(var(--x, 0), var(--y, 0), 0) scale(1); transition: opacity 160ms ease-out; }
.hud.pop { animation: pop 420ms cubic-bezier(.34, 1.56, .64, 1); }
.hud.shake { animation: shake 360ms cubic-bezier(.36, .07, .19, .97); }
.hud.leave { opacity: 0; transition: opacity 240ms cubic-bezier(.55, 0, .75, .25); }
@keyframes pop { 0% { scale: 1; } 35% { scale: 1.06; } 100% { scale: 1; } }
@keyframes shake { 0%, 100% { translate: 0; } 20% { translate: -6px; } 40% { translate: 5px; } 60% { translate: -3px; } 80% { translate: 2px; } }

.glyph { position: relative; width: 32px; height: 32px; flex: none; border-radius: 10px; display: grid; place-items: center;
  background: linear-gradient(135deg, rgba(61, 139, 255, .14), rgba(123, 92, 255, .14));
  box-shadow: inset 0 0 0 .5px rgba(92, 116, 255, .2); }
.glyph svg { width: 22px; height: 22px; overflow: visible; }
.glyph path { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.glyph .base { stroke: var(--dim); transition: opacity 200ms; }
.glyph .lit { stroke: url(#tg-grad); stroke-dasharray: var(--l) var(--l); stroke-dashoffset: var(--l);
  transition: stroke-dashoffset 240ms cubic-bezier(.16, 1, .3, 1); }
.glyph .lit.on { stroke-dashoffset: 0; }
.glyph .ok { stroke: url(#tg-grad); stroke-width: 2.3; stroke-dasharray: 16 16; stroke-dashoffset: 16; opacity: 0; }
.hud.done .glyph .base, .hud.done .glyph .lit { opacity: 0; transition: opacity 120ms; }
.hud.done .glyph .ok { opacity: 1; stroke-dashoffset: 0; transition: stroke-dashoffset 320ms 60ms cubic-bezier(.16, 1, .3, 1); }
.hud.fail .glyph .lit { stroke: var(--fail); }
.hud.fail .glyph { background: color-mix(in srgb, var(--fail) 10%, transparent); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--fail) 22%, transparent); }

.body { display: grid; grid-template-rows: auto auto; min-width: 0; max-width: 0; overflow: hidden; opacity: 0;
  transition: max-width 360ms cubic-bezier(.32, .72, 0, 1), opacity 200ms, padding 360ms cubic-bezier(.32, .72, 0, 1); padding: 0; }
.hud.open .body { max-width: 280px; opacity: 1; padding: 0 8px 0 10px; }
.l1 { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; white-space: nowrap; }
.count { display: none; height: 17px; padding: 0 6px; border-radius: 999px; align-items: center;
  font: 650 11px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums;
  color: #fff; background: linear-gradient(135deg, #3D8BFF, #7B5CFF); }
.count.on { display: inline-flex; animation: pop 360ms cubic-bezier(.34, 1.56, .64, 1); }
.l2 { display: flex; align-items: center; gap: 6px; margin-top: 1px; font-size: 12px; color: var(--fg2); white-space: nowrap; min-width: 0; }
.l2:empty, .l2.hide { display: none; }
.fav { width: 14px; height: 14px; flex: none; border-radius: 3.5px; }
.mono { width: 14px; height: 14px; flex: none; border-radius: 4px; display: grid; place-items: center;
  font: 700 8.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: hsl(var(--h) 52% 36%); background: linear-gradient(135deg, hsl(var(--h) 78% 92%), hsl(calc(var(--h) + 22) 72% 85%)); }
.stage.dark .mono { color: hsl(var(--h) 85% 84%); background: linear-gradient(135deg, hsl(var(--h) 34% 32%), hsl(calc(var(--h) + 22) 38% 24%)); }
.win { width: 14px; height: 14px; flex: none; color: var(--fg2); }
.win path, .win rect { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.title { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
@media (prefers-reduced-motion: reduce) {
  .hud.pop, .hud.shake, .count.on { animation: none; }
}`;

  /**
   * 创建一层手势画布
   * container：放置画布的元素（网页里是全屏的宿主，设置页里是练习区）
   * opts.fixed：是否铺满视口；opts.dark()：是否深色；opts.trail()：是否画轨迹
   */
  function createOverlay(container, opts = {}) {
    const host = document.createElement(opts.tag || 'tabagain-gesture');
    const fixed = !!opts.fixed;
    const css = fixed
      ? 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;contain:strict;'
      : 'all:initial;position:absolute;inset:0;pointer-events:none;display:block;border-radius:inherit;overflow:hidden;';
    css.split(';').filter(Boolean).forEach((d) => { const i = d.indexOf(':'); host.style.setProperty(d.slice(0, i), d.slice(i + 1), 'important'); });
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const stage = document.createElement('div');
    stage.className = 'stage';
    const canvas = document.createElement('canvas');
    canvas.className = 'trail';
    const ctx = canvas.getContext('2d');

    // 胶囊
    const hud = document.createElement('div');
    hud.className = 'hud';
    const glyph = document.createElement('div');
    glyph.className = 'glyph';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const defs = document.createElementNS(SVG, 'defs');
    const grad = document.createElementNS(SVG, 'linearGradient');
    grad.id = 'tg-grad';
    [['x1', '0'], ['y1', '0'], ['x2', '24'], ['y2', '24']].forEach(([k, v]) => grad.setAttribute(k, v));
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    [['0', '#3D8BFF'], ['1', '#7B5CFF']].forEach(([o, c]) => {
      const st = document.createElementNS(SVG, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', c); grad.append(st);
    });
    defs.append(grad);
    svg.append(defs);
    const ok = document.createElementNS(SVG, 'path');
    ok.setAttribute('class', 'ok');
    ok.setAttribute('d', 'm6.25 12.5 3.75 3.75 7.75-8.5');
    const body = document.createElement('div');
    body.className = 'body';
    const l1 = document.createElement('div'); l1.className = 'l1';
    const act = document.createElement('span');
    const count = document.createElement('span'); count.className = 'count';
    l1.append(act, count);
    const l2 = document.createElement('div'); l2.className = 'l2';
    body.append(l1, l2);
    glyph.append(svg);
    hud.append(glyph, body);
    stage.append(canvas, hud);
    root.append(style, stage);

    let lit = [], preset = '';
    function setGlyph(p) {
      if (p === preset) return;
      preset = p;
      [...svg.querySelectorAll('path:not(.ok)')].forEach((n) => n.remove());
      const G = GLYPHS[p] || GLYPHS.z;
      const bases = G.s.map((d) => { const n = document.createElementNS(SVG, 'path'); n.setAttribute('d', d); n.setAttribute('class', 'base'); return n; });
      lit = G.s.map((d, i) => {
        const n = document.createElementNS(SVG, 'path');
        n.setAttribute('d', d); n.setAttribute('class', 'lit');
        n.style.setProperty('--l', String(G.len[i] + 1));
        return n;
      });
      svg.append(...bases, ...lit, ok);
    }

    let pts = [], W = 0, Ht = 0, dpr = 1, raf = 0, pos = null, target = null, attached = false, matched = false;
    function attach() {
      if (attached) return;
      (container || document.documentElement).append(host);
      attached = true;
    }
    function size() {
      const r = fixed ? { width: innerWidth, height: innerHeight } : host.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; Ht = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(Ht * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = Ht + 'px';
    }
    function origin() {
      if (fixed) return { x: 0, y: 0 };
      const r = host.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }

    function draw() {
      raf = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Ht);
      if (opts.trail?.() !== false && pts.length > 1) {
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
        const scale = Math.max(total, 300);
        const width = matched ? 4.25 : 3.5;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // 柔光底
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.strokeStyle = matched ? 'rgba(92,116,255,.26)' : 'rgba(92,116,255,.16)';
        ctx.lineWidth = width + 8;
        ctx.stroke();
        // 主线：沿长度由蓝到紫
        let s = 0, from = { x: pts[0].x, y: pts[0].y };
        const CH = 4;
        for (let i = 1; i < pts.length; i += CH) {
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          const end = Math.min(pts.length - 1, i + CH - 1);
          for (let j = i; j <= end; j++) {
            s += dist(pts[j - 1], pts[j]);
            if (j < pts.length - 1) {
              const m = { x: (pts[j].x + pts[j + 1].x) / 2, y: (pts[j].y + pts[j + 1].y) / 2 };
              ctx.quadraticCurveTo(pts[j].x, pts[j].y, m.x, m.y);
              from = m;
            } else { ctx.lineTo(pts[j].x, pts[j].y); from = pts[j]; }
          }
          ctx.strokeStyle = mix(Math.min(1, s / scale));
          ctx.lineWidth = width;
          ctx.stroke();
        }
        // 笔尖
        const tip = pts[pts.length - 1];
        const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 10);
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.35, mix(Math.min(1, s / scale))); g.addColorStop(1, 'rgba(123,92,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2); ctx.fill();
      }
      // 胶囊跟随：弹性插值
      if (target) {
        pos ||= { ...target };
        pos.x += (target.x - pos.x) * 0.28;
        pos.y += (target.y - pos.y) * 0.28;
        hud.style.setProperty('--x', pos.x.toFixed(1) + 'px');
        hud.style.setProperty('--y', pos.y.toFixed(1) + 'px');
        if (Math.abs(target.x - pos.x) > 0.3 || Math.abs(target.y - pos.y) > 0.3) schedule();
      }
    }
    const schedule = () => { raf ||= requestAnimationFrame(draw); };

    // 胶囊放在笔迹外侧，不遮住正在画的线：优先下方居中，其次上方、右侧、左侧
    function place() {
      if (!pts.length) return;
      const hw = hud.offsetWidth || 44, hh = hud.offsetHeight || 44, gap = 16, m = 8;
      const b = bbox(pts);
      const cx = (b.x0 + b.x1) / 2 - hw / 2, cy = (b.y0 + b.y1) / 2 - hh / 2;
      const cand = [
        [cx, b.y1 + gap], [cx, b.y0 - hh - gap],
        [b.x1 + gap, cy], [b.x0 - hw - gap, cy]
      ];
      const fits = ([x, y]) => x >= m && y >= m && x + hw <= W - m && y + hh <= Ht - m;
      const clampX = (x) => Math.max(m, Math.min(W - hw - m, x));
      const clampY = (y) => Math.max(m, Math.min(Ht - hh - m, y));
      // 上下两种只需竖直方向放得下，水平可以平移
      let pick = null;
      for (const [i, c] of cand.entries()) {
        const cc = i < 2 ? [clampX(c[0]), c[1]] : [c[0], clampY(c[1])];
        if (fits(cc)) { pick = cc; break; }
      }
      pick ||= [clampX(cand[0][0]), clampY(cand[0][1])];
      target = { x: pick[0], y: pick[1] };
    }

    // 胶囊展开 / 收起时宽度在变：动画期间逐帧重新定位，保持居中
    let settleUntil = 0;
    function settle() {
      const first = !settleUntil || performance.now() > settleUntil;
      settleUntil = performance.now() + 460;
      if (!first) return;
      const step = () => { place(); schedule(); if (performance.now() < settleUntil) requestAnimationFrame(step); else settleUntil = 0; };
      requestAnimationFrame(step);
    }

    let leaveTimer = 0, removeTimer = 0;
    const api = {
      host,
      /** 开始一笔：clientX/Y 为视口坐标 */
      begin(points, p) {
        clearTimeout(leaveTimer); clearTimeout(removeTimer);
        attach();
        stage.classList.toggle('dark', !!opts.dark?.());
        size();
        setGlyph(p || 'z');
        const o = origin();
        pts = points.map((q) => ({ x: q.x - o.x, y: q.y - o.y }));
        matched = false;
        canvas.className = 'trail';
        hud.className = 'hud';
        lit.forEach((n) => n.classList.remove('on'));
        act.textContent = ''; l2.textContent = ''; count.classList.remove('on');
        pos = null;
        place();
        requestAnimationFrame(() => hud.classList.add('show'));
        schedule();
      },
      add(points) {
        const o = origin();
        for (const q of points) pts.push({ x: q.x - o.x, y: q.y - o.y });
        place();
        schedule();
      },
      /** 实时状态：strokes 已点亮的笔画数；count 已完成的 Z 个数；info 即将回来的那一页 */
      progress({ strokes = 0, count: n = 0, match = false, label = '', info = null }) {
        lit.forEach((node, i) => node.classList.toggle('on', i < strokes));
        if (match !== matched) { matched = match; schedule(); }
        hud.classList.toggle('open', !!match);
        settle();
        if (match) {
          act.textContent = label;
          setCount(n);
          renderInfo(info);
        } else setCount(0);
      },
      setInfo(info) { if (matched) renderInfo(info); },
      /** 结束：state = done | fail | empty | cancel */
      end(state, { label = '', count: n = 0, info, detail = '' } = {}) {
        clearTimeout(leaveTimer);
        hud.classList.remove('pop', 'shake');
        if (state === 'cancel') { canvas.classList.add('out'); return api.leave(0); }
        if (state === 'done') {
          lit.forEach((node) => node.classList.add('on'));
          hud.classList.add('done', 'open');
          act.textContent = label; setCount(n);
          if (info !== undefined) renderInfo(info);
          void hud.offsetWidth; hud.classList.add('pop'); settle();
          canvas.classList.add('out');
          leaveTimer = setTimeout(() => api.leave(), 1050);
        } else {
          hud.classList.add('fail', 'open');
          act.textContent = label; setCount(0);
          l2.textContent = '';
          if (detail) { const sp = document.createElement('span'); sp.className = 'title'; sp.textContent = detail; l2.append(sp); }
          void hud.offsetWidth; hud.classList.add('shake'); settle();
          canvas.classList.add('fail');
          leaveTimer = setTimeout(() => api.leave(), detail ? 1500 : 900);
        }
      },
      leave(delay = 0) {
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => {
          hud.classList.add('leave');
          canvas.classList.add('out');
          removeTimer = setTimeout(() => { pts = []; target = null; if (opts.persist) { ctx.clearRect(0, 0, canvas.width, canvas.height); } else { host.remove(); attached = false; } }, 280);
        }, delay);
      },
      destroy() { clearTimeout(leaveTimer); clearTimeout(removeTimer); cancelAnimationFrame(raf); host.remove(); attached = false; }
    };

    function setCount(n) {
      if (n > 1) {
        const txt = '×' + n;
        if (count.textContent !== txt || !count.classList.contains('on')) {
          count.textContent = txt;
          count.classList.remove('on'); void count.offsetWidth; count.classList.add('on');
        }
      } else count.classList.remove('on');
    }
    function renderInfo(info) {
      l2.textContent = '';
      if (!info) return;
      if (info.kind === 'window') {
        const w = document.createElementNS(SVG, 'svg');
        w.setAttribute('viewBox', '0 0 24 24'); w.setAttribute('class', 'win');
        const r = document.createElementNS(SVG, 'rect');
        [['x', '3.75'], ['y', '4.75'], ['width', '16.5'], ['height', '14.5'], ['rx', '3']].forEach(([k, v]) => r.setAttribute(k, v));
        const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M3.75 9h16.5');
        w.append(r, p);
        l2.append(w);
      } else if (info.bitmap) {
        const c = document.createElement('canvas');
        c.className = 'fav'; c.width = 28; c.height = 28;
        c.getContext('2d').drawImage(info.bitmap, 0, 0, 28, 28);
        l2.append(c);
      } else {
        const m = document.createElement('span');
        m.className = 'mono';
        m.style.setProperty('--h', String(hueOf(siteName(info.host || '') || info.host || '?')));
        m.textContent = letterOf(info.host || '');
        l2.append(m);
      }
      const t = document.createElement('span');
      t.className = 'title';
      t.textContent = info.title || info.host || '';
      l2.append(t);
    }

    return api;
  }

  /* =========================================================================
     四、指针跟踪器：把一次「按下 → 拖动 → 松开」交给识别器与画布
     ========================================================================= */
  const START = 10;          // 移动超过 10px 才进入手势
  const PER_Z_MS = 2500;     // 每个 Z 的时限：慢慢拖动地图之类不会被当成手势

  function createTracker({ overlay, preset, shouldStart, onBegin, onLive, onEnd, target = window, signal }) {
    let g = null;
    const opt = { capture: true, signal };
    const bit = (b) => (b === 2 ? 2 : b === 1 ? 4 : 1);
    function pointsOf(e) {
      const list = e.getCoalescedEvents?.() || [];
      return (list.length ? list : [e]).map((c) => ({ x: c.clientX, y: c.clientY }));
    }
    let liveRaf = 0;
    function live() {
      liveRaf = 0;
      if (!g?.active) return;
      const r = recognize(g.pts, preset(), true);
      if (r.status === 'match' && performance.now() - g.t0 > PER_Z_MS * Math.max(1, r.count) + 300) r.status = 'partial';
      g.last = r;
      onLive?.(r, g);
    }
    target.addEventListener('pointerdown', (e) => {
      if (g || !e.isTrusted || e.pointerType !== 'mouse') return;
      if (!shouldStart(e)) return;
      g = { button: e.button, pts: [{ x: e.clientX, y: e.clientY }], active: false, t0: 0, alt: e.altKey && e.button === 0, startedAt: 0 };
    }, opt);
    target.addEventListener('pointermove', (e) => {
      if (!g) return;
      if (!(e.buttons & bit(g.button))) return finish(e, true);
      g.pts.push(...pointsOf(e));
      if (!g.active) {
        if (Math.hypot(e.clientX - g.pts[0].x, e.clientY - g.pts[0].y) < START) return;
        g.active = true; g.t0 = performance.now(); g.startedAt = Date.now();
        try { getSelection()?.removeAllRanges(); } catch {}
        overlay().begin(g.pts, preset());
        onBegin?.(g);
      } else overlay().add(pointsOf(e));
      liveRaf ||= requestAnimationFrame(live);
    }, opt);
    target.addEventListener('pointerup', (e) => { if (g && e.button === g.button) finish(e); }, opt);
    target.addEventListener('pointercancel', () => cancel(false), opt);
    target.addEventListener('keydown', (e) => { if (g?.active && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(true); } }, opt);
    // 手势进行中不选中文字、不拖动链接与图片
    const block = (e) => { if (g && (g.active || g.alt)) { e.preventDefault(); } };
    target.addEventListener('selectstart', block, opt);
    target.addEventListener('dragstart', block, opt);
    window.addEventListener('blur', () => cancel(false), { signal });

    function cancel(suppress) {
      if (!g) return;
      if (g.active) { overlay().end('cancel'); if (suppress) swallow(g); }
      g = null;
    }
    function finish(e, lost) {
      const cur = g; g = null;
      cancelAnimationFrame(liveRaf); liveRaf = 0;
      if (!cur || !cur.active) return;
      if (!lost) swallow(cur);
      const r = recognize(cur.pts, preset(), false);
      const ms = performance.now() - cur.t0;
      if (r.status === 'match' && ms > PER_Z_MS * Math.max(1, r.count) + 300) { r.status = 'none'; r.reason = 'slow'; }
      onEnd?.(r, cur);
    }
    // 吞掉手势之后的右键菜单（Windows 在松开右键时弹出）与 Alt+单击
    function swallow(cur) {
      const type = cur.button === 2 ? 'contextmenu' : 'click';
      const stop = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      window.addEventListener(type, stop, { capture: true, once: true });
      if (type === 'click') window.addEventListener('auxclick', stop, { capture: true, once: true });
      setTimeout(() => { window.removeEventListener(type, stop, true); window.removeEventListener('auxclick', stop, true); }, 600);
    }
    return { get active() { return !!g?.active; } };
  }

  /** 当前平台的触发方式：Windows 用右键；macOS 与 Linux 按下右键即弹菜单，改用 Alt / ⌥ + 左键 */
  function platform() {
    const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
    if (p.includes('win')) return 'win';
    if (p.includes('mac')) return 'mac';
    return 'linux';
  }

  globalThis.TabAgainGesture = { version: 2, recognize, strokesOf, createOverlay, createTracker, platform, siteName, hueOf, letterOf, GLYPHS };
})();
