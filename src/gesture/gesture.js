/* TabAgain · 网页里的鼠标手势
   只在用户于设置中开启、并授予网站访问权限后注入。
   只监听鼠标按下 / 移动 / 松开；不读取、不修改网页内容。 */
(() => {
  'use strict';
  // 扩展更新或重新注入时，先让旧实例退场
  try { globalThis.__tabagainGesture?.destroy(); } catch {}
  const G = globalThis.TabAgainGesture;
  if (!G || window.top !== window) return;

  const ac = new AbortController();
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const t = (key, subs) => { try { return chrome.i18n.getMessage(key, subs) || ''; } catch { return ''; } };
  const PLATFORM = G.platform();
  let cfg = { gestures: false, gesturePreset: 'z', gestureTrail: true, gestureExclude: [], theme: 'auto' };

  function apply(s) { if (s) cfg = { ...cfg, ...s }; }
  chrome.storage.local.get('settings').then(({ settings }) => apply(settings)).catch(() => {});
  const onStore = (changes, area) => { if (area === 'local' && changes.settings) apply(changes.settings.newValue); };
  chrome.storage.onChanged.addListener(onStore);

  // 规则与 shared/settings.js 的 matchesSite 相同：域名（含子域名）或「域名/路径」，google.* 匹配任一国家域名。
  // 路径每次手势开始时重新读取：单页应用切换页面不会重新注入脚本
  const host = location.hostname.replace(/^www\./, '');
  const matches = (rule) => {
    const i = rule.indexOf('/');
    const h = i < 0 ? rule : rule.slice(0, i), path = i < 0 ? '' : rule.slice(i);
    const ok = h.endsWith('.*')
      ? new RegExp('(^|\\.)' + h.slice(0, -2).replace(/\./g, '\\.') + '\\.[a-z]{2,3}(\\.[a-z]{2})?$').test(host)
      : host === h || host.endsWith('.' + h);
    const p = location.pathname;
    return ok && (!path || p === path || p.startsWith(path + '/'));
  };
  const excluded = () => (cfg.gestureExclude || []).some(matches);
  const dark = () => cfg.theme === 'dark' || (cfg.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

  let overlay = null;
  const getOverlay = () => {
    const parent = document.fullscreenElement || document.documentElement;
    if (overlay && overlay.host.parentNode && overlay.host.parentNode !== parent) { overlay.destroy(); overlay = null; }
    return (overlay ||= G.createOverlay(parent, { fixed: true, dark, trail: () => cfg.gestureTrail !== false }));
  };

  /* ---------- 即将回来的那一页 ---------- */
  let peek = null, peekAt = 0;
  async function loadPeek() {
    if (peek && Date.now() - peekAt < 800) return peek;
    peekAt = Date.now();
    const res = await chrome.runtime.sendMessage({ type: 'gesturePeek' }).catch(() => null);
    const items = res?.items || [];
    await Promise.all(items.map(async (it) => {
      if (!it.icon) return;
      try {
        const bytes = Uint8Array.from(atob(it.icon.b64), (c) => c.charCodeAt(0));
        it.bitmap = await createImageBitmap(new Blob([bytes], { type: it.icon.mime }));
      } catch { it.bitmap = null; }
    }));
    return (peek = items);
  }
  const infoOf = (it) => it && ({
    kind: it.kind, host: it.host, bitmap: it.bitmap,
    title: it.kind === 'window' ? ((it.count === 1 && t('windowTitleOne', ['1'])) || t('windowTitle', [String(it.count)])) : it.title
  });

  /* ---------- 手势 ---------- */
  const shouldStart = (e) => {
    if (!cfg.gestures || excluded()) return false;
    if (!alive()) { destroy(); return false; }
    if (PLATFORM === 'win') return e.button === 2 && !e.ctrlKey && !e.metaKey;
    return e.button === 0 && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  };
  let lastLive = null, items = [];
  G.createTracker({
    signal: ac.signal,
    overlay: getOverlay,
    preset: () => cfg.gesturePreset || 'z',
    shouldStart,
    onBegin() {
      items = peek || [];
      loadPeek().then((list) => { items = list; if (lastLive?.status === 'match') overlay?.setInfo(infoOf(items[0]) || emptyInfo()); });
    },
    onLive(r) {
      lastLive = r;
      const match = r.status === 'match';
      overlay.progress({
        strokes: r.strokes, count: r.count, match,
        label: items.length || !peek ? t('restore') : t('emptyTitle'),
        info: items.length ? infoOf(items[0]) : null
      });
    },
    async onEnd(r, g) {
      lastLive = null;
      if (r.status !== 'match') {
        overlay.end('fail', { label: t('gestureUnknown') });
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'gestureRestore', count: r.count, startedAt: g.startedAt }).catch(() => null);
      peek = null;
      if (!res || !res.restored) { overlay.end('fail', { label: t('emptyTitle') }); return; }
      overlay.end('done', {
        label: t('gestureDone'),
        count: res.combo,
        info: infoOf(items[0]) || undefined
      });
      // 下一次手势的预览提前备好（连画 Z 时更快）
      setTimeout(() => loadPeek().catch(() => {}), 120);
    }
  });
  const emptyInfo = () => null;

  function destroy() {
    ac.abort();
    try { chrome.storage.onChanged.removeListener(onStore); } catch {}
    overlay?.destroy();
    overlay = null;
    if (globalThis.__tabagainGesture === api) delete globalThis.__tabagainGesture;
  }
  const api = { destroy };
  globalThis.__tabagainGesture = api;
})();
