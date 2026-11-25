"""Read-only measurement and requested crop/scale/label assembly; no character repainting."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont
import hashlib, json, statistics, subprocess

ROOT = Path(__file__).resolve().parent
OLD = ROOT.parent / 'face-redesign-review-20261014'
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BG = '#E5E5E5'
DESIGNS = [
    ('attached-male-a', 'redesign-male-a', 'M-A / unified redraw + watch', 172, (615, 200)),
    ('attached-male-b', 'redesign-male-b', 'M-B / unified redraw + bracelet', 172, (617, 199)),
    ('attached-female-a', 'redesign-female-a', 'F-A / unified redraw + hair clip', 160, (620, 206)),
    ('attached-female-b', 'redesign-female-b', 'F-B / unified redraw + necklace', 160, (622, 206)),
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

inspection = {'spec_source': 'Sentinel_68934d2610248191816e270ea7107f5f + Sentinel_5dd5b658cd0081919053cdcd06cf65d3 / 2026-10-14 12:44 + 12:47 JST', 'metrology': [], 'layout': [], 'method': 'Chromatic or dark foreground bbox; inclusive crown and sole. Chin point manually confirmed on displayed enlarged face. Ratio=(sole_y-crown_y)/(chin_y-crown_y); visible hair crown, not hidden skull. +/-1 px chin raster boundary uncertainty.', 'limits': ['全画素で完全な単色ではなく、背景/塗りに低振幅のラスタ色ぶれとアンチエイリアスが残る。', '新しい顔/髪を設計したため顎位置は前版と同一ではない。6.46-6.55は成人体型を見て実測した値で、旧5-5.5頭身へ戻さない。', '本人の最終絵柄/服装承認待ち。横/背面、三面図、3D、rig、モーション、アプリ/実室内での検証は今回未実施。']}

fronts = Image.new('RGB', (3200, 1380), BG)
label(fronts, (32, 24), 'Actual attached references - unified FULL-BODY redraw', 44)
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
fronts.save(ROOT/'attachment-style-fronts.png')

faces = Image.new('RGB', (3200, 1760), BG)
label(faces, (32, 20), 'Face / hair comparison - same crop and enlargement', 44)
label(faces, (32, 80), 'BEFORE: angular lids / wedge nose / open smile / previous body ink', 30)
label(faces, (32, 915), 'AFTER: rounded vertical eyes / soft lids / tiny nose-mouth / warm quiet ink', 30)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    for row, p in enumerate([OLD/(previous+'-front.png'), ROOT/(ident+'-front.png')]):
        # Identical 250x230 source window and uniform 3x scale: no redrawing or head normalization.
        crop = Image.open(p).convert('RGB').crop((500, 0, 750, 230)).resize((750, 690), Image.Resampling.LANCZOS)
        faces.paste(crop, (col*800+25, 155+row*835))
    label(faces, (col*800+25, 112), ['M-A', 'M-B', 'F-A', 'F-B'][col], 30)
faces.save(ROOT/'attachment-style-face-before-after.png')

review = Image.new('RGB', (3200, 3140), BG)
review.paste(fronts, (0, 0)); review.paste(faces, (0, 1380))
review.save(ROOT/'attachment-style-review.png')

fullcompare = Image.new('RGB', (3200, 2800), BG)
label(fullcompare, (32, 24), 'BEFORE - previous style/accessories candidates', 42)
label(fullcompare, (32, 1444), 'AFTER - all clothing/limbs/shoes/accessories redrawn in one visual language', 42)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    paste_body(fullcompare, OLD/(previous+'-front.png'), col, 1210)
    paste_body(fullcompare, ROOT/(ident+'-front.png'), col, 2630)
    label(fullcompare, (col*800+35, 1260), ['M-A','M-B','F-A','F-B'][col], 32)
    label(fullcompare, (col*800+35, 2680), name, 30)
fullcompare.save(ROOT/'attachment-style-body-before-after.png')

# Requested clothing/shoe comparison uses the same source boxes and isotropic scale.
garments = Image.new('RGB', (3200, 1520), BG)
label(garments, (32, 22), 'Clothing drawing / shoe form - motifs and palette retained', 40)
label(garments, (32, 85), 'BEFORE: heavier black edges / rigid bands and sleeve openings', 28)
label(garments, (32, 700), 'AFTER: quiet warm edges / rounded thickness / weighted color planes', 28)
for col, (ident, previous, name, height, chin) in enumerate(DESIGNS):
    for row, p in enumerate([OLD/(previous+'-front.png'), ROOT/(ident+'-front.png')]):
        im = Image.open(p).convert('RGB')
        crop = im.crop((285, 210, 960, 615))
        crop = crop.resize((750, 450), Image.Resampling.LANCZOS)
        garments.paste(crop, (col*800+25, 165+row*615))
        feet = im.crop((410, 1040, 850, 1240)).resize((350, 159), Image.Resampling.LANCZOS)
        garments.paste(feet, (col*800+25+row*390, 1310))
    label(garments, (col*800+25, 125), ['M-A','M-B','F-A','F-B'][col], 26)
    label(garments, (col*800+25, 1265), 'SHOES before / after', 24)
garments.save(ROOT/'attachment-style-garment-before-after.png')

review = Image.new('RGB', (3200, 4660), BG)
review.paste(fronts, (0, 0)); review.paste(faces, (0, 1380)); review.paste(garments, (0, 3140))
review.save(ROOT/'attachment-style-review.png')

# Selected art is retained byte-for-byte from formal imagegen output.
calls = json.loads((ROOT/'generation-log.json').read_text())
for ident, *_ in DESIGNS:
    call = next(c for c in calls if c.get('id') == ident and c.get('selected'))
    assert (ROOT/(ident+'-front.png')).read_bytes() == Path(call['source_output']).read_bytes()

samples = {
 'attached-male-a': [('肌',(640,150)),('髪',(600,46)),('虹彩',(591,136)),('黄色トップス',(615,380)),('白インナー',(620,550)),('深緑パンツ',(565,760)),('靴下',(530,1120)),('靴',(500,1168)),('時計帯',(882,590))],
 'attached-male-b': [('肌',(630,155)),('髪',(600,46)),('虹彩',(591,136)),('ミントトップス',(615,380)),('白インナー',(620,575)),('トープパンツ',(560,760)),('靴下',(530,1127)),('靴',(500,1168)),('ブレスレット',(357,581))],
 'attached-female-a': [('肌',(635,160)),('髪',(630,45)),('虹彩',(590,145)),('緑トップス',(615,380)),('白インナー',(620,525)),('クリームスカート',(620,800)),('靴下',(540,1115)),('靴',(530,1170)),('髪クリップ',(684,104))],
 'attached-female-b': [('肌',(635,161)),('髪',(632,53)),('虹彩',(597,143)),('青トップス',(615,380)),('炭色パンツ',(558,760)),('靴下',(546,1115)),('靴',(525,1170)),('金円盤',(622,284))],
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
