/* 线性图标系统
   规范：24 × 24 网格 · 2px 安全边距 · 1.6 描边 · 圆头圆角 · 光学居中
   用法：<svg class="i"><use href="#i-name"/></svg> */
(() => {
  const ICONS = {
    restore: '<path d="M4.25 12.25a7.75 7.75 0 1 0 2.27-5.48L4.25 9"/><path d="M4.25 4.75V9H8.5"/>',
    search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.4 15.4 4.35 4.35"/>',
    sliders: '<path d="M4.5 7.5h8M17.5 7.5h2M4.5 16.5h2M11.5 16.5h8"/><circle cx="15" cy="7.5" r="2.25"/><circle cx="9" cy="16.5" r="2.25"/>',
    close: '<path d="m7.25 7.25 9.5 9.5M16.75 7.25l-9.5 9.5"/>',
    trash: '<path d="M4.75 7h14.5"/><path d="M9.25 7V5.25c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1V7"/><path d="m6.5 7 .8 11.1a1.75 1.75 0 0 0 1.75 1.65h5.9a1.75 1.75 0 0 0 1.75-1.65L17.5 7"/>',
    background: '<rect x="3.75" y="8.25" width="12" height="12" rx="2.75"/><path d="M8.25 4.75h8.25a2.75 2.75 0 0 1 2.75 2.75v8.25"/>',
    check: '<path d="m5.5 12.5 4.25 4.25 8.75-9.5"/>',
    globe: '<circle cx="12" cy="12" r="8.25"/><path d="M3.75 12h16.5"/><path d="M12 3.75c2.2 2.25 3.3 5 3.3 8.25s-1.1 6-3.3 8.25c-2.2-2.25-3.3-5-3.3-8.25s1.1-6 3.3-8.25Z"/>',
    tabs: '<rect x="3.75" y="6.75" width="16.5" height="12.5" rx="3"/><path d="M3.75 10.25h16.5"/><path d="M7.5 6.75V5.5c0-.7.55-1.25 1.25-1.25h3c.7 0 1.25.55 1.25 1.25v1.25"/>',
    sun: '<circle cx="12" cy="12" r="3.75"/><path d="M12 3.5v1.5M12 19v1.5M3.5 12H5M19 12h1.5M5.99 5.99l1.06 1.06M16.95 16.95l1.06 1.06M5.99 18.01l1.06-1.06M16.95 7.05l1.06-1.06"/>',
    moon: '<path d="M19.25 14.6A7.75 7.75 0 0 1 9.4 4.75a7.75 7.75 0 1 0 9.85 9.85Z"/>',
    auto: '<circle cx="12" cy="12" r="8.25"/><path d="M12 3.75v16.5a8.25 8.25 0 0 0 0-16.5Z" fill="currentColor" stroke="none"/>',
    keyboard: '<rect x="3" y="6.25" width="18" height="11.5" rx="2.75"/><path d="M7 10h.01M10.33 10h.01M13.67 10h.01M17 10h.01M8.5 14h7"/>',
    clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 1.75"/>',
    stack: '<path d="m12 4.25 8.25 4.25L12 12.75 3.75 8.5 12 4.25Z"/><path d="m3.75 12.25 8.25 4.25 8.25-4.25"/><path d="m3.75 16 8.25 4.25L20.25 16"/>',
    shield: '<path d="M12 3.75 5.25 6.5v5.25c0 4.1 2.85 7.3 6.75 8.5 3.9-1.2 6.75-4.4 6.75-8.5V6.5L12 3.75Z"/><path d="m9.25 12 2 2 3.5-3.75"/>',
    chevron: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
    pages: '<rect x="4.75" y="3.75" width="14.5" height="16.5" rx="3"/><path d="M8.5 8.75h7M8.5 12h7M8.5 15.25h4"/>',
    chips: '<rect x="3.75" y="5.25" width="11" height="5.5" rx="2.75"/><rect x="9.25" y="13.25" width="11" height="5.5" rx="2.75"/>',
    external: '<path d="M13.75 4.75h5.5v5.5"/><path d="m19.25 4.75-8 8"/><path d="M17.25 13.5v4a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 4.75 17.5v-9A1.75 1.75 0 0 1 6.5 6.75h4"/>',
    window: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3"/><path d="M3.75 9h16.5"/><path d="M7 6.9h.01M9.25 6.9h.01"/>',
    history: '<path d="M4.25 12a7.75 7.75 0 1 0 2.4-5.6"/><path d="M4.25 4.75v3.5h3.5"/><path d="M12 8v4.25l2.75 1.75"/>',
    eyeOff: '<path d="M3.75 3.75l16.5 16.5"/><path d="M10.1 5.4A9.6 9.6 0 0 1 12 5.25c4.6 0 7.6 4.15 8.25 6.75-.25 1-.9 2.3-1.9 3.5M6.6 6.65C4.9 7.9 4 9.75 3.75 12c.65 2.6 3.65 6.75 8.25 6.75 1.6 0 3-.5 4.2-1.2"/><path d="M9.9 9.95a3 3 0 0 0 4.15 4.15"/>',
    calendar: '<rect x="4" y="5.25" width="16" height="15" rx="3"/><path d="M4 9.75h16M8.25 3.5v3.25M15.75 3.5v3.25"/><path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 16.75h.01M12 16.75h.01" stroke-width="2.2"/>',
    play: '<path d="M8.75 6.4v11.2c0 .62.68 1 1.21.68l8.9-5.6a.8.8 0 0 0 0-1.36l-8.9-5.6a.8.8 0 0 0-1.21.68Z"/>',
    checkbox: '<rect x="4.25" y="4.25" width="15.5" height="15.5" rx="4.25"/>',
    checked: '<rect x="4.25" y="4.25" width="15.5" height="15.5" rx="4.25" fill="currentColor"/><path d="m8.5 12.25 2.5 2.5 4.75-5.25" stroke="#fff" stroke-width="1.9"/>',
    more: '<circle cx="6.5" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="17.5" cy="12" r=".9" fill="currentColor"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    arrowRight: '<path d="M5 12h13.5"/><path d="m13 6.5 5.5 5.5-5.5 5.5"/>',
    sidebar: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3"/><path d="M14.5 4.75v14.5"/>',
    database: '<ellipse cx="12" cy="6.5" rx="7.25" ry="2.75"/><path d="M4.75 6.5v11c0 1.5 3.25 2.75 7.25 2.75s7.25-1.25 7.25-2.75v-11"/><path d="M4.75 12c0 1.5 3.25 2.75 7.25 2.75S19.25 13.5 19.25 12"/>',
    gesture: '<path d="M5.75 6.5h12.5L5.75 17.5h12.5"/><path d="m15.5 14.75 2.75 2.75-2.75 2.75"/>',
    route: '<circle cx="6" cy="17.75" r="2"/><path d="M8 17.75h6.25a3.25 3.25 0 0 0 0-6.5h-4.5a3.25 3.25 0 0 1 0-6.5H18"/><path d="m15.75 2.5 2.25 2.25-2.25 2.25"/>',
    cursor: '<path d="M6 4.25 18.25 10l-5.5 1.75-1.75 5.5L6 4.25Z"/><path d="m13 13 4.75 4.75"/>',
    sparkle: '<path d="M12 4.25c.5 3.9 1.85 5.25 5.75 5.75-3.9.5-5.25 1.85-5.75 5.75-.5-3.9-1.85-5.25-5.75-5.75 3.9-.5 5.25-1.85 5.75-5.75Z"/><path d="M18.25 15.5c.2 1.5.75 2.05 2.25 2.25-1.5.2-2.05.75-2.25 2.25-.2-1.5-.75-2.05-2.25-2.25 1.5-.2 2.05-.75 2.25-2.25Z"/>',
    hand: '<path d="M8.25 12.25V6.5a1.5 1.5 0 0 1 3 0v4.75M11.25 10.75V5a1.5 1.5 0 0 1 3 0v5.75M14.25 10.75V6.75a1.5 1.5 0 0 1 3 0v6.5c0 3.85-2.65 6.5-6.25 6.5-2.4 0-3.7-1.05-5.2-3.2l-1.6-2.3a1.45 1.45 0 0 1 2.3-1.75l1.75 1.75"/>',
    pin: '<path d="M9.5 4.25h5l-.75 5 3 3v1.5h-11v-1.5l3-3-.75-5Z"/><path d="M12 13.75v6"/>'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  // 用 DOMParser 解析静态图标表（不经 innerHTML，便于商店审核）
  const markup = `<svg xmlns="http://www.w3.org/2000/svg">${Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`).join('')}</svg>`;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  svg.append(...[...parsed.childNodes].map((n) => document.importNode(n, true)));
  (document.body || document.documentElement).prepend(svg);
})();
