#!/usr/bin/env python3
"""Assemble requested model-sheet layouts and inspect originals; never redraw a character.
PNG figures are official imagegen outputs. Only blank margins, uniform isotropic
layout scaling, canvas placement and labels are handled here. Originals stay byte-identical.
"""
from pathlib import Path
from statistics import median
import hashlib, json, math, shutil
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[4]
DESIGNS = json.loads((ROOT / 'design-intents.json').read_text())
CHINS = {'walker-male-02a': (623,196), 'walker-male-02b': (623,196),
         'walker-male-02c': (623,197), 'walker-female-02a': (625,197),
         'walker-female-02b': (623,196), 'walker-female-02c': (623,197)}
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
PX_PER_CM = 6
BACKGROUND = (229,229,229)
VIEWS = ('front', 'side', 'back')

def mask_for(im):
    r,g,b = im.split()
    hi = ImageChops.lighter(ImageChops.lighter(r,g),b)
    lo = ImageChops.darker(ImageChops.darker(r,g),b)
    return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda v:255 if v>20 else 0),
                            hi.point(lambda v:255 if v<140 else 0))

def bounds(im):
    b = mask_for(im).getbbox()
    return [b[0],b[1],b[2]-1,b[3]-1]

def sample(im,xy):
    x,y = xy
    pixels = [im.getpixel((xx,yy)) for xx in range(x-1,x+2) for yy in range(y-1,y+2)]
    return '#'+''.join(f'{int(median([p[c] for p in pixels])):02X}' for c in range(3))

# Label, front point, side point, back point. Hidden surfaces use None.
COMMON = [('肌',(649,165),(649,165),(315,610)),('髪',(620,85),(620,85),(620,85)),
          ('目・虹彩/瞳の単純形',(595,132),None,None),('目の白部',(583,125),None,None)]
SAMPLES = {
 'walker-male-02a': [('シャツ本体',(540,391),(650,400),(620,400)),('襟',(577,231),(607,211),(620,205)),('胸ポケット',(695,350),None,None),('袖口',(323,558),(575,560),(324,557)),('Tシャツ',(620,415),(684,450),None),('パンツ',(548,895),(610,895),(540,895)),('靴本体',(467,1180),(645,1160),(520,1156)),('靴底',(468,1205),(650,1196),(514,1190))],
 'walker-male-02b': [('ジャケット本体',(551,391),(645,403),(530,530)),('襟',(576,223),(625,209),(620,203)),('袖口',(325,555),(555,545),(325,555)),('Tシャツ',(620,415),(693,441),None),('鞄・肩紐',(543,276),(638,280),(556,245)),('鞄本体',None,(500,360),(620,360)),('チノパンツ',(548,895),(620,890),(548,895)),('靴本体',(491,1170),(650,1163),(520,1160)),('靴底',(480,1203),(680,1195),(520,1195))],
 'walker-male-02c': [('ニット本体',(620,400),(645,401),(620,400)),('袖口',(318,558),(609,546),(325,560)),('シャツ襟',(608,248),(612,206),(620,204)),('パンツ',(548,895),(610,892),(548,895)),('ローファー本体',(490,1166),(654,1170),(520,1167)),('靴底',(475,1203),(654,1198),(520,1189))],
 'walker-female-02a': [('パーカー本体',(620,380),(650,400),(620,400)),('フード',(577,231),(530,275),(620,265)),('前ポケット',(620,475),None,None),('袖口',(349,543),(581,522),(350,543)),('Tシャツ襟',(620,259),None,None),('パンツ',(548,895),(610,895),(548,895)),('靴本体',(519,1176),(650,1160),(533,1167)),('靴底',(511,1205),(650,1201),(533,1197))],
 'walker-female-02b': [('ジャケット本体',(552,381),(653,391),(520,485)),('襟',(580,220),(616,207),(650,205)),('袖口',(348,534),(555,515),(348,534)),('Tシャツ',(620,345),(689,392),None),('鞄・肩紐',(543,276),(633,280),(557,245)),('鞄本体',None,(520,330),(620,355)),('チノパンツ',(550,895),(620,890),(550,895)),('靴本体',(512,1170),(650,1170),(530,1160)),('靴底',(512,1205),(650,1198),(530,1192))],
 'walker-female-02c': [('カーディガン本体',(548,386),(651,392),(620,390)),('袖口',(350,543),(613,534),(349,540)),('トップス',(620,345),(689,390),None),('スカート本体',(557,597),(650,685),(557,598)),('ウエスト',(650,478),None,None),('ローファー本体',(519,1176),(650,1156),(533,1155)),('靴底',(511,1206),(650,1185),(533,1189))],
}

