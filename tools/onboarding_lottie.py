"""
生成首次安装引导用的 Lottie 动画（浅色 / 深色各一份）
两幕，各讲一种找回方式，互不串场；两幕的开场与收尾完全相同（同一个关闭动作、同一种飞回与落定），只换中间的「找回方式」
第一幕 0–300「快捷键」：点关闭 → 标签缩小落进下方 → 键帽浮起，依次按下 Alt、Z → 标签从键帽处沿弧线飞回原位，弹性落定，打勾
第二幕 300–560「鼠标手势」：点关闭 → 标签缩小落进下方 → 鼠标浮起，按住右键画一个 Z（渐变轨迹 + 实时点亮的提示胶囊）→ 松开，标签从胶囊飞回原位
画布 560×340，60fps，约 9.3 秒循环（每一幕首尾状态一致，可无缝循环）
运行：python3 tools/onboarding_lottie.py  →  src/onboarding/lottie-{light,dark}.json
"""
import json, os, copy

FR, OP, W, H = 60, 528, 560, 340
ACT4 = 268            # 第二幕（鼠标手势）起点；第一幕的动态图层在此结束
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'onboarding')

# ---------------------------------------------------------------- 缓动（cubic-bezier → Lottie 切线）
EASE = {
    'out':    (.22, .9, .32, 1),    # 快出慢停；起步不再过陡，60 fps 下首帧位移不会显得跳
    'inout':  (.65, 0, .35, 1),
    'soft':   (.4, 0, .2, 1),
    'in':     (.5, 0, .9, .4),
    'lin':    (0, 0, 1, 1),
    'back':   (.34, 1.3, .64, 1),   # 轻微回弹
}

def hexc(h, a=1.0):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]

def sv(v):
    return {'a': 0, 'k': v}

def anim(keys, dims=None):
    """keys: [(frame, value, ease_name | 'hold'), ...]；最后一个的 ease 无意义"""
    out = []
    for n, (t, v, e) in enumerate(keys):
        vv = v if isinstance(v, list) else [v]
        d = dims or len(vv)
        k = {'t': t, 's': vv}
        if n < len(keys) - 1:
            if e == 'hold':
                k['h'] = 1
            else:
                x1, y1, x2, y2 = EASE[e]
                k['o'] = {'x': [x1] * d, 'y': [y1] * d}
                k['i'] = {'x': [x2] * d, 'y': [y2] * d}
        out.append(k)
    return {'a': 1, 'k': out}

def panim(keys):
    """位置关键帧，可带弧线切线：(t, [x,y], ease, to, ti)"""
    out = []
    for n, item in enumerate(keys):
        t, v, e = item[:3]
        to = item[3] if len(item) > 3 else [0, 0]
        ti = item[4] if len(item) > 4 else [0, 0]
        k = {'t': t, 's': v}
        if n < len(keys) - 1:
            x1, y1, x2, y2 = EASE[e] if e != 'hold' else (0, 0, 1, 1)
            if e == 'hold':
                k['h'] = 1
            else:
                k['o'] = {'x': x1, 'y': y1}
                k['i'] = {'x': x2, 'y': y2}
            k['to'] = to
            k['ti'] = ti
        out.append(k)
    return {'a': 1, 'k': out}

# ---------------------------------------------------------------- 形状
def rect(w, h, r, p=(0, 0)):
    return {'ty': 'rc', 'd': 1, 's': sv([w, h]), 'p': sv(list(p)), 'r': sv(r), 'nm': 'rect'}

def ellipse(w, h, p=(0, 0)):
    return {'ty': 'el', 'd': 1, 's': sv([w, h]), 'p': sv(list(p)), 'nm': 'ellipse'}

def poly(pts, closed=False):
    n = len(pts)
    return {'ty': 'sh', 'd': 1, 'nm': 'path', 'ks': sv({'i': [[0, 0]] * n, 'o': [[0, 0]] * n, 'v': [list(p) for p in pts], 'c': closed})}

def fill(c, o=100):
    return {'ty': 'fl', 'c': c if isinstance(c, dict) else sv(c), 'o': o if isinstance(o, dict) else sv(o), 'r': 1, 'nm': 'fill'}

def stroke(c, w=2, o=100):
    return {'ty': 'st', 'c': c if isinstance(c, dict) else sv(c), 'o': o if isinstance(o, dict) else sv(o),
            'w': sv(w), 'lc': 2, 'lj': 2, 'ml': 4, 'nm': 'stroke'}

def gstroke(c1, c2, s, e, w=3, o=100):
    return {'ty': 'gs', 'o': o if isinstance(o, dict) else sv(o), 't': 1, 'nm': 'gradient-stroke', 'lc': 2, 'lj': 2, 'ml': 4,
            'w': w if isinstance(w, dict) else sv(w),
            'g': {'p': 3, 'k': sv([0, *c1[:3], .5, *MID[:3], 1, *c2[:3]])}, 's': sv(list(s)), 'e': sv(list(e))}

def gfill(c1, c2, s, e, o=100):
    return {'ty': 'gf', 'o': o if isinstance(o, dict) else sv(o), 'r': 1, 't': 1, 'nm': 'gradient',
            'g': {'p': 2, 'k': sv([0, *c1[:3], 1, *c2[:3]])}, 's': sv(list(s)), 'e': sv(list(e))}

def trim(s=0, e=100):
    return {'ty': 'tm', 's': s if isinstance(s, dict) else sv(s), 'e': e if isinstance(e, dict) else sv(e), 'o': sv(0), 'm': 1, 'nm': 'trim'}

def tr(p=(0, 0), a=(0, 0), s=(100, 100), r=0, o=100):
    return {'ty': 'tr', 'p': p if isinstance(p, dict) else sv(list(p)), 'a': sv(list(a)),
            's': s if isinstance(s, dict) else sv(list(s)), 'r': sv(r), 'o': o if isinstance(o, dict) else sv(o),
            'sk': sv(0), 'sa': sv(0), 'nm': 'transform'}

def group(nm, items, **t):
    return {'ty': 'gr', 'nm': nm, 'it': items + [tr(**t)]}

