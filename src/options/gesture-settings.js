/* TabAgain · 设置页「鼠标手势」
   开关：打开时才请求网站访问权限（必须在点按的同一时刻调用），关闭时交还
   练习区：与网页里完全相同的识别器、轨迹和提示胶囊，不需要任何权限 */
import { getSettings, setSetting, GESTURE_EXCLUDE_DEFAULTS, matchesSite } from '../shared/settings.js';

const G = globalThis.TabAgainGesture;
const $ = (s) => document.querySelector(s);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const ORIGINS = { origins: ['<all_urls>'] };
const PLATFORM = G.platform();
const SHAPE = { z: 'gestureShapeZ', ul: 'gestureShapeUl', dr: 'gestureShapeDr', lu: 'gestureShapeLu', rl: 'gestureShapeRl' };
const GUIDE = { z: ['M30 18h60L30 62h60', 30, 18], ul: ['M74 64V18H36', 74, 64], dr: ['M40 16v46h44', 40, 16],
  lu: ['M86 60H36V18', 86, 60], rl: ['M30 30h56a10 10 0 0 1 0 20H30', 30, 30] };

const sw = $('#gesture-switch');
// 通知引导页里的同一个开关
const announce = (on) => document.dispatchEvent(new CustomEvent('tabagain:gesture', { detail: { on } }));
const more = $('#gesture-more');
let preset = 'z';

function toast(text) {
  const el = $('#toast');
  $('#toast-text').textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function hint() {
  const key = PLATFORM === 'win' ? 'gestureHintWin' : PLATFORM === 'mac' ? 'gestureHintMac' : 'gestureHintLinux';
  $('#gesture-hint').textContent = t(key, [t(SHAPE[preset])]);
  $('#pad-hint').textContent = t('gesturePadHint', [t(SHAPE[preset])]);
  $('#pad-tip').textContent = preset === 'z' ? t('gesturePadTip') : '';
  const [d, cx, cy] = GUIDE[preset];
  $('#pad-guide-path').setAttribute('d', d);
  $('#pad-guide-start').setAttribute('cx', cx); $('#pad-guide-start').setAttribute('cy', cy);
}

function showMore(on, animate = true) {
  more.classList.toggle('open', on);
  if (!animate) { more.style.transition = 'none'; requestAnimationFrame(() => (more.style.transition = '')); }
}

function selectPreset(value) {
  preset = value;
  document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  hint();
}

async function init() {
  const s = await getSettings();
  // 设置里写着开启、但权限已被收回：以实际权限为准
  const granted = await chrome.permissions.contains(ORIGINS).catch(() => false);
  sw.checked = s.gestures && granted;
  showMore(sw.checked, false);
  announce(sw.checked);
  selectPreset(s.gesturePreset);
  renderExclude(s.gestureExclude);
}

/* ---------- 开关 ---------- */
sw.addEventListener('change', () => {
  if (sw.checked) {
    // 不能先 await 任何东西：浏览器只在用户操作的同一时刻允许弹出权限请求
    chrome.permissions.request(ORIGINS).then(async (ok) => {
      if (!ok) { sw.checked = false; announce(false); toast(t('gestureDenied')); return; }
      await setSetting('gestures', true);
      chrome.runtime.sendMessage({ type: 'gestureSync' }).catch(() => {});
      showMore(true);
      announce(true);
      toast(t('gestureOn'));
    }, () => { sw.checked = false; announce(false); toast(t('gestureDenied')); });
  } else {
    showMore(false);
    announce(false);
    setSetting('gestures', false).then(() => {
      chrome.runtime.sendMessage({ type: 'gestureSync' }).catch(() => {});
      chrome.permissions.remove(ORIGINS).catch(() => {});
      toast(t('saved'));
    });
  }
});
chrome.permissions.onRemoved?.addListener(() => { sw.checked = false; showMore(false); announce(false); });

/* ---------- 手势样式 ---------- */
$('#presets').addEventListener('click', async (e) => {
  const b = e.target.closest('.preset');
  if (!b || b.dataset.value === preset) return;
  selectPreset(b.dataset.value);
  b.classList.remove('picked'); void b.offsetWidth; b.classList.add('picked');
  await setSetting('gesturePreset', preset);
  toast(t('saved'));
});
$('#presets').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const list = [...document.querySelectorAll('.preset')];
  const i = list.findIndex((b) => b.dataset.value === preset);
  const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
  next.focus(); next.click();
});

/* ---------- 练习区 ---------- */
const pad = $('#pad');
const result = $('#pad-result');
const isDark = () => {
  const th = document.documentElement.dataset.theme;
  return th === 'dark' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
};
const overlay = G.createOverlay(pad, { tag: 'tabagain-pad', dark: isDark, trail: () => true, persist: true });
const TIP = {
  z: { small: 'gestureTipSmall', first: 'gestureTipFirst', diagonal: 'gestureTipDiagonal', last: 'gestureTipLast', slow: 'gestureTipSlow' },
  ul: { small: 'gestureTipSmall', first: 'gestureTipUp', last: 'gestureTipLeft', slow: 'gestureTipSlow' },
  dr: { small: 'gestureTipSmall', first: 'gestureTipDown', last: 'gestureTipRight', slow: 'gestureTipSlow' },
  lu: { small: 'gestureTipSmall', first: 'gestureTipStartLeft', last: 'gestureTipThenUp', slow: 'gestureTipSlow' },
  rl: { small: 'gestureTipSmall', first: 'gestureTipStartRight', last: 'gestureTipBack', slow: 'gestureTipSlow' }
};
let logo = null;
fetch(chrome.runtime.getURL('icons/icon-32.png')).then((r) => r.blob()).then(createImageBitmap).then((b) => (logo = b)).catch(() => {});
const demoInfo = () => ({ kind: 'tab', host: 'tabagain', title: t('cmdRestoreLast'), bitmap: logo });
function say(text, tone) {
  result.textContent = text;
  result.dataset.tone = tone || '';
  result.classList.remove('in'); void result.offsetWidth; result.classList.add('in');
}

