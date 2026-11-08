#!/usr/bin/env python3
"""Arrange unchanged official outputs before/after; inspect geometry and provenance."""
from pathlib import Path
from statistics import median
import json,hashlib,re,subprocess
from PIL import Image,ImageChops,ImageDraw,ImageFont
P=Path(__file__).resolve().parent;OLD=P.parent/'homewear-review-20261014'
D=json.loads((P/'design-intents.json').read_text())
def mask(im):
    r,g,b=im.split();hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b)
    return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda v:255 if v>20 else 0),hi.point(lambda v:255 if v<140 else 0))
def bounds(im):
    b=mask(im).getbbox();return [b[0],b[1],b[2]-1,b[3]-1]
def label(canvas,s,x,y,size=32):
    d=ImageDraw.Draw(canvas);f=ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc',size);b=d.textbbox((0,0),s,font=f);d.text((x-(b[2]-b[0])/2,y),s,font=f,fill=(45,50,50))
def color(im,xy):
    x,y=xy;pixels=[im.getpixel((xx,yy)) for xx in range(x-1,x+2) for yy in range(y-1,y+2)]
    return '#'+''.join(f'{int(median([p[k] for p in pixels])):02X}' for k in range(3))
def measure(im,sex):
    b=bounds(im);cx,cy=(623,196) if sex=='male' else (623,197)
    assert max(im.getpixel((cx,cy)))<150
    head=cy-b[1];full=b[3]-b[1]
    return {'crown_y':b[1],'chin_xy':[cx,cy],'chin_raw_rgb':list(im.getpixel((cx,cy))),'sole_y':b[3],'head_px':head,'full_height_px':full,'head_units':round(full/head,6),'bbox_inclusive':b}
canvas=Image.new('RGB',(3200,2840),(229,229,229));label(canvas,'前回：在宅の服装・成人の等身',1600,28,46);label(canvas,'今回：絵柄＋小物（等身と服装を保持）',1600,1460,46)
report={'user_review':'Sentinel_de871a608d388191b9e7aeea74d969e7 /2026-10-14 11:12 JST','status':'new style/accessory human review pending; Draft/InProgress; no Claude completion',
 'method':'Official image_gen.imagegen for all6 calls; artwork names excluded from prompts. Source original homewear outfits/geometry locked; uploaded illustration only abstract face/eyes/locks/line/cel guide. No reference artwork pixels added to repo.',
 'geometry_method':'Zero-based original1254pixel visible hair crown/chin/sole. Hidden skull cannot be measured. New style changes small outline/AA pixels, not true3D proportions. Record exact source/new differences rather than claiming pixel identity.',
 'composition':'Only blank-margin crop, isotropic physical-height scaling, placement/labels of unredrawn original generated images.6px/cm, males1032px/females960px in each row.',
 'images':[],'layouts':[],'unperformed':['human style/accessory approval','side/back expansion','3D anatomy/rig/motion','physical fit/leg-skirt/accessory collision','strict all-pixel flat-color equality (raster variation/AA)']}
samples={'style-male-a':[('トップス',(620,400)),('パンツ',(548,895)),('時計バンド',(924,591)),('時計面',(942,580))],
 'style-male-b':[('ポロ',(620,400)),('パンツ',(548,895)),('ブレスレット',(313,572))],
 'style-female-a':[('トップス',(620,400)),('スカート',(620,700)),('ヘアクリップ',(678,91))],
 'style-female-b':[('カーディガン',(548,386)),('インナー',(620,345)),('パンツ',(550,895)),('ペンダント',(625,279))]}
