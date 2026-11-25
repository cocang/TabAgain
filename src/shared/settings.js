// 设置的唯一来源：后台与界面共用
export const DEFAULTS = Object.freeze({
  theme: 'auto',          // auto | light | dark
  limit: 10000,           // 最多保存条数：1,000 / 10,000 / 50,000 / 99,999
  retention: 0,           // 保留天数：30 / 365 / 0（永久）
  dedupe: true,           // 合并相同网址
  keepOnRestart: true,    // 重启后保留
  preferSession: true,    // 优先通过浏览器会话恢复（保留前进/后退）
  position: 'original',   // original | end
  badge: false,           // 工具栏数量角标
  exclude: [],            // 不记录的网站（含子域名）
  pageSize: 50,           // 每页条数：25 / 50 / 100 / 200
  showChips: true,        // 搜索框下方的站点筛选条
  gestures: false,        // 鼠标手势（需授予网站访问权限）
  gesturePreset: 'z',     // z | ul（↑←）| dr（↓→）| lu（←↑）| rl（→←）
  gestureTrail: true,     // 显示手势轨迹
  gestureExclude: [],     // 不使用手势的网站：域名（含子域名），或「域名/路径」；google.* 匹配任一国家域名
  gxSeeded: 0             // 已放入默认的「不使用手势的网站」（只放一次，之后由用户决定去留）
});

/* 默认不使用手势的网站：地图与设计工具都靠鼠标拖动，右键手势容易误触 */
export const GESTURE_EXCLUDE_DEFAULTS = Object.freeze([
  'google.*/maps', 'map.baidu.com', 'amap.com', 'map.qq.com', 'maps.apple.com', 'bing.com/maps',
  'figma.com', 'js.design', 'canva.com'
]);

export const LIMITS = [1000, 10000, 50000, 99999];
export const RETENTIONS = [30, 365, 0];
export const PAGE_SIZES = [25, 50, 100, 200];
export const GESTURE_PRESETS = ['z', 'lu', 'rl', 'ul', 'dr'];

export function normalize(raw) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  if (!LIMITS.includes(s.limit)) s.limit = LIMITS.find((n) => n >= s.limit) || DEFAULTS.limit;
  if (!RETENTIONS.includes(s.retention)) s.retention = 0;
  if (!Array.isArray(s.exclude)) s.exclude = [];
  if (!PAGE_SIZES.includes(s.pageSize)) s.pageSize = DEFAULTS.pageSize;
  s.showChips = s.showChips !== false;
  s.gestures = s.gestures === true;
  if (!GESTURE_PRESETS.includes(s.gesturePreset)) s.gesturePreset = 'z';
  s.gestureTrail = s.gestureTrail !== false;
  if (!Array.isArray(s.gestureExclude)) s.gestureExclude = [];
  if (!s.gxSeeded) {
    s.gestureExclude = [...GESTURE_EXCLUDE_DEFAULTS.filter((h) => !s.gestureExclude.includes(h)), ...s.gestureExclude];
    s.gxSeeded = 1;
  }
  return s;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalize(settings);
}

export async function setSetting(key, value) {
  const current = await getSettings();
  current[key] = value;
  await chrome.storage.local.set({ settings: current });
  return current;
}

export const isExcluded = (host, list) =>
  !!host && list.some((ex) => host === ex || host.endsWith('.' + ex));

/** 网址是否落在「不使用手势的网站」里。规则：host 或 host/路径；google.* 表示任一国家域名（google.com、google.co.jp…） */
export function matchesSite(rule, hostname, pathname = '/') {
  const host = hostname.replace(/^www\./, '');
  const i = rule.indexOf('/');
  const h = i < 0 ? rule : rule.slice(0, i);
  const path = i < 0 ? '' : rule.slice(i);
  const hostOk = h.endsWith('.*')
    ? new RegExp('(^|\\.)' + h.slice(0, -2).replace(/\./g, '\\.') + '\\.[a-z]{2,3}(\\.[a-z]{2})?$').test(host)
    : host === h || host.endsWith('.' + h);
  return hostOk && (!path || pathname === path || pathname.startsWith(path + '/'));
}