def label(canvas,text,x,y,size=32):
    draw=ImageDraw.Draw(canvas);font=ImageFont.truetype(FONT,size)
    box=draw.textbbox((0,0),text,font=font)
    draw.text((x-(box[2]-box[0])/2,y),text,font=font,fill=(55,55,55))

def place(canvas,im,center_x,baseline,desired_distance):
    x0,top,x1,sole = bounds(im)
    crop=im.crop((max(0,x0-4),top,min(im.width,x1+5),sole+1))
    scale=desired_distance/(sole-top)
    # Pixel-center distance is desired_distance; inclusive raster adds one row.
    height=desired_distance+1
    width=round(crop.width*scale)
    resized=crop.resize((width,height),Image.Resampling.LANCZOS)
    left=round(center_x-width/2);y=baseline-desired_distance
    canvas.paste(resized,(left,y))
    return {'source_crown_y':top,'source_sole_y':sole,'source_distance_px':sole-top,
            'uniform_scale':scale,'placed_xy':[left,y], 'resized_size':[width,height],
            'target_crown_y':y,'target_sole_y':baseline,'target_distance_px':desired_distance}

generations=json.loads((ROOT/'production-generations.json').read_text())
for n,g in enumerate(generations,1):
    g['call_number_in_production']=n
    if 'selected' not in g:g['selected']=bool(g.get('deliverable'))
    g['source']=g.get('source',g.get('path'))
    g['review']=g.get('review',g.get('assessment'))
    raw=WORKSPACE/g['source']
    if not raw.is_file():
        raw=ROOT/g['repository_output']
        assert hashlib.sha256(raw.read_bytes()).hexdigest()==g['raw_sha256']
    assert raw.is_file(),str(raw)
    g['raw_sha256']=hashlib.sha256(raw.read_bytes()).hexdigest()
    if g['selected']:
        g['repository_output']=g['id']+'-'+g['view']+'.png'
        assert (ROOT/g['repository_output']).read_bytes()==raw.read_bytes()
    else:
        out=ROOT/'candidates'/'production-rejected'/f'{n:02d}-{g["id"]}-{g["view"]}.png'
        out.parent.mkdir(parents=True,exist_ok=True)
        if raw.resolve()!=out.resolve():shutil.copyfile(raw,out)
        g['repository_output']=str(out.relative_to(ROOT))
(ROOT/'production-generations.json').write_text(json.dumps(generations,ensure_ascii=False,indent=2)+'\n')
assert sum(bool(g['selected']) for g in generations)==18

report={'active_specification':'Human2026-10-14 04:02JST: realistic adult proportions and contemporary college clothes; former5-5.5-head gate withdrawn. Parent approved modern direction, final human approval pending; PR stays Draft.',
 'pixel_method':'Original1254px PNGs. Coordinates are zero-based. Visible hair crown-to-chin and crown-to-sole distances; hidden skull height cannot be measured. Mask foreground if max(RGB)-min(RGB)>20 or max(RGB)<140. Chin points chosen by visible contour inspection and raw pixel verification.',
 'layout_method':'Only original image placement, crop of blank margins, isotropic rescaling and labels; no character pixels redrawn. 6px/cm, common sole baseline. Raw singles byte-identical to official imagegen output.',
 'designs':[],'layouts':[],
 'unperformed':['final human approval','actual lowered-arm pose image/3D/rig/motion (outside image-only scope)','render tests against actual white-wall/wood/tatami scenes','strict global flat-region HEX equality (low-amplitude raster variation and antialiasing remain)','final-lineup Library persistence at report generation'],
 'remaining_differences':['AI raster tone variation in fills/background despite flat-cel instructions; visually no designed multistep shading/texture, but strict numerical uniformity is not claimed.','Side/back vertical framing differs by up to18px (~1.5%); three-view layout uses identical physical-height scale.','Hand positions vary mildly between profile and front. Side near hand has5 digits; far hand is naturally occluded.','Male02b rear bag lower edge~478px vs side~488px; corrected from515px. Female02b corrected from471px to~445px vs side~443px.','Female02c side has faint short ankle anatomical line remaining after targeted cleanup; fabric elbow crease removed.'],
 'library':json.loads((ROOT/'library-save-status.json').read_text()) if (ROOT/'library-save-status.json').exists() else {'status':'not saved'}}