# ---------------------------------------------------------------- 图层
class Comp:
    def __init__(self):
        self.layers = []   # 从下到上追加，输出时反转

    def add(self, nm, shapes=None, p=(0, 0), a=(0, 0), s=(100, 100), o=100, r=0, parent=None, null=False, ip=0, op=None):
        ind = len(self.layers) + 1
        L = {'ddd': 0, 'ind': ind, 'ty': 3 if null else 4, 'nm': nm, 'sr': 1, 'ao': 0, 'ip': ip, 'op': OP if op is None else op, 'st': 0, 'bm': 0,
             'ks': {'o': o if isinstance(o, dict) else sv(o), 'r': r if isinstance(r, dict) else sv(r),
                    'p': p if isinstance(p, dict) else sv(list(p)), 'a': sv(list(a)),
                    's': s if isinstance(s, dict) else sv(list(s))}}
        if not null:
            L['shapes'] = shapes or []
        if parent:
            L['parent'] = parent
        self.layers.append(L)
        return ind

    def tighten(self):
        """每个图层只在它真正可见的帧段内存在（ip/op 收紧）：播放时同时参与计算的图层更少，逐帧更稳"""
        for L in self.layers:
            o = L['ks']['o']
            if not o.get('a'):
                continue
            ks = o['k']
            vis = []
            for n, k in enumerate(ks):
                v0 = k['s'][0]
                t0 = k['t']
                t1 = ks[n + 1]['t'] if n + 1 < len(ks) else OP
                v1 = v0 if k.get('h') or n + 1 >= len(ks) else ks[n + 1]['s'][0]
                if v0 > 0 or v1 > 0:
                    vis.append((t0, t1))
            if not vis:
                continue
            lo, hi = min(v[0] for v in vis), max(v[1] for v in vis)
            L['ip'] = max(L['ip'], int(lo) - 1)
            L['op'] = min(L['op'], int(hi) + 2)

    def json(self, name):
        self.tighten()
        return {'v': '5.7.4', 'fr': FR, 'ip': 0, 'op': OP, 'w': W, 'h': H, 'nm': name, 'ddd': 0, 'assets': [],
                'layers': list(reversed(self.layers)), 'markers': [
                    {'tm': 0, 'cm': 'shortcut', 'dr': ACT4},
                    {'tm': ACT4, 'cm': 'gesture', 'dr': OP - ACT4}]}

# ---------------------------------------------------------------- 配色
PALETTE = {
    'light': dict(
        win='#FFFFFF', winEdge=hexc('#000000', 1), winEdgeO=8, chrome='#F4F5F8',
        tab='#E7E9EF', tabActive='#FFFFFF', tabLine='#C3C8D2', tabLineActive='#9AA3B5',
        addr='#ECEEF2', line='#E6E9EF', lineB='#E9EBF0', blockB='#EFF1F5',
        hero1='#DCE8FF', hero2='#E6DEFF', heroDot='#FFFFFF',
        keyTop='#FFFFFF', keyBase='#C9CFDA', keyEdge=hexc('#000000'), keyEdgeO=7, legend='#1D1D1F',
        cursor='#111114', cursorEdge='#FFFFFF', badgeTick='#FFFFFF', shadow='#1E2A55', shadowO=10,
        dots=('#FF5F57', '#FEBC2E', '#28C840'), dotsO=100),
    'dark': dict(
        win='#1E1F25', winEdge=hexc('#FFFFFF', 1), winEdgeO=10, chrome='#26272E',
        tab='#2F3038', tabActive='#1E1F25', tabLine='#4A4C57', tabLineActive='#6C7080',
        addr='#2C2D35', line='#2C2E37', lineB='#2E3039', blockB='#2A2C34',
        hero1='#22345E', hero2='#302861', heroDot='#5C74FF',
        keyTop='#3A3B44', keyBase='#15161A', keyEdge=hexc('#FFFFFF'), keyEdgeO=9, legend='#F2F2F7',
        cursor='#FFFFFF', cursorEdge='#111114', badgeTick='#FFFFFF', shadow='#000000', shadowO=26,
        dots=('#FF5F57', '#FEBC2E', '#28C840'), dotsO=90),
}
BLUE, PURPLE, MID = hexc('#3D8BFF'), hexc('#7B5CFF'), hexc('#5C74FF')

# ---------------------------------------------------------------- 时间轴（帧）
# 第一幕与第二幕同一节奏：约 0.6 秒点关闭，约 1.5 秒落进面板，随后找回，约 2.7 秒落定
T_CURSOR_IN, T_CLICK, T_CLOSE, T_GHOST_END = 6, 34, 38, 84
T_KEYS_IN, T_ALT, T_Z, T_RELEASE = 70, 104, 120, 150
T_FLY, T_LAND, T_SETTLE = 124, 150, 170
T_KEYS_OUT, T_BADGE_OUT = 200, 222

TAB_Y = 78
TABS_X = [200, 290, 380]
TAB_W, TAB_H = 82, 26
CLOSE_X = TABS_X[2] + 29
HUD_P = (280, 250)    # 两幕共用的悬浮面板中心：第一幕放键帽，第二幕放手势胶囊；关闭的标签都落进这里，再从这里飞回
KEY_ALT_X, KEY_Z_X = -30, 33          # 两颗键帽相对面板原点的水平位置
PLATE_W, PLATE_H = 168, 56
PLATE_CX, PLATE_CY = (KEY_ALT_X - 33 + KEY_Z_X + 24) / 2, 1
KEYS_P = (HUD_P[0] - PLATE_CX, HUD_P[1] - PLATE_CY)


def tab_shapes(P, active_fill, brand=False, line_c=None):
    """一个标签：圆角块 + 网站图标 + 标题线 + 关闭叉"""
    items = [
        group('close', [poly([(-3, -3), (3, 3)]), poly([(3, -3), (-3, 3)]), stroke(hexc(line_c or P['tabLine']), 1.5)], p=(29, 0)),
        group('title', [rect(30, 5, 2.5, (-1, 0)), fill(hexc(line_c or P['tabLine']))]),
        group('icon', [ellipse(11, 11, (-25, 0)),
                       gfill(BLUE, PURPLE, (-30, -5), (-20, 5)) if brand else fill(hexc(line_c or P['tabLine']))]),
        group('body', [rect(TAB_W, TAB_H, 9), fill(active_fill)]),
    ]
    return items


