/* =============================================================================
   首次安装引导
   · 安装后第一次打开设置页自动出现；之后可从「快捷键」一行的播放按钮再次观看
   · 上半部是 Lottie 动画，两幕各讲一种找回方式：关闭 → 按快捷键找回；关闭 → 画一个 Z 找回。下方两段进度条与动画逐帧同步，可点按跳到任一幕
   · 快捷键与鼠标手势是同一组里的两行，始终都在；动画讲到哪种方式，标题说明随之切换、那一行被点亮
   · 鼠标手势开关与设置页是同一个（权限请求、保存、同步都在那里完成）
   · 快捷键实时读取：去 chrome://extensions/shortcuts 改完回来，卡片会立刻刷新并打勾
   ============================================================================= */
import { openShortcutSettings } from '../shared/ui.js';

const $ = (s) => document.querySelector(s);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

const dialog = $('#welcome');
const scrim = $('#wl-scrim');
const stage = $('#wl-anim');
const steps = [...document.querySelectorAll('#wl-steps li')];
const SEGMENTS = [[0, 268], [268, 528]];   // 与动画标记一致：shortcut · gesture
const GESTURE_FROM = SEGMENTS[1][0];
const G = globalThis.TabAgainGesture;
const pages = $('#wl-pages');
const pageEls = [...document.querySelectorAll('.wl-page')];
const group = $('#wl-group');
const gsw = $('#wl-gesture-switch');
let page = 0, hovering = false, waitLoop = false;

let anim = null, animTheme = '', loopTimer = 0, keys = [], lastFocus = null;

/* ---------- Lottie：按需加载，首屏不背这 160KB ---------- */
let lottieReady = null;
function loadLottie() {
  return lottieReady ||= new Promise((resolve, reject) => {
    if (window.lottie) return resolve(window.lottie);
    const s = document.createElement('script');
    s.src = '../vendor/lottie_light.min.js';
    s.onload = () => resolve(window.lottie);
    s.onerror = reject;
    document.head.append(s);
  });
}
const dataCache = {};
const loadData = (theme) => (dataCache[theme] ||= fetch(`../onboarding/lottie-${theme}.json`).then((r) => r.json()));
const isDark = () => {
  const th = document.documentElement.dataset.theme;
  return th === 'dark' || (th !== 'light' && darkMQ.matches);
};
const themeNow = () => (isDark() ? 'dark' : 'light');
/** 提前载入播放器与动画数据（弹窗入场的同时、或指针移到重播按钮上时） */
export function preload() { loadLottie().catch(() => {}); loadData(themeNow()).catch(() => {}); }

/* ---------- 首次播放为什么卡、循环为什么顺 ----------
   循环时浏览器已经把这段动画「见过」一遍：脚本已被 V8 优化、每个图层都建好了排版对象、
   路径与渐变的栅格化结果和着色器在显卡里有缓存、两页文案的字形也已栅格化进字形缓存。
   第一次播放时这些都要在播放途中现做，所以只有第一圈掉帧。
   以前的「预热」是在一个同步循环里静默跳 88 帧：只算了变换，从未真正画到屏幕上（没有栅格化、没有字形），
   反而在开播前制造了一个几百毫秒的长任务。
   现在改成真正的预热：舞台以 0.3% 的不透明度（肉眼不可见，但合成器会照常栅格化）逐帧把动画画一遍——
   每个图层至少出现一次，第二页文案与提示文字也同时以同样方式画出来；
   一帧一个 requestAnimationFrame，和弹窗入场同时进行，入场是合成器动画，不受影响 */
function warmFrames(data) {
  const op = Math.round(data.op), set = new Set();
  for (let f = 0; f < op; f += 16) set.add(f);           // 先粗后细：时间不够时也覆盖了整段
  const coarse = [...set];
  for (const l of data.layers || []) {                    // 每个图层至少出现一次
    const a = Math.ceil(l.ip), b = Math.floor(l.op);
    if (!coarse.some((f) => f >= a && f < b)) set.add(Math.min(b - 1, a + 4));
  }
  const fine = [];
  for (let f = 8; f < op; f += 16) if (!set.has(f)) fine.push(f);
  return [...set].sort((x, y) => x - y).concat(fine);
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function warmUp(a, data, budget = 900) {
  dialog.classList.add('wl-warm');
  $('#wl-tip-warm').textContent = t('gesturePadTip');
  const t0 = performance.now();
  for (const f of warmFrames(data)) {
    if (dialog.hidden || a !== anim) break;
    a.goToAndStop(f, true);
    await nextFrame();
    if (performance.now() - t0 > budget) break;
  }
  dialog.classList.remove('wl-warm');
}

async function mountAnimation(fromFrame = 0, autoplay = true, warm = true) {
  const theme = themeNow();
  const [lottie, data] = await Promise.all([loadLottie(), loadData(theme)]);
  if (dialog.hidden) return;
  anim?.destroy();
  stage.textContent = '';
  stage.classList.remove('on');
  animTheme = theme;
  const a = anim = lottie.loadAnimation({
    container: stage, renderer: 'svg', loop: false, autoplay: false, animationData: data,
    // hideOnTransparent: false —— 透明的图层也照常更新变换。默认会把透明图层整个跳过，
    // 某些图层第一次出现的那一帧会沿用未计算的变换，闪现在画面左上角（只在首次播放时出现）
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: false }
  });
  let warming = warm;
  a.addEventListener('enterFrame', () => { if (!warming) syncSteps(a.currentFrame); });
  a.addEventListener('complete', () => {
    clearTimeout(loopTimer);
    // 正在看手势那一页（指针停在文案或卡片上）时不回到开头，移开后再继续
    loopTimer = setTimeout(() => {
      if (dialog.hidden || document.hidden) return;
      if (hovering) { waitLoop = true; return; }
      a.goToAndPlay(0, true);
    }, 1200);
  });
  await new Promise((r) => (a.isLoaded ? r() : a.addEventListener('DOMLoaded', r, { once: true })));
  if (warm) await warmUp(a, data);
  warming = false;
  if (a !== anim || dialog.hidden) return;
  // 注意：不因「减少动态效果」停在静帧。Windows 关闭「动画效果」时 Chrome 会报告 reduce，
  // 引导动画本身就是说明内容，静帧看不懂；这里照常播放（入场过渡仍按系统设置简化）
  a.goToAndStop(fromFrame, true);
  stage.classList.add('on');
  if (autoplay) a.play();
}