for i,d in enumerate(D):
    oldpath=OLD/(d['source']+'-front.png');newpath=P/(d['id']+'-front.png');old=Image.open(oldpath).convert('RGB');new=Image.open(newpath).convert('RGB');assert old.size==new.size==(1254,1254)
    a=measure(old,d['sex']);b=measure(new,d['sex']);delta={'crown_px':b['crown_y']-a['crown_y'],'head_px':b['head_px']-a['head_px'],'full_height_px':b['full_height_px']-a['full_height_px'],'head_units_percent':round((b['head_units']/a['head_units']-1)*100,4)}
    assert abs(delta['head_px'])<=2 and abs(delta['full_height_px'])<=3 and abs(delta['head_units_percent'])<1.1,(d['id'],delta)
    # Hands are isolated from torso; foreground tips in fixed manually inspected
    # rectangles preserve original fingertip height independently of clothing.
    tips=[]
    for im in (old,new):
        m=mask(im);row=[]
        for x0,x1 in ((220,355),(890,1010)):
            z=m.crop((x0,580,x1,740)).getbbox();row.append(z[3]+580-1)
        tips.append(row)
    assert all(abs(tips[0][j]-tips[1][j])<=3 for j in (0,1)),(d['id'],tips)
    cols=[];lines=[f'# {d["id"]} 色/小物','', '原寸3×3画素中央値。全画素の単色保証ではない。','', '| 部位 | HEX | 中心(x,y) |','|---|---|---|']
    base=[('肌',(649,165)),('髪',(620,85)),('目・虹彩/瞳',((595,132) if d['sex']=='male' else (598,132)))]
    for part,xy in base+samples[d['id']]:
        v=color(new,xy);cols.append({'part':part,'median_hex':v,'xy':list(xy)});lines.append(f'| {part} | {v} | {xy} |')
    (P/(d['id']+'-colors.md')).write_text('\n'.join(lines)+'\n')
    report['images'].append({'id':d['id'],'source_file':str(oldpath.relative_to(P.parent)),'source_sha256':hashlib.sha256(oldpath.read_bytes()).hexdigest(),'new_file':newpath.name,'new_sha256':hashlib.sha256(newpath.read_bytes()).hexdigest(),'size':[1254,1254],'design':d,'source_measurement':a,'new_measurement':b,'difference':delta,'fingertip_y_old_new':tips,'visually_displayed':True,'manual_digit_count':[5,5],'outfit_cut_palette_pose_review':'source/new originals displayed side by side; retained main cuts/hem/sleeves/footwear, geometry bounds/hand tips quantified; shadows/accessories/style intentionally differ','colors':cols})
    for row,im in enumerate((old,new)):
        box=bounds(im);target=d['height_cm']*6;crop=im.crop((box[0]-4,box[1],box[2]+5,box[3]+1));scale=target/(box[3]-box[1]);sz=(round(crop.width*scale),target+1);baseline=1190+row*1432;pos=(round(400+i*800-sz[0]/2),baseline-target);canvas.paste(crop.resize(sz,Image.Resampling.LANCZOS),pos)
        label(canvas,['M-A','M-B','F-A','F-B'][i]+' ／ '+('服装基準' if row==0 else ['腕時計','ブレスレット','ヘアクリップ','ネックレス'][i]),400+i*800,baseline+32,32)
        label(canvas,str(d['height_cm'])+' cm',400+i*800,baseline+85,24)
        report['layouts'].append({'id':d['id'],'row':row,'source_or_new':'source' if row==0 else 'new','uniform_scale':scale,'placed_xy':list(pos),'size':list(sz),'target_height_px':target,'sole_y':baseline})
canvas.save(P/'style-accessories-before-after.png')
for row in (0,1):
    y0=140+row*1432;baseline=1190+row*1432
    for i in range(4):
        b=bounds(canvas.crop((i*800,y0,(i+1)*800,baseline+1)));assert b[3]-b[1]==(1032 if i<2 else 960) and b[3]+y0==baseline
report['comparison']={'file':'style-accessories-before-after.png','size':[3200,2840],'sha256':hashlib.sha256((P/'style-accessories-before-after.png').read_bytes()).hexdigest(),'bytes':(P/'style-accessories-before-after.png').stat().st_size,'measured_heights_per_row_px':[[1032,1032,960,960],[1032,1032,960,960]],'sole_baselines_y':[1190,2622],'gender_difference_px':72,'gender_difference_cm':12}
g=json.loads((P/'generation-log.json').read_text());files=['style-male-a-front.png','rejected/style-male-b-hair-height-before.png','style-female-a-front.png','style-female-b-front.png','rejected/style-male-b-hair-correction-overshoot.png','style-male-b-front.png']
for j,x in enumerate(g):
    x.update(call_number=j+1,repository_output=files[j],official_tool='image_gen.imagegen',model_internal_id='not exposed');x['raw_sha256']=hashlib.sha256((P/files[j]).read_bytes()).hexdigest();assert not re.search(r'Pokemon|Pokémon|ポケモン|Nintendo',x['prompt'],re.I)
assert len(g)==6 and sum(x['selected'] for x in g)==4
(P/'generation-log.json').write_text(json.dumps(g,ensure_ascii=False,indent=2)+'\n')
if (P/'library-save-status.json').exists():report['library']=json.loads((P/'library-save-status.json').read_text())
(P/'inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'measured':[{'id':x['id'],'before':x['source_measurement']['head_units'],'after':x['new_measurement']['head_units'],'delta':x['difference'],'hand_tips':x['fingertip_y_old_new']} for x in report['images']],'comparison':report['comparison']},ensure_ascii=False))