def build(theme):
    P = PALETTE[theme]
    c = Comp()

    # ---------- 窗口投影（两层柔和的圆角块模拟阴影）
    c.add('shadow', [
        group('s2', [rect(400, 236, 26, (280, 186)), fill(hexc(P['shadow']), P['shadowO'] * .5)]),
        group('s1', [rect(396, 234, 24, (280, 180)), fill(hexc(P['shadow']), P['shadowO'])]),
    ])
    # ---------- 窗口
    c.add('window', [
        group('edge', [rect(393, 233, 20.5, (280, 172)), stroke(P['winEdge'], 1, P['winEdgeO'])]),
        group('sep', [poly([(84, 96), (476, 96)]), stroke(P['winEdge'], 1, P['winEdgeO'])]),
        group('addr', [rect(280, 18, 9, (296, 114)), fill(hexc(P['addr']))]),
        group('chrome', [rect(392, 40, 20, (280, 76)), rect(392, 20, 0, (280, 86)), fill(hexc(P['chrome']))]),
        group('body', [rect(392, 232, 20, (280, 172)), fill(hexc(P['win']))]),
    ])
    # 交通灯
    c.add('lights', [group(f'd{i}', [ellipse(10, 10, (104 + i * 15, TAB_Y)), fill(hexc(col), P['dotsO'])])
                     for i, col in enumerate(P['dots'])])

    # ---------- 页面 A：被关掉又找回的那一页（品牌蓝紫）
    pageA_o = anim([(0, 100, 'soft'), (T_CLOSE + 4, 100, 'soft'), (T_CLOSE + 22, 0, 'hold'),
                    (T_LAND - 8, 0, 'soft'), (T_LAND + 18, 100, 'hold'), (OP, 100, 'lin')])
    c.add('pageA', [
        group('hero', [
            group('orb', [ellipse(34, 34, (148, 168)), fill(hexc(P['heroDot']), 85)]),
            group('bar', [rect(70, 7, 3.5, (178, 200)), fill(hexc(P['heroDot']), 70)]),
            rect(168, 84, 14, (196, 182)), gfill(hexc(P['hero1']), hexc(P['hero2']), (112, 140), (280, 224))]),
        group('l1', [rect(140, 8, 4, (370, 150)), fill(hexc(P['line']))]),
        group('l2', [rect(120, 8, 4, (360, 166)), fill(hexc(P['line']))]),
        group('l3', [rect(92, 8, 4, (346, 182)), fill(hexc(P['line']))]),
        group('l4', [rect(140, 8, 4, (370, 210)), fill(hexc(P['line']))]),
        group('c1', [rect(168, 30, 10, (196, 252)), fill(hexc(P['line']))]),
        group('c2', [rect(140, 30, 10, (370, 252)), fill(hexc(P['line']))]),
    ], o=pageA_o)

    # ---------- 页面 B：关掉之后露出的另一个标签
    pageB_o = anim([(0, 0, 'soft'), (T_CLOSE + 6, 0, 'soft'), (T_CLOSE + 24, 100, 'hold'),
                    (T_LAND - 8, 100, 'soft'), (T_LAND + 6, 0, 'hold'), (OP, 0, 'lin')])
    c.add('pageB', [
        group('block', [rect(352, 58, 12, (280, 162)), fill(hexc(P['blockB']))]),
        group('b1', [rect(300, 8, 4, (254, 210)), fill(hexc(P['lineB']))]),
        group('b2', [rect(250, 8, 4, (229, 226)), fill(hexc(P['lineB']))]),
        group('b3', [rect(196, 8, 4, (202, 242)), fill(hexc(P['lineB']))]),
        group('b4', [rect(120, 8, 4, (164, 258)), fill(hexc(P['lineB']))]),
    ], o=pageB_o)

    # ---------- 标签 1、2（标签 2 在中途变成当前标签）
    c.add('tab1', tab_shapes(P, sv(hexc(P['tab']))), p=(TABS_X[0], TAB_Y))
    tab2_fill = anim([(0, hexc(P['tab']), 'soft'), (T_CLOSE + 4, hexc(P['tab']), 'soft'), (T_CLOSE + 20, hexc(P['tabActive']), 'hold'),
                      (T_LAND - 4, hexc(P['tabActive']), 'soft'), (T_LAND + 10, hexc(P['tab']), 'hold'), (OP, hexc(P['tab']), 'lin')])
    c.add('tab2', tab_shapes(P, tab2_fill), p=(TABS_X[1], TAB_Y))

    # ---------- 标签 3：被关闭 → 找回（弹性落定）
    tab3_s = anim([(0, [100, 100], 'soft'), (T_CLOSE, [100, 100], 'in'), (T_CLOSE + 12, [40, 40], 'hold'),
                   (T_LAND - 2, [40, 40], 'back'), (T_LAND + 10, [104, 104], 'soft'), (T_LAND + 20, [99, 99], 'soft'),
                   (T_SETTLE + 6, [100, 100], 'hold'), (OP, [100, 100], 'lin')])
    tab3_o = anim([(0, 100, 'soft'), (T_CLOSE, 100, 'in'), (T_CLOSE + 10, 0, 'hold'),
                   (T_LAND - 2, 0, 'out'), (T_LAND + 6, 100, 'hold'), (OP, 100, 'lin')])
    c.add('tab3', tab_shapes(P, sv(hexc(P['tabActive'])), brand=True, line_c=P['tabLineActive']),
          p=(TABS_X[2], TAB_Y), s=tab3_s, o=tab3_o)

    # 落定时的光圈
    c.add('tab3-glow', [group('ring', [rect(TAB_W + 6, TAB_H + 6, 12), stroke(MID, 2)])],
          p=(TABS_X[2], TAB_Y),
          s=anim([(0, [100, 100], 'hold'), (T_LAND + 4, [100, 100], 'out'), (T_LAND + 44, [124, 150], 'hold'), (OP, [124, 150], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_LAND + 4, 70, 'soft'), (T_LAND + 44, 0, 'hold'), (OP, 0, 'lin')]))

    # ---------- 幽灵标签：关闭时沿弧线落进下方（「历史」），恢复时从按键处飞回
    ghost = [group('edge', [rect(TAB_W + 1, TAB_H + 1, 9.5), stroke(MID, 1.4, 55)])] + \
        tab_shapes(P, sv(hexc(P['tabActive'])), brand=True, line_c=P['tabLineActive']) + \
        [group('halo', [rect(TAB_W + 14, TAB_H + 14, 15), fill(MID, 10)])]
    c.add('ghost-out', ghost,
          p=panim([(0, [TABS_X[2], TAB_Y], 'hold'), (T_CLOSE + 2, [TABS_X[2], TAB_Y], 'in', [12, 40], [70, -30]),
                   (T_GHOST_END, list(HUD_P), 'hold'), (OP, list(HUD_P), 'lin')]),
          s=anim([(0, [100, 100], 'hold'), (T_CLOSE + 2, [100, 100], 'in'), (T_GHOST_END, [34, 34], 'hold'), (OP, [34, 34], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_CLOSE - 1, 0, 'out'), (T_CLOSE + 6, 85, 'soft'), (T_GHOST_END - 18, 60, 'in'), (T_GHOST_END, 0, 'hold'), (OP, 0, 'lin')]),
          r=anim([(0, 0, 'hold'), (T_CLOSE + 2, 0, 'in'), (T_GHOST_END, -14, 'hold'), (OP, -14, 'lin')]))
    c.add('ghost-in', ghost,
          p=panim([(0, list(HUD_P), 'hold'), (T_FLY, list(HUD_P), 'out', [10, -70], [-40, 40]),
                   (T_LAND, [TABS_X[2], TAB_Y], 'hold'), (OP, [TABS_X[2], TAB_Y], 'lin')]),
          s=anim([(0, [34, 34], 'hold'), (T_FLY, [34, 34], 'out'), (T_LAND, [100, 100], 'hold'), (OP, [100, 100], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_FLY, 0, 'out'), (T_FLY + 8, 90, 'soft'), (T_LAND - 4, 90, 'soft'), (T_LAND + 4, 0, 'hold'), (OP, 0, 'lin')]),
          r=anim([(0, -14, 'hold'), (T_FLY, -14, 'out'), (T_LAND, 0, 'hold'), (OP, 0, 'lin')]))

    # ---------- 光标：移到关闭叉 → 点击 → 离开
    arrow = [(0, 0), (0, 17.5), (4.6, 13.4), (7.6, 20.2), (10.4, 19), (7.4, 12.4), (13.4, 12.4)]
    c.add('cursor', [group('arrow', [poly(arrow, True), fill(hexc(P['cursor'])), stroke(hexc(P['cursorEdge']), 1.3)])],
          p=panim([(0, [470, 250], 'hold'), (T_CURSOR_IN, [470, 250], 'out', [-30, -60], [40, 40]),
                   (T_CLICK - 6, [CLOSE_X + 1, TAB_Y + 1], 'hold'), (T_CLICK + 14, [CLOSE_X + 1, TAB_Y + 1], 'soft', [20, 40], [-10, -30]),
                   (T_GHOST_END - 4, [486, 214], 'hold'), (OP, [486, 214], 'lin')]),
          s=anim([(0, [100, 100], 'hold'), (T_CLICK - 2, [100, 100], 'soft'), (T_CLICK + 3, [84, 84], 'out'),
                  (T_CLICK + 12, [100, 100], 'hold'), (OP, [100, 100], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_CURSOR_IN, 0, 'soft'), (T_CURSOR_IN + 10, 100, 'hold'),
                  (T_GHOST_END - 18, 100, 'soft'), (T_GHOST_END - 4, 0, 'hold'), (OP, 0, 'lin')]))
    # 点击涟漪
    c.add('click-ring', [group('ring', [ellipse(20, 20), stroke(MID, 1.6)])], p=(CLOSE_X, TAB_Y),
          s=anim([(0, [30, 30], 'hold'), (T_CLICK, [30, 30], 'out'), (T_CLICK + 26, [140, 140], 'hold'), (OP, [140, 140], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_CLICK - 2, 0, 'out'), (T_CLICK + 3, 80, 'soft'), (T_CLICK + 26, 0, 'hold'), (OP, 0, 'lin')]))

    # ---------- 按键 Alt + Z：一块悬浮面板从下方浮起（与第二幕的提示胶囊同一位置、同一种材质），依次按下
    # 不使用父子图层：每个图层直接写绝对位置（Lottie 对「父图层静止 + 子图层首次显示」的变换刷新不可靠）
    KX, KY = KEYS_P
    RISE, SINK = 14, 10

    def kp(dx=0.0, dy=0.0, press=None):
        """面板整体的浮起/沉下 + 可选的按下位移，合成一条绝对位置关键帧"""
        keys = [(0, RISE, 'hold'), (T_KEYS_IN, RISE, 'out'), (T_KEYS_IN + 24, 0, 'hold')]
        if press:
            t0 = press
            keys += [(t0, 0, 'out'), (t0 + 5, 2.5, 'hold'), (T_RELEASE, 2.5, 'back'), (T_RELEASE + 14, 0, 'hold')]
        keys += [(T_KEYS_OUT, 0, 'in'), (T_KEYS_OUT + 18, SINK, 'hold'), (OP, SINK, 'lin')]
        return anim([(t, [KX + dx, KY + dy + v], e) for t, v, e in keys])

    keys_o = anim([(0, 0, 'hold'), (T_KEYS_IN, 0, 'soft'), (T_KEYS_IN + 16, 100, 'hold'),
                   (T_KEYS_OUT, 100, 'soft'), (T_KEYS_OUT + 14, 0, 'hold'), (OP, 0, 'lin')])
    keys_s = anim([(0, [96, 96], 'hold'), (T_KEYS_IN, [96, 96], 'out'), (T_KEYS_IN + 24, [100, 100], 'hold'),
                   (T_KEYS_OUT, [100, 100], 'in'), (T_KEYS_OUT + 18, [97, 97], 'hold'), (OP, [97, 97], 'lin')])
    plate = '#FFFFFF' if theme == 'light' else '#2B2C35'
    c.add('keys-plate', [
        group('edge', [rect(PLATE_W, PLATE_H, 20, (PLATE_CX, PLATE_CY)), stroke(P['winEdge'], 1, P['winEdgeO'] + 2)]),
        group('body', [rect(PLATE_W, PLATE_H, 20, (PLATE_CX, PLATE_CY)), fill(hexc(plate))]),
        group('s', [rect(PLATE_W + 6, PLATE_H + 2, 22, (PLATE_CX, PLATE_CY + 6)), fill(hexc(P['shadow']), P['shadowO'] * 1.4)]),
        group('s2', [rect(PLATE_W + 14, PLATE_H + 8, 25, (PLATE_CX, PLATE_CY + 10)), fill(hexc(P['shadow']), P['shadowO'] * .6)]),
    ], p=kp(), s=keys_s, o=keys_o)

    def key(nm, w, cx, legend, t_press):
        c.add(nm + '-base', [
            group('base', [rect(w, 40, 11, (cx, 3)), fill(hexc(P['keyBase']))]),
        ], p=kp(), s=keys_s, o=keys_o)
        ink = anim([(0, hexc(P['legend']), 'hold'), (t_press, hexc(P['legend']), 'soft'), (t_press + 6, MID, 'hold'),
                    (T_RELEASE + 8, MID, 'soft'), (T_RELEASE + 26, hexc(P['legend']), 'hold'), (OP, hexc(P['legend']), 'lin')])
        glow = anim([(0, 0, 'hold'), (t_press, 0, 'soft'), (t_press + 6, 100, 'hold'),
                     (T_RELEASE + 8, 100, 'soft'), (T_RELEASE + 26, 0, 'hold'), (OP, 0, 'lin')])
        c.add(nm + '-top', [
            group('legend', [*legend, stroke(ink, 2.1)], p=(cx, -1)),
            group('edge', [rect(w - 1, 37, 9.5, (cx, -1)), stroke(P['keyEdge'], 1, P['keyEdgeO'])]),
            group('lit', [rect(w, 38, 10, (cx, -1)), gfill(hexc('#EAF1FF') if theme == 'light' else hexc('#2C3556'),
                                                            hexc('#EFEAFF') if theme == 'light' else hexc('#352E5C'), (cx - w / 2, -20), (cx + w / 2, 20), glow)]),
            group('top', [rect(w, 38, 10, (cx, -1)), fill(hexc(P['keyTop']))]),
        ], p=kp(press=t_press), s=keys_s, o=keys_o)

    alt = [poly([(-11, 6), (-7, -6), (-3, 6)]), poly([(-9.6, 2), (-4.4, 2)]),
           poly([(2.5, -7), (2.5, 6)]),
           poly([(8, -5.5), (8, 4), (9.6, 6), (11.6, 6)]), poly([(5.8, -2), (11, -2)])]
    zed = [poly([(-5.5, -6), (5.5, -6), (-5.5, 6), (5.5, 6)])]
    key('alt', 66, KEY_ALT_X, alt, T_ALT)
    key('z', 48, KEY_Z_X, zed, T_Z)

    # 两键都按下的一瞬：面板外圈扩散
    c.add('key-ripple', [group('ring', [rect(PLATE_W, PLATE_H, 20), stroke(MID, 1.6)])], p=(KX + PLATE_CX, KY + PLATE_CY),
          s=anim([(0, [100, 100], 'hold'), (T_Z + 4, [100, 100], 'out'), (T_Z + 40, [116, 136], 'hold'), (OP, [116, 136], 'lin')]),
          o=anim([(0, 0, 'hold'), (T_Z + 2, 0, 'out'), (T_Z + 7, 55, 'soft'), (T_Z + 40, 0, 'hold'), (OP, 0, 'lin')]))

    # ---------- 落定后的勾：品牌渐变圆 + 描出的对勾
    badge_s = anim([(0, [0, 0], 'hold'), (T_LAND + 8, [0, 0], 'back'), (T_LAND + 28, [100, 100], 'hold'),
                    (T_BADGE_OUT, [100, 100], 'in'), (T_BADGE_OUT + 14, [60, 60], 'hold'), (OP, [60, 60], 'lin')])
    badge_o = anim([(0, 0, 'hold'), (T_LAND + 8, 0, 'soft'), (T_LAND + 16, 100, 'hold'),
                    (T_BADGE_OUT, 100, 'soft'), (T_BADGE_OUT + 14, 0, 'hold'), (OP, 0, 'lin')])
    tick_e = anim([(0, 0, 'hold'), (T_LAND + 18, 0, 'out'), (T_LAND + 40, 100, 'hold'), (OP, 100, 'lin')])
    c.add('badge', [
        group('tick', [poly([(-5, 0.5), (-1.5, 4), (5.5, -3.5)]), trim(0, tick_e), stroke(hexc(P['badgeTick']), 2.4)]),
        group('disc', [ellipse(26, 26), gfill(BLUE, PURPLE, (-13, -13), (13, 13))]),
        group('halo', [ellipse(34, 34), fill(MID, 18)]),
    ], p=(TABS_X[2] + TAB_W / 2 + 3, TAB_Y - 17), s=badge_s, o=badge_o)

    STATIC = {'shadow', 'window', 'lights', 'tab1'}
    for L in c.layers:
        if L['nm'] not in STATIC:
            L['op'] = ACT4
    act_gesture(c, P, theme, arrow)
    return c.json(f'restore-guide-{theme}')