pad.addEventListener('contextmenu', (e) => e.preventDefault());
G.createTracker({
  overlay: () => overlay,
  preset: () => preset,
  shouldStart: (e) => pad.contains(e.target) && (e.button === 0 || e.button === 2),
  onBegin() { pad.classList.add('drawing'); result.classList.remove('in'); },
  onLive(r) {
    overlay.progress({ strokes: r.strokes, count: r.count, match: r.status === 'match', label: t('gestureRecognized'), info: demoInfo() });
  },
  onEnd(r) {
    pad.classList.remove('drawing');
    if (r.status === 'match') {
      overlay.end('done', { label: t('gestureRecognized'), count: r.count, info: demoInfo() });
      say(r.count > 1 ? t('gesturePadCombo', [String(r.count)]) : t('gesturePadDone'), 'ok');
      pad.classList.remove('success'); void pad.offsetWidth; pad.classList.add('success');
    } else {
      const tip = TIP[preset][r.reason] || '';
      overlay.end('fail', { label: t('gestureUnknown'), detail: tip ? t(tip) : '' });
    }
  }
});

/* ---------- 不使用手势的网站 ---------- */
// 默认网站显示为产品名，悬停可看到实际规则
const SITE_NAME = {
  'google.*/maps': 'gxMapsGoogle', 'map.baidu.com': 'gxMapsBaidu', 'amap.com': 'gxMapsAmap', 'map.qq.com': 'gxMapsTencent',
  'maps.apple.com': 'gxMapsApple', 'bing.com/maps': 'gxMapsBing', 'js.design': 'gxJsDesign',
  'figma.com': 'Figma', 'canva.com': 'Canva'
};
const siteName = (rule) => {
  const n = SITE_NAME[rule];
  return !n ? rule : n.startsWith('gx') ? t(n) : n;
};
function renderExclude(list) {
  const holder = $('#gx-list');
  holder.textContent = '';
  const missing = GESTURE_EXCLUDE_DEFAULTS.some((h) => !list.includes(h));
  $('#gx-reset').hidden = !missing;
  if (!list.length) {
    holder.append(Object.assign(document.createElement('span'), { className: 'tokens-empty', textContent: t('optExcludeEmpty') }));
    return;
  }
  for (const rule of list) {
    const tok = document.createElement('span');
    tok.className = 'token';
    tok.title = rule;
    tok.append(siteName(rule));
    const x = document.createElement('button');
    x.type = 'button';
    x.title = t('remove');
    x.setAttribute('aria-label', `${t('remove')} ${siteName(rule)}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-close');
    svg.append(use);
    x.append(svg);
    x.addEventListener('click', async () => {
      const s = await getSettings();
      await setSetting('gestureExclude', s.gestureExclude.filter((h) => h !== rule));
      tok.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }], { duration: 160, easing: 'ease-in' })
        .finished.then(async () => renderExclude((await getSettings()).gestureExclude));
    });
    tok.append(x);
    holder.append(tok);
  }
}
/** 输入网址或域名 → 规则：只有域名时整站；带路径时保留第一段路径（google.com/maps/place/… → google.com/maps） */
function parseRule(input) {
  const v = input.trim().toLowerCase();
  if (!v) return '';
  try {
    const u = new URL(/^[a-z]+:\/\//.test(v) ? v : 'https://' + v);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${host}/${seg}` : host;
  } catch { return ''; }
}
$('#gx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#gx-input');
  const rule = parseRule(input.value);
  if (!rule || !rule.split('/')[0].includes('.')) {
    input.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    return;
  }
  input.value = '';
  const s = await getSettings();
  // 已被现有规则覆盖（例如 google.*/maps 已包含 google.co.jp/maps）就不重复添加
  const [h, ...rest] = rule.split('/');
  const covered = s.gestureExclude.some((r) => matchesSite(r, h, rest.length ? '/' + rest.join('/') : '/'));
  if (!covered) await setSetting('gestureExclude', [...s.gestureExclude, rule]);
  renderExclude((await getSettings()).gestureExclude);
  toast(t('saved'));
});
$('#gx-reset').addEventListener('click', async () => {
  const s = await getSettings();
  const add = GESTURE_EXCLUDE_DEFAULTS.filter((h) => !s.gestureExclude.includes(h));
  await setSetting('gestureExclude', [...add, ...s.gestureExclude]);
  renderExclude((await getSettings()).gestureExclude);
  toast(t('saved'));
});

init();
