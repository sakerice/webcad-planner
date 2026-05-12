#!/usr/bin/env python3
"""
Analyze sprite sheets and find tight bounding boxes for each 512x512 tile.
Outputs optimal crop coordinates and ISIZES verification vs JIS standards.
Run from the project root: python3 scripts/analyze_sprites.py
"""
import os, json, sys
try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("pip install Pillow numpy"); sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITE_JSON = os.path.join(ROOT, 'assets', 'japanese_floorplan_parts_sprite_gpt.json')
IMG1 = os.path.join(ROOT, 'assets', 'japanese_floorplan_parts_sprite_gpt.png')
IMG2 = os.path.join(ROOT, 'assets', 'japanese_floorplan_parts_sprite_gpt_2.png')

# Load sprite JSON
with open(SPRITE_JSON, 'r') as f:
    sprite_data = json.load(f)
sprites = sprite_data.get('sprites', {})

# Load images
imgs = {}
if os.path.exists(IMG1): imgs[1] = np.array(Image.open(IMG1).convert('RGBA'))
if os.path.exists(IMG2): imgs[2] = np.array(Image.open(IMG2).convert('RGBA'))

def tight_bbox(img_arr, sx, sy, tile=512, margin=4):
    """Find tight bounding box of non-white, non-transparent content within tile."""
    tile_data = img_arr[sy:sy+tile, sx:sx+tile]
    # Non-white pixels: either has transparency or dark enough color
    # Check alpha channel if present
    if tile_data.shape[2] == 4:
        mask = tile_data[:,:,3] > 20  # non-transparent
    else:
        # Check for non-white pixels
        mask = np.any(tile_data[:,:,:3] < 230, axis=2)

    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return None  # empty tile

    r_min, r_max = np.where(rows)[0][[0,-1]]
    c_min, c_max = np.where(cols)[0][[0,-1]]

    # Add margin
    r_min = max(0, r_min - margin)
    r_max = min(tile-1, r_max + margin)
    c_min = max(0, c_min - margin)
    c_max = min(tile-1, c_max + margin)

    return {
        'cx': int(c_min),  # crop x within tile
        'cy': int(r_min),  # crop y within tile
        'cw': int(c_max - c_min + 1),  # crop width
        'ch': int(r_max - r_min + 1),  # crop height
        'margin_pct': round((1 - (c_max-c_min+1)*(r_max-r_min+1)/(tile*tile))*100, 1)
    }

print("=" * 70)
print("SPRITE ANALYSIS - Tight Bounding Boxes")
print("=" * 70)

results = {}
for name, s in sorted(sprites.items()):
    img_idx = s.get('img', 1)
    if img_idx not in imgs:
        continue
    sx, sy = s['x'], s['y']
    bb = tight_bbox(imgs[img_idx], sx, sy)
    if bb:
        results[name] = {'orig_x': sx, 'orig_y': sy, 'img': img_idx, **bb}
        waste = bb['margin_pct']
        indicator = "⚠" if waste > 40 else "✓"
        print(f"{indicator} {name:25s} img={img_idx} pos=({sx},{sy}) "
              f"crop=({bb['cx']},{bb['cy']},{bb['cw']}x{bb['ch']}) waste={waste}%")

# Output updated sprite JSON with crop info
OUT_JSON = os.path.join(ROOT, 'assets', 'japanese_floorplan_parts_sprite_gpt_cropped.json')
updated = {'sprites': {}}
for name, s in sprites.items():
    img_idx = s.get('img', 1)
    sx, sy = s['x'], s['y']
    entry = {'x': sx, 'y': sy, 'img': img_idx}
    if name in results:
        r = results[name]
        entry['cx'] = r['cx']   # crop offset x within tile
        entry['cy'] = r['cy']   # crop offset y within tile
        entry['cw'] = r['cw']   # crop width
        entry['ch'] = r['ch']   # crop height
    updated['sprites'][name] = entry

with open(OUT_JSON, 'w') as f:
    json.dump(updated, f, indent=2, ensure_ascii=False)
print(f"\n✓ Saved: {OUT_JSON}")

# JIS size verification
print("\n" + "=" * 70)
print("JIS SIZE VERIFICATION (ISIZES vs standards)")
print("=" * 70)

JIS = {
    'bath':           (1600, 1600, 'ユニットバス 1616型'),
    'toilet':         (380,  680,  '便器本体'),
    'sink':           (750,  560,  '洗面台'),
    'kitchen':        (2550, 650,  'システムキッチン I型'),
    'fridge':         (650,  700,  '冷蔵庫'),
    'washer':         (640,  640,  '洗濯機'),
    'sofa':           (2100, 850,  '3Pソファ'),
    'loveseat_2p':    (1500, 850,  '2Pソファ'),
    'low_table':      (900,  500,  'ローテーブル'),
    'dining-table':   (1200, 800,  '食卓4人'),
    'dining_6':       (1600, 900,  '食卓6人'),
    'bed-d':          (1400, 1950, 'ダブルベッド'),
    'bed-s':          (970,  1950, 'シングルベッド'),
    'semi_double_bed':(1200, 1950, 'セミダブル'),
    'desk':           (1200, 600,  'デスク'),
    'tv':             (1200, 80,   'TV台'),
    'closet':         (1800, 600,  'クローゼット'),
    'shoe_cabinet':   (1200, 400,  '下駄箱'),
    'door-swing':     (780,  780,  '開き戸'),
    'door-front':     (900,  200,  '玄関ドア'),
    'stair':          (910,  1820, '階段'),
}

# Read ISIZES from index.html
import re
index_path = os.path.join(ROOT, 'index.html')
with open(index_path, 'r') as f:
    html = f.read()

isizes_match = re.search(r'var ISIZES = \{([\s\S]+?)\};', html)
current = {}
if isizes_match:
    block = isizes_match.group(1)
    for m in re.finditer(r"['\"]?([\w\-]+)['\"]?\s*:\s*\{w:(\d+),d:(\d+)\}", block):
        current[m.group(1)] = (int(m.group(2)), int(m.group(3)))

all_ok = True
for key, (jw, jd, label) in JIS.items():
    cw, cd = current.get(key, (None, None))
    ok = cw == jw and cd == jd
    if not ok:
        all_ok = False
    status = "✓" if ok else "✗"
    cur = f"{cw}×{cd}" if cw else "未定義"
    jis = f"{jw}×{jd}"
    print(f"{status} {key:20s} {label:20s} 現在:{cur:12s} JIS:{jis}")

if all_ok:
    print("\n✓ 全サイズがJIS規格準拠です")
else:
    print("\n✗ 上記の不一致を修正してください")
