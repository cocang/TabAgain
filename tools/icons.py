"""由用户提供的 LOGO（assets/logo-source.webp，512×512 透明底）生成扩展图标与商店素材
运行：python3 tools/icons.py"""
import os
from PIL import Image, ImageFilter, ImageDraw, ImageFont
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = Image.open(os.path.join(ROOT, 'assets', 'logo-source.webp')).convert('RGBA')
ICONS = os.path.join(ROOT, 'src', 'icons')
STORE = os.path.join(ROOT, 'assets', 'store')
os.makedirs(STORE, exist_ok=True)

def square(img, pad=0.0):
    """按不透明区域居中到正方形画布，可留边距（比例）"""
    box = img.split()[3].getbbox()
    art = img.crop(box)
    side = max(art.size)
    canvas_side = round(side / (1 - 2 * pad))
    c = Image.new('RGBA', (canvas_side, canvas_side), (0, 0, 0, 0))
    c.paste(art, ((canvas_side - art.width) // 2, (canvas_side - art.height) // 2), art)
    return c

def resize(img, n):
    # 分级缩小，小尺寸再轻度锐化，避免糊成一团
    cur = img
    while cur.width > n * 2:
        cur = cur.resize((cur.width // 2, cur.height // 2), Image.LANCZOS)
    out = cur.resize((n, n), Image.LANCZOS)
    if n <= 48:
        rgb, a = out.convert('RGB'), out.split()[3]
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=0.6 if n <= 16 else 0.8, percent=60 if n <= 16 else 45, threshold=1))
        out = Image.merge('RGBA', (*rgb.split(), a))
    return out

base = square(SRC)                       # 工具栏与扩展页：撑满
for n in (16, 32, 48, 128):
    resize(base, n).save(os.path.join(ICONS, f'icon-{n}.png'), optimize=True)
resize(base, 256).save(os.path.join(ICONS, 'logo-256.png'), optimize=True)   # 页面内大图（设置页头部、历史页）

# 商店图标：Chrome 要求 128×128 画布、图形约 96×96，四周留透明边
store_icon = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
art = resize(base, 96)
store_icon.paste(art, (16, 16), art)
store_icon.save(os.path.join(STORE, 'store-icon-128.png'), optimize=True)
resize(base, 512).save(os.path.join(STORE, 'icon-512.png'), optimize=True)

# 宣传图：浅色渐变底 + 图标 + 名称 + slogan
FONT_DIRS = [os.path.expanduser('~/.fonts'), '/usr/share/fonts', '/usr/local/share/fonts']
def find_font(names):
    for d in FONT_DIRS:
        for r, _, fs in os.walk(d):
            for f in fs:
                if any(f.lower().startswith(n.lower()) for n in names):
                    return os.path.join(r, f)
    return None
def promo(w, h, name, lang):
    img = Image.new('RGBA', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.6 + y / h * 0.4)
            r = round(246 + (240 - 246) * t); g = round(248 + (242 - 248) * t); b = 255
            px[x, y] = (r, g, b, 255)
    # 两团柔和的品牌色光
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((-w * .15, -h * .6, w * .55, h * .9), fill=(61, 139, 255, 46))
    d.ellipse((w * .55, h * .2, w * 1.2, h * 1.5), fill=(123, 92, 255, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) * .18))
    img = Image.alpha_composite(img, glow)
    s = round(h * .52)
    logo = resize(base, s)
    shadow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    lx, ly = round(w * .09), (h - s) // 2
    sh = Image.new('RGBA', logo.size, (40, 80, 220, 0)); sh.putalpha(logo.split()[3].point(lambda a: a * .3))
    shadow.paste(sh, (lx, ly + round(s * .06)), sh)
    shadow = shadow.filter(ImageFilter.GaussianBlur(s * .06))
    img = Image.alpha_composite(img, shadow)
    img.paste(logo, (lx, ly), logo)
    d = ImageDraw.Draw(img)
    sc = 'TC' if lang == 'zh_TW' else 'SC'
    bold = find_font([f'NotoSans{sc}-Bold', 'NotoSansCJK-Bold', 'DejaVuSans-Bold'])
    reg = find_font([f'NotoSans{sc}-Regular', 'NotoSansCJK-Regular', 'DejaVuSans'])
    tx = lx + s + round(w * .05)
    f1 = ImageFont.truetype(bold, round(min(h * .15, (w - tx - w * .07) / 4.6))) if bold else ImageFont.load_default()
    f2 = ImageFont.truetype(reg, round(min(h * .066, (w - tx - w * .07) / 13))) if reg else ImageFont.load_default()
    slogan = {'en': 'Bring closed tabs back.', 'zh_CN': '让关闭的标签页，再次回来', 'zh_TW': '讓關閉的分頁，再次回來'}[lang]
    d.text((tx, h * .5 - h * .03), 'TabAgain', font=f1, fill=(29, 29, 31, 255), anchor='ls')
    d.text((tx + 2, h * .5 + h * .1), slogan, font=f2, fill=(90, 94, 104, 255), anchor='ls')
    img.convert('RGB').save(os.path.join(STORE, name), optimize=True)

for lang in ('en', 'zh_CN', 'zh_TW'):
    promo(440, 280, f'promo-small-440x280-{lang}.png', lang)
    promo(1400, 560, f'promo-marquee-1400x560-{lang}.png', lang)
for f in sorted(os.listdir(ICONS)) + sorted(os.listdir(STORE)):
    print(f)
