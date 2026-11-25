"""打包 TabAgain：同一份源码 → Chrome（MV3 service worker）与 Firefox（MV3 event page）两个包
python3 tools/build.py  →  dist/TabAgain-<ver>-chrome.zip、dist/TabAgain-<ver>-firefox.zip（.xpi 同内容）"""
import json, os, shutil, zipfile
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')
SKIP = {'.DS_Store'}

def files():
    for d, _, fs in os.walk(SRC):
        for f in sorted(fs):
            if f in SKIP or f == 'manifest.json':
                continue
            full = os.path.join(d, f)
            yield full, os.path.relpath(full, SRC)

def firefox(m):
    m = json.loads(json.dumps(m))
    m['background'] = {'scripts': ['background.js'], 'type': 'module'}
    m.pop('minimum_chrome_version', None)
    m['permissions'] = [p for p in m['permissions'] if p not in ('favicon', 'tabGroups')]
    m['browser_specific_settings'] = {'gecko': {
        'id': 'tabagain@cocang',
        'strict_min_version': '140.0',
        'data_collection_permissions': {'required': ['none']}}}
    return m

def pack(name, manifest):
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, name)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        for full, rel in files():
            z.write(full, rel)
    return out

if __name__ == '__main__':
    m = json.load(open(os.path.join(SRC, 'manifest.json')))
    v = m['version']
    shutil.rmtree(DIST, ignore_errors=True)
    a = pack(f'TabAgain-{v}-chrome.zip', m)
    b = pack(f'TabAgain-{v}-firefox.zip', firefox(m))
    shutil.copy(b, b.replace('.zip', '.xpi'))
    # 解包目录，方便本地「加载已解压的扩展」与 web-ext / addons-linter
    for z, d in ((a, 'chrome'), (b, 'firefox')):
        zipfile.ZipFile(z).extractall(os.path.join(DIST, d))
    for f in sorted(os.listdir(DIST)):
        p = os.path.join(DIST, f)
        if os.path.isfile(p): print(f, os.path.getsize(p))