if report['library']['status']=='succeeded':
    report['unperformed'].remove('final-lineup Library persistence at report generation')
lineup=Image.new('RGB',(4200,1280),BACKGROUND)
for i,d in enumerate(DESIGNS):
    ident=d['id'];ims={v:Image.open(ROOT/(ident+'-'+v+'.png')).convert('RGB') for v in VIEWS}
    item={'id':ident,'height_cm':d['height_cm'],'design_intent':d,'views':[],'visually_displayed_all_views':True,'manual_digits':{'front':[5,5],'side_near':5,'side_far':'occluded','back':[5,5]}}
    for v,im in ims.items():
        assert im.width>=1024 and im.height>=1024
        b=bounds(im);full=b[3]-b[1]
        item['views'].append({'view':v,'file':ident+'-'+v+'.png','size':list(im.size),'sha256':hashlib.sha256((ROOT/(ident+'-'+v+'.png')).read_bytes()).hexdigest(),'foreground_bbox_inclusive':b,'crown_y':b[1],'sole_y':b[3],'full_height_px':full,'frame_fill_fraction':round(full/im.height,6),'chin':'not visible from rear' if v=='back' else 'front quantified below; profile inspected visually'})
    im=ims['front'];b=bounds(im);cx,cy=CHINS[ident]
    assert max(im.getpixel((cx,cy)))<145,(ident,cx,cy)
    head=cy-b[1];full=b[3]-b[1]
    item['front_head_measurement']={'crown_y':b[1],'chin_xy':[cx,cy],'chin_raw_rgb':list(im.getpixel((cx,cy))),'sole_y':b[3],'head_height_px':head,'full_height_px':full,'head_units':round(full/head,6),'not_a_fixed_acceptance_gate':True}
    edges=[]
    for y in (400,520):
        edge=mask_for(im).crop((0,y,im.width,y+1)).getbbox();edges.append([edge[0],edge[2]-1])
    angles=[math.degrees(math.atan(abs(edges[1][j]-edges[0][j])/120)) for j in (0,1)]
    assert all(30<=a<=45 for a in angles),(ident,angles)
    item['a_pose_sleeve_outer_edge']={'rows_y':[400,520],'edges_x':edges,'degrees_from_vertical':[round(a,4) for a in angles],'method':'sleeve silhouette slope, not 3D joint angle'}
    common=list(COMMON)
    if d['sex']=='female':common[2]=('目・虹彩/瞳の単純形',(598,132),None,None);common[3]=('目の白部',(587,126),None,None)
    side_eye={'walker-male-02a':(668,128),'walker-male-02b':(681,123),'walker-male-02c':(665,120),'walker-female-02a':(664,122),'walker-female-02b':(666,122),'walker-female-02c':(670,125)}[ident]
    common[2]=(common[2][0],common[2][1],side_eye,None)
    # White eye regions in profile are narrow; use the brightest 3x3 median
    # within manually inspected near-eye ROI, preserving its actual coordinate.
    candidates=[(x,y) for x in range(side_eye[0]-8,side_eye[0]-2) for y in range(side_eye[1]-4,side_eye[1]+5)]
    white_xy=max(candidates,key=lambda xy:sum(int(sample(ims['side'],xy)[k:k+2],16) for k in (1,3,5)))
    common[3]=(common[3][0],common[3][1],white_xy,None)
    colors=[]
    lines=[f'# {ident} 色値表','',f'{d["name"]} / {d["direction"]} / 想定{d["height_cm"]}cm。','',
      '正面の原寸3×3画素中央値を基準HEXとして示し、横/背面も同じ方式で採取。隠れた部位は—。意図パレットはdesign-intents.jsonに記録。ラスタ色ぶれ/アンチエイリアスがあるため全画素HEX一致は保証しない。目は白部＋単色の虹彩/瞳形＋小白ハイライト。','',
      '| 部位 | 基準HEX（正面、鞄本体のみ横） | 正面HEX @中心(x,y) | 横HEX @中心(x,y) | 背面HEX @中心(x,y) |','|---|---|---|---|---|']
    for part,*coords in common+SAMPLES[ident]:
        values={v:(sample(ims[v],xy) if xy else None) for v,xy in zip(VIEWS,coords)}
        reference=values['front'] or values['side'] or values['back']
        colors.append({'part':part,'reference_hex':reference,'samples':{v:{'hex':values[v],'xy':xy} for v,xy in zip(VIEWS,coords)}})
        cells=[f'{values[v]} @({xy[0]},{xy[1]})' if xy else '—' for v,xy in zip(VIEWS,coords)]
        lines.append('| '+' | '.join([part,reference]+cells)+' |')
    lines+=['','白ハイライト基準 #FFFFFF、外輪郭は濃灰。背景の設計値 #E5E5E5（生成ラスタに低振幅の差あり）。', '', '服・髪色は全方向を実表示して照合。側面の見えないTシャツ/前ポケット、背面の目/顔などを推測値で埋めていない。']
    (ROOT/(ident+'-colors.md')).write_text('\n'.join(lines)+'\n')
    item['colors']=colors
    report['designs'].append(item)
    sheet=Image.new('RGB',(2640,1280),BACKGROUND); placements=[]
    for j,v in enumerate(VIEWS):
        placements.append({'view':v,**place(sheet,ims[v],440+j*880,1132,d['height_cm']*PX_PER_CM)})
        label(sheet,{'front':'FRONT','side':'LEFT PROFILE','back':'BACK'}[v],440+j*880,1155,30)
    label(sheet,ident+' / '+str(d['height_cm'])+' cm',1320,1210,33)
    sheet.save(ROOT/(ident+'-turnaround.png'))
    report['layouts'].append({'file':ident+'-turnaround.png','size':[2640,1280],'px_per_cm':PX_PER_CM,'placements':placements})
    lp=place(lineup,im,350+i*700,1132,d['height_cm']*PX_PER_CM)
    label(lineup,ident,350+i*700,1160,32)
    label(lineup,str(d['height_cm'])+' cm',350+i*700,1210,28)
    report['layouts'].append({'file':'lineup.png','id':ident,'px_per_cm':PX_PER_CM,**lp})
