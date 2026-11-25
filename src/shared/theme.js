// 在首帧之前确定外观，避免闪烁（localStorage 为同步缓存，storage 为真实来源）
(() => {
  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem('theme') || 'auto';
  // 弹出窗口：沿用上次的高度，首帧就是对的尺寸，不先大后小
  const ph = /\/popup\.html$/.test(location.pathname) && +localStorage.getItem('popupH');
  if (ph) root.style.setProperty('--popup-h', ph + 'px');
  if (chrome?.storage?.local) {
    chrome.storage.local.get('settings').then(({ settings }) => {
      const theme = (settings && settings.theme) || 'auto';
      root.dataset.theme = theme;
      localStorage.setItem('theme', theme);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings?.newValue?.theme) {
        root.dataset.theme = changes.settings.newValue.theme;
        localStorage.setItem('theme', changes.settings.newValue.theme);
      }
    });
  }
  // 本地化：data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-label（无障碍名称）
  window.t = (key, subs) => (chrome?.i18n?.getMessage(key, subs) || key);
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.lang = chrome?.i18n?.getUILanguage?.() || 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  });
})();
