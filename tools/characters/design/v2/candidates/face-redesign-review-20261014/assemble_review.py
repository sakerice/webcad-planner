"""Read-only measurement and requested crop/scale/label assembly; no character repainting."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont
import hashlib, json, statistics, subprocess

ROOT = Path(__file__).resolve().parent
OLD = ROOT.parent / 'style-accessories-review-20261014'
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BG = '#E5E5E5'
DESIGNS = [
    ('redesign-male-a', 'style-male-a', 'M-A / new face + watch', 172, (619, 192)),
    ('redesign-male-b', 'style-male-b', 'M-B / new face + bracelet', 172, (613, 197)),
    ('redesign-female-a', 'style-female-a', 'F-A / new face + hair clip', 160, (621, 202)),
    ('redesign-female-b', 'style-female-b', 'F-B / new outfit + necklace', 160, (620, 205)),
]

def bbox(im):
    r, g, b = im.convert('RGB').split()
    hi = ImageChops.lighter(ImageChops.lighter(r, g), b)
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    mask = ImageChops.lighter(ImageChops.subtract(hi, lo).point(lambda v: 255 if v > 20 else 0), hi.point(lambda v: 255 if v < 140 else 0))
    return mask.getbbox()

def label(im, xy, text, size=32):
    ImageDraw.Draw(im).text(xy, text, font=ImageFont.truetype(FONT, size), fill='#17252F')

def paste_body(board, p, col, base_y):
    im = Image.open(p).convert('RGB'); box = bbox(im)
    target = DESIGNS[col][3] * 6
    crop = im.crop(box)
    scaled = crop.resize((round(crop.width * target / crop.height), target), Image.Resampling.LANCZOS)
    board.paste(scaled, (col * 800 + (800 - scaled.width)//2, base_y-target))
    return {'crop_bbox_exclusive': list(box), 'rendered_height_px': target, 'sole_common_y_exclusive': base_y}

inspection = {'spec_source': 'Sentinel_8546c2269c108191a8e14165a726eac8 / 2026-10-14 11:57 JST', 'metrology': [], 'layout': [], 'method': 'Chromatic or dark foreground bbox; inclusive crown and sole. Chin point manually confirmed on displayed enlarged face. Ratio=(sole_y-crown_y)/(chin_y-crown_y); visible hair crown, not hidden skull. +/-1 px chin raster boundary uncertainty.', 'limits': ['全画素で完全な単色ではなく、背景/塗りに低振幅のラスタ色ぶれとアンチエイリアスが残る。', '新しい顔/髪を設計したため顎位置は前版と同一ではない。6.53-6.80は成人体型を見て実測した値で、旧5-5.5頭身へ戻さない。', '本人の最終絵柄/服装承認待ち。横/背面、三面図、3D、rig、モーション、アプリ/実室内での検証は今回未実施。']}

fronts = Image.new('RGB', (3200, 1380), BG)
label(fronts, (32, 24), 'New original face / hair design - adult homewear', 44)
label(fronts, (32, 85), 'Common scale: 6 px/cm | male 172 cm / female 160 cm | front candidates', 30)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    p = ROOT / (ident + '-front.png'); im = Image.open(p).convert('RGB'); box = bbox(im)
    assert im.width >= 1024 and im.height >= 1024
    crown, sole = box[1], box[3] - 1
    head = chin[1]-crown; full = sole-crown
    inspection['metrology'].append({'id': ident, 'size': list(im.size), 'bbox_exclusive': list(box), 'crown_y': crown, 'chin_xy': list(chin), 'chin_rgb': list(im.getpixel(chin)), 'sole_y': sole, 'head_height_px': head, 'body_height_px': full, 'heads': full/head, 'vertical_fill_percent': 100*(full+1)/im.height, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'real_displayed': True})
    lay = paste_body(fronts, p, col, 1195); inspection['layout'].append({'id': ident, **lay})
    label(fronts, (col*800+40, 1232), name, 30)
    label(fronts, (col*800+40, 1283), f'{height} cm / {full/head:.3f} visible heads', 30)
fronts.save(ROOT/'face-redesign-fronts.png')

faces = Image.new('RGB', (3200, 1760), BG)
label(faces, (32, 20), 'Face / hair comparison - same crop and enlargement', 44)
label(faces, (32, 80), 'BEFORE: round eyes / closed smile / earlier hair part', 30)
label(faces, (32, 915), 'AFTER: angular upper lids / amber iris / open smile / new hair part', 30)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    for row, p in enumerate([OLD/(previous+'-front.png'), ROOT/(ident+'-front.png')]):
        # Identical 250x230 source window and uniform 3x scale: no redrawing or head normalization.
        crop = Image.open(p).convert('RGB').crop((500, 0, 750, 230)).resize((750, 690), Image.Resampling.LANCZOS)
        faces.paste(crop, (col*800+25, 155+row*835))
    label(faces, (col*800+25, 112), ['M-A', 'M-B', 'F-A', 'F-B'][col], 30)
faces.save(ROOT/'face-redesign-face-before-after.png')

review = Image.new('RGB', (3200, 3140), BG)
review.paste(fronts, (0, 0)); review.paste(faces, (0, 1380))
review.save(ROOT/'face-redesign-review.png')

fullcompare = Image.new('RGB', (3200, 2800), BG)
label(fullcompare, (32, 24), 'BEFORE - previous style/accessories candidates', 42)
label(fullcompare, (32, 1444), 'AFTER - original face/hair redesign; F-B outfit replaced', 42)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    paste_body(fullcompare, OLD/(previous+'-front.png'), col, 1210)
    paste_body(fullcompare, ROOT/(ident+'-front.png'), col, 2630)
    label(fullcompare, (col*800+35, 1260), ['M-A','M-B','F-A','F-B'][col], 32)
    label(fullcompare, (col*800+35, 2680), name, 30)
fullcompare.save(ROOT/'face-redesign-body-before-after.png')

# Selected art is retained byte-for-byte from formal imagegen output.
calls = json.loads((ROOT/'generation-log.json').read_text())
for ident, *_ in DESIGNS:
    call = next(c for c in calls if c.get('id') == ident and c.get('selected'))
    assert (ROOT/(ident+'-front.png')).read_bytes() == Path(call['source_output']).read_bytes()

samples = {
 'redesign-male-a': [('肌',(640,150)),('髪',(600,46)),('虹彩',(593,128)),('黄色トップス',(615,380)),('白インナー',(620,550)),('深緑パンツ',(565,760)),('靴下',(530,1120)),('靴',(500,1168)),('時計帯',(937,580))],
 'redesign-male-b': [('肌',(630,155)),('髪',(600,46)),('虹彩',(586,133)),('ミントトップス',(615,380)),('白インナー',(620,575)),('トープパンツ',(560,760)),('靴下',(530,1127)),('靴',(500,1168)),('ブレスレット',(312,570))],
 'redesign-female-a': [('肌',(635,160)),('髪',(630,45)),('虹彩',(592,139)),('緑トップス',(615,380)),('白インナー',(620,525)),('クリームスカート',(620,800)),('靴下',(540,1115)),('靴',(530,1170)),('髪クリップ',(684,104))],
 'redesign-female-b': [('肌',(635,161)),('髪',(632,53)),('虹彩',(589,144)),('青トップス',(615,380)),('炭色パンツ',(558,760)),('靴下',(546,1115)),('靴',(525,1170)),('金円盤',(622,284))],
}
for ident, points in samples.items():
    im = Image.open(ROOT/(ident+'-front.png')).convert('RGB')
    lines = ['# '+ident+' 色値（原寸画素測定）', '', '平坦面の3×3各RGB中央値。生成指示の意図HEXとは異なる。ラスタ揺らぎ/AA/硬い影は残り、全画素HEX一致を保証しない。', '', '| 部位 | 実測HEX | 測点 (x,y) |', '| --- | --- | --- |']
    values=[]
    for part, (x,y) in points:
        px=[im.getpixel((xx,yy)) for yy in range(y-1,y+2) for xx in range(x-1,x+2)]
        rgb=tuple(int(statistics.median(p[c] for p in px)) for c in range(3));hx='#'+''.join(f'{v:02X}' for v in rgb)
        lines.append(f'| {part} | {hx} | ({x},{y}) |');values.append({'part':part,'point':[x,y],'median_rgb':list(rgb),'hex':hx})
    (ROOT/(ident+'-colors.md')).write_text('\n'.join(lines)+'\n')
    next(m for m in inspection['metrology'] if m['id']==ident)['color_samples']=values

inspection['files']=[{'path':str(p.relative_to(ROOT)),'size':list(Image.open(p).size),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.rglob('*.png'))]
(ROOT/'inspection.json').write_text(json.dumps(inspection,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'heads':[{k:m[k] for k in ['id','crown_y','chin_xy','sole_y','heads','vertical_fill_percent']} for m in inspection['metrology']], 'files':len(inspection['files'])},ensure_ascii=False,indent=2))