lineup.save(ROOT/'lineup.png')
report['deliverable_pngs']=[{'file':p.name,'size':list(Image.open(p).size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.glob('*.png'))]
assert len(report['deliverable_pngs'])==25
report['lineup_geometry']={'size':[4200,1280],'male_height_px':1032,'female_height_px':960,'height_difference_px':72,'height_difference_cm':12,'all_sole_baselines_y':1132,'male_crown_y':100,'female_crown_y':172,'resampling_uncertainty_px':1}
measured=[]
for i in range(6):
    b=bounds(lineup.crop((i*700,0,(i+1)*700,1133)))
    expected=1032 if i<3 else 960
    assert (b[1],b[3],b[3]-b[1])==(1132-expected,1132,expected)
    measured.append([b[1],b[3]])
report['lineup_geometry']['measured_original_lineup']={'male_crown_sole_y':measured[:3],'female_crown_sole_y':measured[3:],'male_height_px':[1032]*3,'female_height_px':[960]*3,'method':'foreground threshold per700px column; labels excluded by y<1133'}
if (ROOT/'manual-qa.json').exists():
    qa=json.loads((ROOT/'manual-qa.json').read_text())
    assert qa['displayed_png_sha256']=={x['file']:x['sha256'] for x in report['deliverable_pngs']}
    report['all_25_deliverable_PNGs_visually_displayed']=qa['all25_visually_displayed']
    for d in report['designs']:d['adult_arm_position_estimate']=qa['manual_arm_estimates'][d['id']]
(ROOT/'final-inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'PNG_deliverables':len(report['deliverable_pngs']),'production_calls':len(generations),'selected_outputs':sum(g['selected'] for g in generations),'front_measurements':[{**d['front_head_measurement'],'id':d['id'],'A_degrees':d['a_pose_sleeve_outer_edge']['degrees_from_vertical']} for d in report['designs']],'lineup':report['lineup_geometry']},ensure_ascii=False))