/** 两段进度：当前段按帧推进，之前的满格，之后的清空；到第二幕时文案切换为手势说明 */
// 只在数值真的变化时写 DOM：每次写 --p 都会让进度条所在区域重新计算样式、并入当帧的重绘范围。
// 进度条宽约 240px，取 1/480 的步长，肉眼仍是连续的
const stepState = SEGMENTS.map(() => ({ p: -1, on: null, done: null }));
function syncSteps(f) {
  setPage(f >= GESTURE_FROM ? 1 : 0);
  SEGMENTS.forEach(([a, b], i) => {
    const p = Math.round(Math.max(0, Math.min(1, (f - a) / (b - a))) * 480) / 480;
    const li = steps[i], st = stepState[i];
    const on = f >= a && (f < b || i === SEGMENTS.length - 1), done = p >= 1;
    if (p !== st.p) { st.p = p; li.style.setProperty('--p', String(p)); }
    if (on !== st.on) { st.on = on; li.classList.toggle('on', on); }
    if (done !== st.done) { st.done = done; li.classList.toggle('done', done); }
  });
}

function setPage(n) {
  if (n === page) return;
  page = n;
  pages.dataset.page = String(n);
  pageEls.forEach((el, i) => el.setAttribute('aria-hidden', String(i !== n)));
  group.dataset.focus = n ? 'gesture' : 'key';

  const tip = $('#wl-tip');
  tip.classList.remove('swap'); void tip.offsetWidth; tip.classList.add('swap');
  $('#wl-tip-text').textContent = n ? t('gesturePadTip') : t('welcomePin');
  $('#wl-tip-icon').setAttribute('href', n ? '#i-sparkle' : '#i-pin');
}

/* 点按进度条：跳到那一段 */
steps.forEach((li, i) => li.addEventListener('click', () => {
  if (!anim) return;
  clearTimeout(loopTimer); waitLoop = false;
  anim.goToAndPlay(SEGMENTS[i][0], true);
}));
// 指针停在手势说明或开关上时，动画放完不回到开头，移开后再继续
const hoverZone = [pages, $('#wl-gesture')];
hoverZone.forEach((el) => el.addEventListener('pointerenter', () => { hovering = page === 1; }));
hoverZone.forEach((el) => el.addEventListener('pointerleave', () => {
  hovering = false;
  if (waitLoop && anim && !dialog.hidden) { waitLoop = false; clearTimeout(loopTimer); loopTimer = setTimeout(() => anim.goToAndPlay(0, true), 500); }
}));

/* ---------- 鼠标手势（与设置页共用同一个开关：权限请求、保存、同步都在那里完成） ---------- */
function gestureCopy() {
  const pf = G?.platform?.() || 'win';
  const key = pf === 'win' ? 'gestureHintWin' : pf === 'mac' ? 'gestureHintMac' : 'gestureHintLinux';
  $('#wl-gesture-body').textContent = t(key, [t('gestureShapeZ')]);
}
gsw.addEventListener('change', () => {
  const main = $('#gesture-switch');
  if (!main) return;
  // 在同一次点按里转交给设置页的开关：浏览器只在用户操作的同一时刻允许请求权限
  if (main.checked !== gsw.checked) main.click();
});
document.addEventListener('tabagain:gesture', (e) => {
  gsw.checked = !!e.detail?.on;
  $('#wl-gesture').classList.toggle('on', gsw.checked);
});

/* ---------- 快捷键 ---------- */
async function readShortcut() {
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'restore-last');
    const raw = cmd?.shortcut || '';
    return raw ? (raw.includes('+') ? raw.split('+') : [...raw]).map((k) => k.trim()) : [];
  } catch { return []; }
}
const kbdNodes = (list) => list.map((k) => Object.assign(document.createElement('kbd'), { textContent: k }));

