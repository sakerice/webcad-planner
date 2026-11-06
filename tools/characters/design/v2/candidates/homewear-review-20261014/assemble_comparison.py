#!/usr/bin/env python3
"""Only arrange unchanged official imagegen figures and labels for outfit review."""
import hashlib,json,math
from pathlib import Path
from statistics import median
from PIL import Image,ImageChops,ImageDraw,ImageFont
P=Path(__file__).resolve().parent
DESIGNS=json.loads((P/'design-intents.json').read_text())
FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'
LATIN='/System/Library/Fonts/Supplemental/Arial.ttf'
def mask(im):
    r,g,b=im.split();hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b)
    return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda v:255 if v>20 else 0),hi.point(lambda v:255 if v<140 else 0))
def bbox(im):
    b=mask(im).getbbox();return [b[0],b[1],b[2]-1,b[3]-1]
def label(im,s,x,y,size=34,fontpath=FONT):
    d=ImageDraw.Draw(im);f=ImageFont.truetype(fontpath,size);b=d.textbbox((0,0),s,font=f)
    d.text((x-(b[2]-b[0])/2,y),s,font=f,fill=(44,52,51))
def sample(im,xy):
    x,y=xy;ps=[im.getpixel((xx,yy)) for xx in range(x-1,x+2) for yy in range(y-1,y+2)]
    return '#'+''.join(f'{int(median([p[k] for p in ps])):02X}' for k in range(3))
SUBTITLES=['丸い袖 × ワイドパンツ','五分袖 × 白インナーの丈差','深緑 × クリームのロング丈','短い外側 × 長い内側']
SAMPLES={
 'homewear-male-a':[('スウェット',(620,400)),('インナー',(620,550)),('パンツ',(548,895)),('ソックス',(530,1115)),('室内履き',(490,1165)),('靴底',(480,1203))],
 'homewear-male-b':[('ポロ',(620,400)),('インナー',(620,575)),('パンツ',(548,895)),('ソックス',(530,1120)),('室内履き',(490,1170)),('靴底',(475,1205))],
 'homewear-female-a':[('スウェット',(620,400)),('インナー',(620,521)),('スカート中央面',(620,700)),('スカート側面',(484,900)),('ソックス',(540,1116)),('室内履き',(514,1166)),('靴底',(500,1208))],
 'homewear-female-b':[('カーディガン',(548,386)),('インナー',(620,345)),('インナー裾',(620,550)),('パンツ',(550,895)),('ソックス',(540,1107)),('室内履き',(519,1170)),('靴底',(511,1205))],
}
out=Image.new('RGB',(3200,1420),(229,229,229))
label(out,'在宅カジュアル — 服装の正面候補',1600,28,48)
label(out,'男女各2案・正面のみ',1600,98,27)
report={'status':'outfit-direction review pending; keep PR103 Draft',
 'source_review':{'message_id':'Sentinel_e332edf471ac8191882c1d17b302d069','time':'2026-10-14 10:31 JST','long_skirt':'latest reference direction takes precedence over earlier above-knee constraint'},
 'art_method':'Official image_gen.imagegen for all6 calls. Same previous adult male02a/female02c anatomy/face guides; reference4 abstract silhouette/layering/material/large-plane observations. No actual reference pixel copied into repo; no specific-work names in generation prompts.',
 'layout_method':'Only crop blank margins, isotropic scaling, place unredrawn figures and labels. Raw4 fronts unchanged. 6px/cm, sole baseline1190.',
 'references':json.loads((P/'reference-records.json').read_text()),'images':[],
 'unperformed':['final human outfit approval','side/back expansion intentionally pending outfit decision','3D/rig/motion/app integration outside scope','long-skirt leg/cloth collision untested','strict all-pixel flat-color equality (low-amplitude raster variation/antialiasing remain)']}