def act_gesture(c, P, theme, arrow):
    """第二幕：鼠标手势。关掉一个标签（与第一幕同样落进下方）→ 按住右键 → 画一个 Z（轨迹 + 实时点亮的提示胶囊）→ 松开，标签从胶囊飞回"""
    G = ACT4
    k = lambda *pairs: anim([(0, pairs[0][1], 'hold')] + [(G + t, v, e) for t, v, e in pairs] + [(OP, pairs[-1][1], 'lin')])
    pk = lambda *items: panim([(0, items[0][1], 'hold')] + [(G + it[0], *it[1:]) for it in items] + [(OP, items[-1][1], 'lin')])
    L = dict(ip=G, op=OP)

    T_CLK, T_CLS = 34, 38            # 点关闭
    T_PRESS = 72                     # 按下右键
    T_D0, T_D1 = 80, 134             # 画 Z
    T_REL = 142                      # 松开
    T_FLY0, T_FLY1 = 150, 176        # 标签飞回
    HUD = HUD_P
    ZA, ZB, ZC, ZD = (204, 134), (356, 134), (204, 212), (356, 212)
    zpts = [ZA, ZB, ZC, ZD]
    L1 = ZB[0] - ZA[0]
    L2 = ((ZB[0] - ZC[0]) ** 2 + (ZB[1] - ZC[1]) ** 2) ** .5
    tot = L1 * 2 + L2
    f1 = T_D0 + (T_D1 - T_D0) * L1 / tot
    f2 = T_D0 + (T_D1 - T_D0) * (L1 + L2) / tot

    # ---------- 页面：A 被关掉、露出 B；松开后 A 回来
    c.add('g-pageB', [
        group('block', [rect(352, 58, 12, (280, 162)), fill(hexc(P['blockB']))]),
        group('b1', [rect(300, 8, 4, (254, 210)), fill(hexc(P['lineB']))]),
        group('b2', [rect(250, 8, 4, (229, 226)), fill(hexc(P['lineB']))]),
        group('b3', [rect(196, 8, 4, (202, 242)), fill(hexc(P['lineB']))]),
        group('b4', [rect(120, 8, 4, (164, 258)), fill(hexc(P['lineB']))]),
    ], o=k((T_CLS + 4, 0, 'soft'), (T_CLS + 22, 100, 'hold'), (T_FLY1 - 8, 100, 'soft'), (T_FLY1 + 8, 0, 'hold')), **L)
    c.add('g-pageA', [
        group('hero', [
            group('orb', [ellipse(34, 34, (148, 168)), fill(hexc(P['heroDot']), 85)]),
            group('bar', [rect(70, 7, 3.5, (178, 200)), fill(hexc(P['heroDot']), 70)]),
            rect(168, 84, 14, (196, 182)), gfill(hexc(P['hero1']), hexc(P['hero2']), (112, 140), (280, 224))]),
        group('l1', [rect(140, 8, 4, (370, 150)), fill(hexc(P['line']))]),
        group('l2', [rect(120, 8, 4, (360, 166)), fill(hexc(P['line']))]),
        group('l3', [rect(92, 8, 4, (346, 182)), fill(hexc(P['line']))]),
        group('l4', [rect(140, 8, 4, (370, 210)), fill(hexc(P['line']))]),
        group('c1', [rect(168, 30, 10, (196, 252)), fill(hexc(P['line']))]),
        group('c2', [rect(140, 30, 10, (370, 252)), fill(hexc(P['line']))]),
    ], o=k((T_CLS + 2, 100, 'soft'), (T_CLS + 18, 0, 'hold'), (T_FLY1 - 8, 0, 'soft'), (T_FLY1 + 16, 100, 'hold')), **L)
    tab2_fill = k((T_CLS + 2, hexc(P['tab']), 'soft'), (T_CLS + 16, hexc(P['tabActive']), 'hold'),
                  (T_FLY1 - 2, hexc(P['tabActive']), 'soft'), (T_FLY1 + 10, hexc(P['tab']), 'hold'))
    c.add('g-tab2', tab_shapes(P, tab2_fill), p=(TABS_X[1], TAB_Y), **L)

    tab3_s = k((T_CLS, [100, 100], 'in'), (T_CLS + 10, [40, 40], 'hold'), (T_FLY1 - 2, [40, 40], 'back'),
               (T_FLY1 + 10, [104, 104], 'soft'), (T_FLY1 + 20, [99, 99], 'soft'), (T_FLY1 + 30, [100, 100], 'hold'))
    tab3_o = k((T_CLS, 100, 'in'), (T_CLS + 8, 0, 'hold'), (T_FLY1 - 2, 0, 'out'), (T_FLY1 + 6, 100, 'hold'))
    c.add('g-tab3', tab_shapes(P, sv(hexc(P['tabActive'])), brand=True, line_c=P['tabLineActive']),
          p=(TABS_X[2], TAB_Y), s=tab3_s, o=tab3_o, **L)
    c.add('g-tab3-glow', [group('ring', [rect(TAB_W + 6, TAB_H + 6, 12), stroke(MID, 2)])], p=(TABS_X[2], TAB_Y),
          s=k((T_FLY1 + 4, [100, 100], 'out'), (T_FLY1 + 44, [124, 150], 'hold')),
          o=k((T_FLY1 + 2, 0, 'hold'), (T_FLY1 + 4, 70, 'soft'), (T_FLY1 + 44, 0, 'hold')), **L)
    c.add('g-click', [group('ring', [ellipse(20, 20), stroke(MID, 1.6)])], p=(CLOSE_X, TAB_Y),
          s=k((T_CLK, [30, 30], 'out'), (T_CLK + 26, [140, 140], 'hold')),
          o=k((T_CLK - 2, 0, 'out'), (T_CLK + 3, 80, 'soft'), (T_CLK + 26, 0, 'hold')), **L)

    # ---------- 关闭时：标签沿弧线落进下方（落点就是稍后提示胶囊出现的位置，和第一幕的键帽同一种语言）
    ghost_out = [group('edge', [rect(TAB_W + 1, TAB_H + 1, 9.5), stroke(MID, 1.4, 55)])] + \
        tab_shapes(P, sv(hexc(P['tabActive'])), brand=True, line_c=P['tabLineActive']) + \
        [group('halo', [rect(TAB_W + 14, TAB_H + 14, 15), fill(MID, 10)])]
    T_OUT = T_CLS + 46
    c.add('g-ghost-out', ghost_out,
          p=pk((T_CLS + 2, [TABS_X[2], TAB_Y], 'in', [12, 40], [70, -30]), (T_OUT, list(HUD), 'hold')),
          s=k((T_CLS + 2, [100, 100], 'in'), (T_OUT, [34, 34], 'hold')),
          o=k((T_CLS - 1, 0, 'out'), (T_CLS + 6, 85, 'soft'), (T_OUT - 18, 60, 'in'), (T_OUT, 0, 'hold')),
          r=k((T_CLS + 2, 0, 'in'), (T_OUT, -14, 'hold')), **L)

    # ---------- 轨迹：品牌渐变 + 柔光，松开时从起笔处收进胶囊
    trim_e = k((T_D0, 0, 'lin'), (f1, 100 * L1 / tot, 'lin'), (f2, 100 * (L1 + L2) / tot, 'lin'), (T_D1, 100, 'hold'))
    trim_s = k((T_REL, 0, 'inout'), (T_REL + 22, 100, 'hold'))
    trail_o = k((T_D0 - 1, 0, 'hold'), (T_D0, 100, 'hold'), (T_REL + 16, 100, 'soft'), (T_REL + 24, 0, 'hold'))
    trail_w = k((T_D1 - 2, 4, 'back'), (T_D1 + 6, 5.2, 'soft'), (T_REL + 12, 4.4, 'hold'))
    c.add('g-trail', [
        group('core', [poly(zpts), trim(trim_s, trim_e), gstroke(BLUE, PURPLE, (ZA[0], 0), (ZD[0], 0), trail_w)]),
        group('glow', [poly(zpts), trim(trim_s, trim_e), stroke(MID, 14, 13)]),
    ], o=trail_o, **L)
    # 识别成功的一瞬：Z 外圈扩散
    c.add('g-zring', [group('ring', [rect(186, 106, 32), stroke(MID, 1.6)])], p=((ZA[0] + ZD[0]) / 2, (ZA[1] + ZD[1]) / 2),
          s=k((T_D1, [96, 96], 'out'), (T_D1 + 34, [114, 126], 'hold')),
          o=k((T_D1 - 1, 0, 'out'), (T_D1 + 4, 32, 'soft'), (T_D1 + 34, 0, 'hold')), **L)

    # ---------- 提示胶囊：Z 图标按笔画点亮 → 识别 → 松开后打勾
    hud_s = k((T_D0 + 10, [96, 96], 'out'), (T_D0 + 34, [100, 100], 'hold'), (T_D1, [100, 100], 'back'),
              (T_D1 + 8, [103, 103], 'soft'), (T_D1 + 18, [100, 100], 'hold'), (196, [100, 100], 'in'), (212, [94, 94], 'hold'))
    hud_o = k((T_D0 + 10, 0, 'soft'), (T_D0 + 22, 100, 'hold'), (196, 100, 'soft'), (212, 0, 'hold'))
    hud_p = k((T_D0 + 10, [HUD[0], HUD[1] + 14], 'out'), (T_D0 + 34, list(HUD), 'hold'), (196, list(HUD), 'in'), (214, [HUD[0], HUD[1] + 10], 'hold'))
    body = '#FFFFFF' if theme == 'light' else '#2B2C35'
    TX = -56
    lit_on = k((T_D1, 0, 'hold'), (T_D1 + 1, 0, 'soft'), (T_D1 + 8, 100, 'hold'))
    mz = [(TX - 5.5, -4.5), (TX + 5.5, -4.5), (TX - 5.5, 4.5), (TX + 5.5, 4.5)]
    glyph_o = k((T_REL + 2, 100, 'soft'), (T_REL + 10, 0, 'hold'))
    tick = k((T_REL + 8, 0, 'out'), (T_REL + 24, 100, 'hold'))
    # 同一图层里的分组：分组透明度会与图层透明度相乘，整颗胶囊一起出现、一起消失
    c.add('g-hud', [
        group('tick', [poly([(TX - 4.5, 0.5), (TX - 1.2, 3.8), (TX + 5, -3.4)]), trim(0, tick), stroke(hexc('#FFFFFF'), 2.1)]),
        group('zwhite', [poly(mz), stroke(hexc('#FFFFFF'), 1.9)],
              o=k((T_D1, 0, 'soft'), (T_D1 + 6, 100, 'hold'), (T_REL + 2, 100, 'soft'), (T_REL + 10, 0, 'hold'))),
        group('zlit', [poly(mz), trim(0, trim_e), stroke(MID, 1.9)], o=k((T_D1, 100, 'soft'), (T_D1 + 6, 0, 'hold'))),
        group('zbase', [poly(mz), stroke(hexc(P['tabLine']), 1.7)], o=glyph_o),
        # 右侧：将要回来的那一页（图标 + 标题），识别后由灰转实
        group('real', [
            group('fav', [ellipse(9, 9, (-32, -4.5)), gfill(BLUE, PURPLE, (-36, -9), (-28, 0))]),
            group('t1', [rect(60, 6, 3, (7, -4.5)), fill(hexc(P['tabLineActive']))]),
            group('t2', [rect(46, 5, 2.5, (-14, 6)), fill(hexc(P['tabLine']))]),
            group('one', [poly([(57, -3.5), (59, -5), (59, 5)]), stroke(MID, 1.5)]),
            group('n', [rect(18, 16, 8, (58, 0)), fill(MID, 14)]),
        ], o=k((T_D1, 0, 'soft'), (T_D1 + 10, 100, 'hold')), p=k((T_D1, [-6, 0], 'out'), (T_D1 + 14, [0, 0], 'hold'))),
        group('ghost', [
            group('t1', [rect(70, 6, 3, (-2, -4.5)), fill(hexc(P['tabLine']), 70)]),
            group('t2', [rect(46, 5, 2.5, (-14, 6)), fill(hexc(P['lineB']))]),
        ], o=k((T_D1, 100, 'soft'), (T_D1 + 10, 0, 'hold'))),
        group('tile-brand', [rect(24, 24, 8, (TX, 0)), gfill(BLUE, PURPLE, (TX - 12, -12), (TX + 12, 12))], o=lit_on),
        group('tile-soft', [rect(24, 24, 8, (TX, 0)), fill(MID, 14)]),
        group('edge', [rect(150, 34, 17), stroke(P['winEdge'], 1, P['winEdgeO'] + 2)]),
        group('body', [rect(150, 34, 17), fill(hexc(body))]),
        group('s', [rect(156, 36, 18, (0, 5)), fill(hexc(P['shadow']), P['shadowO'] * 1.4)]),
        group('s2', [rect(164, 42, 21, (0, 8)), fill(hexc(P['shadow']), P['shadowO'] * .6)]),
    ], p=hud_p, s=hud_s, o=hud_o, **L)

    # ---------- 光标：点关闭 → 移到起笔处 → 沿 Z 画 → 松开后离开
    c.add('g-cursor', [group('arrow', [poly(arrow, True), fill(hexc(P['cursor'])), stroke(hexc(P['cursorEdge']), 1.3)])],
          p=pk((4, [470, 250], 'out', [-30, -60], [40, 40]), (T_CLK - 4, [CLOSE_X + 1, TAB_Y + 1], 'hold'),
               (T_CLK + 12, [CLOSE_X + 1, TAB_Y + 1], 'inout', [-60, 10], [60, -30]),
               (T_D0 - 4, list(ZA), 'hold'), (T_D0, list(ZA), 'lin'), (f1, list(ZB), 'lin'), (f2, list(ZC), 'lin'),
               (T_D1, list(ZD), 'hold'), (T_REL + 4, list(ZD), 'soft', [10, 10], [-10, -10]), (T_REL + 30, [ZD[0] + 34, ZD[1] + 20], 'hold')),
          s=k((T_CLK - 2, [100, 100], 'soft'), (T_CLK + 3, [84, 84], 'out'), (T_CLK + 12, [100, 100], 'hold')),
          o=k((4, 0, 'soft'), (14, 100, 'hold'), (T_REL + 10, 100, 'soft'), (T_REL + 30, 0, 'hold')), **L)
    # 笔尖的光点
    c.add('g-tip', [group('dot', [ellipse(9, 9), fill(hexc('#FFFFFF')), stroke(MID, 1.8)]),
                    group('glow', [ellipse(22, 22), fill(MID, 22)])],
          p=pk((T_D0, list(ZA), 'lin'), (f1, list(ZB), 'lin'), (f2, list(ZC), 'lin'), (T_D1, list(ZD), 'hold')),
          s=k((T_D1 - 2, [100, 100], 'out'), (T_D1 + 6, [136, 136], 'soft'), (T_REL + 14, [96, 96], 'hold')),
          o=k((T_D0 - 1, 0, 'hold'), (T_D0, 100, 'hold'), (T_REL + 6, 100, 'soft'), (T_REL + 16, 0, 'hold')), **L)

    # ---------- 窗口右侧的鼠标：右键按下时亮起
    MP = (514, 246)
    # 同样不用父子图层：各部件直接写绝对位置
    mpos = lambda dx=0, dy=0: k((44, [MP[0] + dx, MP[1] + 24 + dy], 'out'), (70, [MP[0] + dx, MP[1] + dy], 'hold'),
                                (204, [MP[0] + dx, MP[1] + dy], 'in'), (222, [MP[0] + dx, MP[1] + 16 + dy], 'hold'))
    mouse_p = mpos()
    mouse_o = k((44, 0, 'soft'), (60, 100, 'hold'), (204, 100, 'soft'), (220, 0, 'hold'))
    c.add('g-mouse-shadow', [group('s', [rect(36, 52, 18, (0, 5)), fill(hexc(P['shadow']), P['shadowO'] * 1.5)])], p=mouse_p, o=mouse_o, **L)
    press = k((T_PRESS, [100, 100], 'out'), (T_PRESS + 5, [93, 93], 'hold'), (T_REL, [93, 93], 'back'), (T_REL + 12, [100, 100], 'hold'))
    lit = k((T_PRESS, 0, 'soft'), (T_PRESS + 5, 100, 'hold'), (T_REL, 100, 'soft'), (T_REL + 12, 0, 'hold'))
    c.add('g-mouse-body', [
        group('wheel', [rect(3.4, 8, 1.7, (0, -11.5)), fill(hexc(P['tabLineActive']))]),
        group('split', [poly([(0, -23), (0, -4)]), poly([(-15.5, -4), (15.5, -4)]), stroke(hexc(P['tabLine']), 1.2, 80)]),
        group('edge', [rect(31, 46, 15.5), stroke(P['winEdge'], 1, P['winEdgeO'] + 4)]),
        group('body', [rect(31, 46, 15.5), fill(hexc(P['keyTop']))]),
    ], p=mouse_p, o=mouse_o, **L)
    c.add('g-mouse-right', [group('btn', [rect(12.4, 15.2, 5.2, (8.6, -13.4)), gfill(BLUE, PURPLE, (2, -21), (15, -6), lit)])],
          s=press, a=(8.6, -13.4), p=mpos(8.6, -13.4), o=mouse_o, **L)
    c.add('g-mouse-ring', [group('ring', [ellipse(16, 16), stroke(MID, 1.6)])], p=mpos(8.6, -13.4),
          s=k((T_PRESS, [60, 60], 'out'), (T_PRESS + 30, [240, 240], 'hold'), (T_PRESS + 36, [60, 60], 'out'), (T_PRESS + 66, [240, 240], 'hold')),
          o=k((T_PRESS - 1, 0, 'out'), (T_PRESS + 4, 70, 'soft'), (T_PRESS + 30, 0, 'hold'), (T_PRESS + 35, 0, 'out'), (T_PRESS + 40, 50, 'soft'), (T_PRESS + 66, 0, 'hold')), **L)

    # ---------- 幽灵标签：从胶囊飞回原位
    ghost = [group('edge', [rect(TAB_W + 1, TAB_H + 1, 9.5), stroke(MID, 1.4, 55)])] + \
        tab_shapes(P, sv(hexc(P['tabActive'])), brand=True, line_c=P['tabLineActive']) + \
        [group('halo', [rect(TAB_W + 14, TAB_H + 14, 15), fill(MID, 10)])]
    c.add('g-ghost', ghost,
          p=pk((T_FLY0, list(HUD), 'out', [40, -60], [-30, 70]), (T_FLY1, [TABS_X[2], TAB_Y], 'hold')),
          s=k((T_FLY0, [30, 30], 'out'), (T_FLY1, [100, 100], 'hold')),
          o=k((T_FLY0 - 1, 0, 'hold'), (T_FLY0, 0, 'out'), (T_FLY0 + 6, 90, 'soft'), (T_FLY1 - 4, 90, 'soft'), (T_FLY1 + 4, 0, 'hold')),
          r=k((T_FLY0, -10, 'out'), (T_FLY1, 0, 'hold')), **L)

    # ---------- 落定后的勾
    badge_s = k((T_FLY1 + 8, [0, 0], 'back'), (T_FLY1 + 28, [100, 100], 'hold'), (236, [100, 100], 'in'), (250, [60, 60], 'hold'))
    badge_o = k((T_FLY1 + 8, 0, 'soft'), (T_FLY1 + 16, 100, 'hold'), (236, 100, 'soft'), (250, 0, 'hold'))
    tick_e = k((T_FLY1 + 18, 0, 'out'), (T_FLY1 + 40, 100, 'hold'))
    c.add('g-badge', [
        group('tick', [poly([(-5, 0.5), (-1.5, 4), (5.5, -3.5)]), trim(0, tick_e), stroke(hexc(P['badgeTick']), 2.4)]),
        group('disc', [ellipse(26, 26), gfill(BLUE, PURPLE, (-13, -13), (13, 13))]),
        group('halo', [ellipse(34, 34), fill(MID, 18)]),
    ], p=(TABS_X[2] + TAB_W / 2 + 3, TAB_Y - 17), s=badge_s, o=badge_o, **L)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for theme in ('light', 'dark'):
        data = build(theme)
        path = os.path.join(OUT, f'lottie-{theme}.json')
        with open(path, 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        print(path, os.path.getsize(path), 'bytes,', len(data['layers']), 'layers')