async function renderShortcut(animate = false) {
  const prev = keys.join('+');
  keys = await readShortcut();
  const ready = keys.length > 0;
  const card = $('#wl-key');
  $('#wl-keys').replaceChildren(...(ready ? kbdNodes(keys) : [Object.assign(document.createElement('span'), { className: 'unset', textContent: t('optShortcutUnset') })]));
  $('#wl-step-keys').replaceChildren(...kbdNodes(ready ? keys : ['Alt', 'Z']));
  $('#wl-key-hint').textContent = ready ? t('welcomeReadyHint') : t('welcomeUnsetHint');
  $('#wl-state-text').textContent = ready ? t('welcomeReady') : t('welcomeUnset');
  card.classList.toggle('ready', ready);
  card.classList.toggle('unset', !ready);
  // 未设置：主按钮去设置；已就绪：主按钮开始使用
  const primary = $('#wl-primary'), secondary = $('#wl-secondary');
  primary.querySelector('span').textContent = ready ? t('welcomeStart') : t('welcomeSet');
  primary.classList.toggle('external', !ready);
  secondary.textContent = ready ? t('welcomeChange') : t('welcomeLater');
  if (animate && prev !== keys.join('+')) {
    card.classList.remove('changed'); void card.offsetWidth; card.classList.add('changed');
  }
}
const openShortcuts = () => openShortcutSettings();

$('#wl-primary').addEventListener('click', () => (keys.length ? close() : openShortcuts()));
$('#wl-secondary').addEventListener('click', () => (keys.length ? openShortcuts() : close()));
$('#wl-close').addEventListener('click', () => close());
scrim.addEventListener('click', () => close());

/* ---------- 打开 / 关闭 ---------- */
export async function open() {
  if (!dialog.hidden) return;
  lastFocus = document.activeElement;
  await renderShortcut();
  gestureCopy();
  gsw.checked = !!$('#gesture-switch')?.checked;
  $('#wl-gesture').classList.toggle('on', gsw.checked);
  page = -1;
  syncSteps(0);
  preload();          // 弹窗入场的同时载入播放器与数据
  scrim.hidden = false;
  dialog.hidden = false;
  document.body.classList.add('wl-open');
  dialog.classList.remove('leaving', 'kb');
  scrim.classList.remove('leaving');
  // 先让窗体落定，再开始讲故事
  // 立即开始预热（与入场同时进行），预热完再淡入开播
  mountAnimation(0).catch((e) => console.error('guide animation', e));
  requestAnimationFrame(() => $('#wl-primary').focus({ preventScroll: true }));
}

function close() {
  if (dialog.hidden || dialog.classList.contains('leaving')) return;
  chrome.storage.local.set({ onboarded: true });
  clearTimeout(loopTimer);
  const done = () => {
    dialog.hidden = true; scrim.hidden = true;
    dialog.classList.remove('leaving'); scrim.classList.remove('leaving');
    document.body.classList.remove('wl-open');
    anim?.destroy(); anim = null; stage.textContent = ''; stage.classList.remove('on');
    (lastFocus && document.contains(lastFocus) ? lastFocus : $('#edit-shortcut'))?.focus({ preventScroll: true });
    // 收尾：页面顶部的图标轻轻点头，告诉你「就在这里」
    const mark = document.querySelector('.hero-mark');
    if (mark && !reduce.matches) mark.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08) rotate(-4deg)' }, { transform: 'scale(1)' }],
      { duration: 620, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );
  };
  if (reduce.matches) return done();
  dialog.classList.add('leaving');
  scrim.classList.add('leaving');
  setTimeout(done, 260);
}

/* 键盘：Esc 关闭，Tab 在对话框内循环 */
dialog.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
  if (e.key !== 'Tab') return;
  dialog.classList.add('kb');   // 用键盘时才显示焦点环
  const f = [...dialog.querySelectorAll('button:not([disabled]), input')].filter((b) => b.offsetParent && !b.closest('[inert]'));
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});

/* 从快捷键页面回来：刷新并打勾；页面不可见时暂停动画 */
document.addEventListener('visibilitychange', () => {
  if (dialog.hidden) return;
  if (document.hidden) { anim?.pause(); clearTimeout(loopTimer); return; }
  renderShortcut(true);
  if (anim) anim.play();
});

/* 外观切换时换一套配色，停在同一帧继续 */
function onThemeChange() {
  if (!anim || dialog.hidden) return;
  if ((isDark() ? 'dark' : 'light') === animTheme) return;
  mountAnimation(anim.currentFrame, !anim.isPaused, false);   // 换配色只是换颜色，不必再预热
}
darkMQ.addEventListener('change', onThemeChange);
new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

$('#replay-guide')?.addEventListener('pointerenter', preload, { once: true });
$('#replay-guide')?.addEventListener('click', open);

/* 首次：安装后第一次打开设置页；也可用 #welcome 直接唤起 */
const { onboarded } = await chrome.storage.local.get('onboarded');
if (!onboarded || location.hash === '#welcome') open();