for i,d in enumerate(DESIGNS):
    ident=d['id'];p=P/(ident+'-front.png');im=Image.open(p).convert('RGB');b=bbox(im)
    assert im.size==(1254,1254)
    cx,cy=(623,196) if d['sex']=='male' else (623,197)
    assert max(im.getpixel((cx,cy)))<150,(ident,im.getpixel((cx,cy)))
    full=b[3]-b[1];head=cy-b[1];target=d['height_cm']*6
    crop=im.crop((b[0]-4,b[1],b[2]+5,b[3]+1));scale=target/full
    sz=(round(crop.width*scale),target+1);resized=crop.resize(sz,Image.Resampling.LANCZOS)
    pos=(round(400+i*800-sz[0]/2),1190-target);out.paste(resized,pos)
    name=['M-A','M-B','F-A','F-B'][i]
    label(out,name+'  '+d['name'],400+i*800,1225,32)
    label(out,SUBTITLES[i],400+i*800,1276,28)
    label(out,str(d['height_cm'])+' cm',400+i*800,1330,25,LATIN)
    colors=[];lines=[f'# {ident} 色値','', '原寸3×3画素中央値。ラスタ差/アンチエイリアスがあるため全画素HEX一致の保証ではない。','', '| 部位 | HEX | 中心(x,y) |','|---|---|---|']
    commons=[('肌',(649,165)),('髪',(620,85)),('目・瞳/虹彩の単純形',((595,132) if d['sex']=='male' else (598,132)))]
    for part,xy in commons+SAMPLES[ident]:
        v=sample(im,xy);colors.append({'part':part,'median_hex':v,'xy':list(xy)});lines.append(f'| {part} | {v} | {xy} |')
    (P/(ident+'-colors.md')).write_text('\n'.join(lines)+'\n')
    edges=[]
    for y in (400,520):
        rb=mask(im).crop((0,y,1254,y+1)).getbbox();edges.append([rb[0],rb[2]-1])
    angles=[round(math.degrees(math.atan(abs(edges[1][j]-edges[0][j])/120)),4) for j in (0,1)]
    report['images'].append({'id':ident,'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':list(im.size),'design':d,'visually_displayed':True,'manual_digit_count':[5,5],
     'front_head_measurement':{'crown_y':b[1],'chin_xy':[cx,cy],'chin_raw_rgb':list(im.getpixel((cx,cy))),'sole_y':b[3],'head_px':head,'full_height_px':full,'head_units':round(full/head,6),'hair_crown_not_hidden_skull':True},
     'a_pose_review':'Source adult A-pose retained visually; roomy rounded or3/4 sleeves alter silhouette slope. Sleeve-edge slopes below are garment observations, not joint-angle acceptance.',
     'garment_edge_observation':{'rows_y':[400,520],'x_edges':edges,'slope_degrees_from_vertical':angles},
     'layout':{'height_cm':d['height_cm'],'target_distance_px':target,'position_xy':list(pos),'size':list(sz),'uniform_scale':scale},'colors':colors})
out.save(P/'homewear-front-comparison.png')
for i in range(4):
    b=bbox(out.crop((i*800,140,(i+1)*800,1191)));target=1032 if i<2 else 960
    assert b[3]-b[1]==target and b[3]+140==1190
report['comparison']={'file':'homewear-front-comparison.png','size':[3200,1420],'sha256':hashlib.sha256((P/'homewear-front-comparison.png').read_bytes()).hexdigest(),'bytes':(P/'homewear-front-comparison.png').stat().st_size,'measured_male_height_px':[1032,1032],'measured_female_height_px':[960,960],'sole_y':1190,'height_difference_px':72,'height_difference_cm':12}
if (P/'library-save-status.json').exists():report['library']=json.loads((P/'library-save-status.json').read_text())
(P/'inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'heads':[{**x['front_head_measurement'],'id':x['id']} for x in report['images']],'comparison':report['comparison']},ensure_ascii=False))
