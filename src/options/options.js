/* TabAgain · 设置页 */
import { getSettings, setSetting } from '../shared/settings.js';
import { countTop } from '../shared/db.js';
import { openShortcutSettings } from '../shared/ui.js';

const $ = (sel) => document.querySelector(sel);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const nf = new Intl.NumberFormat(chrome.i18n.getUILanguage());

$('#version').textContent = 'v' + chrome.runtime.getManifest().version;

/* ---------- 分段控件：滑块跟随 ---------- */
function placeThumb(seg, animate = true) {
  const thumb = seg.querySelector('.thumb');
  const on = seg.querySelector('[aria-checked="true"]');
  if (!thumb || !on) return;
  if (!animate) thumb.style.transition = 'none';
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`;
  thumb.style.left = '2px';
  if (!animate) requestAnimationFrame(() => (thumb.style.transition = ''));
}
function selectSeg(seg, value, animate) {
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(value))));
  placeThumb(seg, animate);
}
const allSegs = () => document.querySelectorAll('.segmented');

let toastTimer;
function toast(text) {
  $('#toast-text').textContent = text;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 1800);
}

async function init() {
  const s = await getSettings();

  document.querySelectorAll('.switch[data-key]').forEach((el) => {
    el.checked = !!s[el.dataset.key];
    el.addEventListener('change', async () => { await setSetting(el.dataset.key, el.checked); toast(t('saved')); });
  });

  document.querySelectorAll('.segmented[data-key]').forEach((seg) => {
    selectSeg(seg, s[seg.dataset.key], false);
    seg.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const value = seg.dataset.type === 'number' ? Number(btn.dataset.value) : btn.dataset.value;
      selectSeg(seg, value, true);
      if (seg.dataset.key === 'theme') localStorage.setItem('theme', value);
      await setSetting(seg.dataset.key, value);
      toast(t('saved'));
    });
  });

  renderExclude(s.exclude);
  document.fonts?.ready.then(() => allSegs().forEach((seg) => placeThumb(seg, false)));
  addEventListener('resize', () => allSegs().forEach((seg) => placeThumb(seg, false)));
}

/* ---------- 不记录的网站 ---------- */
function renderExclude(list) {
  const holder = $('#exclude-list');
  holder.textContent = '';
  if (!list.length) {
    holder.append(Object.assign(document.createElement('span'), { className: 'tokens-empty', textContent: t('optExcludeEmpty') }));
    return;
  }
  for (const host of list) {
    const tok = document.createElement('span');
    tok.className = 'token';
    tok.append(host);
    const x = document.createElement('button');
    x.type = 'button';
    x.title = t('remove');
    x.innerHTML = '<svg class="i"><use href="#i-close"/></svg>';
    x.addEventListener('click', async () => {
      const s = await getSettings();
      await setSetting('exclude', s.exclude.filter((h) => h !== host));
      tok.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }], { duration: 160, easing: 'ease-in' })
        .finished.then(async () => renderExclude((await getSettings()).exclude));
    });
    tok.append(x);
    holder.append(tok);
  }
}

function parseHost(input) {
  const v = input.trim().toLowerCase();
  if (!v) return '';
  try { return new URL(/^[a-z]+:\/\//.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

$('#exclude-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const host = parseHost($('#exclude-input').value);
  if (!host || !host.includes('.')) { $('#exclude-input').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 }); return; }
  $('#exclude-input').value = '';
  // 加入排除并删除该网站已有的记录
  const res = await chrome.runtime.sendMessage({ type: 'excludeHost', host }).catch(() => null);
  renderExclude((await getSettings()).exclude);
  toast(res?.count ? t('excludedToast', [host, nf.format(res.count)]) : t('saved'));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) renderExclude((changes.settings.newValue?.exclude) || []);
});

/* ---------- 快捷键 ---------- */
async function loadShortcut() {
  const holder = $('#shortcut');
  holder.textContent = '';
  let keys = [];
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'restore-last');
    const raw = cmd?.shortcut || '';
    keys = raw ? (raw.includes('+') ? raw.split('+') : [...raw]) : [];
  } catch {}
  if (keys.length) keys.forEach((k) => holder.append(Object.assign(document.createElement('kbd'), { textContent: k.trim() })));
  else holder.append(Object.assign(document.createElement('span'), { className: 'unset', textContent: t('optShortcutUnset') }));
}
$('#edit-shortcut').addEventListener('click', () => openShortcutSettings());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadShortcut(); loadStats(); } });

/* ---------- 数据 ---------- */
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
async function loadStats() {
  const n = await countTop().catch(() => 0);
  $('#stored').textContent = nf.format(n);
  $('#stored-text').textContent = n ? t('optStoredHint') : t('emptyTitle');
  try {
    const est = await navigator.storage.estimate();
    const idb = est.usageDetails?.indexedDB ?? est.usage ?? 0;
    $('#usage').textContent = formatBytes(idb);
  } catch {}
}
const bc = new BroadcastChannel('tabagain');
let statsTimer = 0;
bc.onmessage = () => { clearTimeout(statsTimer); statsTimer = setTimeout(loadStats, 300); };

$('#open-history').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') }));

/* ---------- 按时间范围清除 ---------- */
const rangeSeg = $('#range-seg');
function openDialog(open) {
  $('#scrim').hidden = !open;
  $('#dialog').hidden = !open;
  if (open) { requestAnimationFrame(() => placeThumb(rangeSeg, false)); $('#dlg-cancel').focus(); }
}
rangeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) selectSeg(rangeSeg, b.dataset.value, true);
});
$('#clear-range').addEventListener('click', () => openDialog(true));
$('#dlg-cancel').addEventListener('click', () => openDialog(false));
$('#scrim').addEventListener('click', () => openDialog(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDialog(false); });
$('#dlg-ok').addEventListener('click', async () => {
  const pick = rangeSeg.querySelector('[aria-checked="true"]').dataset.value;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const range = { hour: { since: Date.now() - 36e5 }, today: { since: d.getTime() }, week: { since: Date.now() - 7 * 864e5 }, all: { all: true } }[pick];
  const res = await chrome.runtime.sendMessage({ type: 'clearRange', ...range }).catch(() => null);
  openDialog(false);
  toast(t('deletedCount', [nf.format(res?.count || 0)]));
  loadStats();
});

init();
loadShortcut();
loadStats();
