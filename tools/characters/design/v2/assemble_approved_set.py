"""Package exact official PNGs; crop/isotropic layout only, never repaint a person."""
import hashlib
import json
import math
import shutil
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

P=Path(__file__).resolve().parent
SOURCE=P/'candidates/claude-final-format-20261014'
APPROVED=P/'candidates/attachment-style-review-20261014'
HISTORY=P/'candidates/superseded-six-20261014'
IDS=[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def bbox(im):
    r,g,b=im.convert('RGB').split();hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b)
    return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda x:255 if x>20 else 0),hi.point(lambda x:255 if x<140 else 0)).getbbox()

def place(canvas,path,column,width,height,baseline):
    im=Image.open(path).convert('RGB');box=bbox(im);cropped=im.crop(box)
    h=height+1;w=round(cropped.width*height/(cropped.height-1));small=cropped.resize((w,h),Image.Resampling.LANCZOS)
    xy=(column*width+(width-w)//2,baseline-height);canvas.paste(small,xy)
    return {'input':path.name,'crop':list(box),'isotropic_scale':height/(cropped.height-1),'destination_xy':list(xy),'destination_size':[w,h]}

def main():
    if not HISTORY.exists():
        HISTORY.mkdir()
        preserve=[p for p in P.iterdir() if p.is_file() and (p.suffix in ['.png','.md','.json'] or p.name=='verify_deliverables.py')]
        records=[]
        for p in preserve:
            records.append({'file':p.name,'sha256':sha(p),'bytes':p.stat().st_size});shutil.move(str(p),str(HISTORY/p.name))
        (HISTORY/'archive-sha256.json').write_text(json.dumps(records,indent=2)+'\n')
        assert all(sha(HISTORY/x['file'])==x['sha256'] for x in records)
    measurements={x['id']:x for x in json.loads((SOURCE/'front-inspection.json').read_text())}
    for id in IDS:
        for view in ['front','side','back']:shutil.copy2(SOURCE/f'{id}-{view}.png',P/f'{id}-{view}.png')
    designs=[];pngs=[];layouts=[]
    intents=['黄色スウェットの在宅カジュアル','ミント半袖ハーフジップの軽い在宅服','コーラルカーディガンのきれいめ在宅服','緑スウェットと長スカートの在宅服','青ボートネックとワイドパンツのきれいめ在宅服','オートミール半袖ニットとローズパンツの在宅服']
    for i,id in enumerate(IDS):
        row=measurements[id];m={'crown_y':row['crown_y'],'chin_xy':row['chin_xy'],'chin_raw_rgb':row['chin_rgb'],'sole_y':row['sole_y'],'head_height_px':row['head_height_px'],'full_height_px':row['full_height_px'],'head_units':row['head_units']}
        views=[];degrees=[]
        for view in ['front','side','back']:
            im=Image.open(P/f'{id}-{view}.png').convert('RGB');box=bbox(im);views.append({'view':view,'size':list(im.size),'bbox':list(box),'full_height_px':box[3]-box[1]-1,'vertical_fill_percent':100*(box[3]-box[1])/im.height})
        # Local sleeve-edge slope is diagnostic; concealed joints are not measured.
        im=Image.open(P/f'{id}-front.png').convert('RGB')
        for side in ['left','right']:
            points=[]
            for y in [400,520]:
                xs=[x for x in range(im.width) if (lambda rgb:max(rgb)-min(rgb)>20 or max(rgb)<140)(im.getpixel((x,y)))];points.append(min(xs) if side=='left' else max(xs))
            degrees.append(math.degrees(math.atan(abs(points[1]-points[0])/120)))
        canvas=Image.new('RGB',(2640,1280),'#E5E5E5');draw=ImageDraw.Draw(canvas);font=ImageFont.truetype(FONT,30);cols=[]
        for j,view in enumerate(['front','side','back']):
            cols.append(place(canvas,P/f'{id}-{view}.png',j,880,1204 if i<3 else 1120,1230));draw.text((j*880+40,1244),id+' / '+view,font=font,fill='#283A35')
        canvas.save(P/f'{id}-turnaround.png');layouts.append({'file':id+'-turnaround.png','views':cols,'scale_px_per_cm':7})
        designs.append({'id':id,'intent':intents[i],'height_cm':172 if i<3 else 160,'approved_source':str((APPROVED/f'attached-{row["id"].split("-")[1]}-{id[-1]}-front.png').relative_to(P)) if id[-1]!='c' else None,'approved_style_basis':id[-1]!='c','front_pose_adjusted':True,'front_source_human_approved':False,'front_head_measurement':m,'views':views,'a_pose_sleeve_outer_edge':{'degrees_from_vertical':degrees,'measurement':'local outer-edge slope at y400/520; not a concealed shoulder joint angle'},'prescribed_a_pose_deg':[35,45]})
    canvas=Image.new('RGB',(4800,1280),'#E5E5E5');draw=ImageDraw.Draw(canvas);font=ImageFont.truetype(FONT,32);cols=[]
    for i,id in enumerate(IDS):
        cols.append(place(canvas,P/f'{id}-front.png',i,800,1032 if i<3 else 960,1132));draw.text((i*800+40,1182),id,font=font,fill='#283A35')
    canvas.save(P/'lineup.png');layouts.append({'file':'lineup.png','columns':cols,'column_width_px':800,'scale_px_per_cm':6,'sole_baseline_y':1132,'male_body_px':1032,'female_body_px':960})
    for p in sorted(P.glob('*.png')):
        with Image.open(p) as im:pngs.append({'file':p.name,'size':list(im.size),'sha256':sha(p),'bytes':p.stat().st_size})
    old=json.loads((APPROVED/'generation-log.json').read_text());gens=[]
    for id in IDS:
        if id[-1]=='c':continue
        alias='attached-'+id.split('-')[1]+'-'+id[-1];g=next(x for x in reversed(old) if x['id']==alias and x['selected'])
        gens.append({'id':id+'-approved-style-reference','view':'front','stage':'approved-style-reference-preserved','prompt':g['prompt'],'input_paths':g['referenced_image_paths'],'raw_path':g['source_output'],'raw_sha256':g['source_sha256'],'repository_output':str((APPROVED/f'{alias}-front.png').relative_to(P)),'official_tool':'image_gen.imagegen','selected':False,'source_head':'1f1815e5ca7aca53d0893152e9f2926877c05c68'})
    for g in json.loads((SOURCE/'new-generations.json').read_text()):
        g['raw_sha256']=sha(Path(g['raw_path']));g['selected']=False
        if g['stage']!='rejected-size-study':g['repository_output']=None;g['reason']='Replaced by explicit35-45degree A-pose; original raw retained on Mac'
        gens.append(g)
    for name in ['front-pose-provenance.json','view-pose-provenance.json']:
        for g in json.loads((SOURCE/name).read_text()):
            file=Path(g['target']).name
            inputs=g.get('input_snapshots') or [{'path':x,'sha256':sha(Path(x))} for x in g['input_snapshot_paths']]
            gens.append({'id':g['id'],'view':file.rsplit('-',1)[-1].split('.')[0],'stage':'final-a-pose','prompt':g['prompt'],'input_original_paths':g['input_paths'],'input_snapshots':inputs,'raw_path':g['raw_path'],'raw_sha256':sha(Path(g['raw_path'])),'repository_output':file,'official_tool':'image_gen.imagegen','selected':True})
    (P/'production-generations.json').write_text(json.dumps(gens,ensure_ascii=False,indent=2)+'\n')
    data={'basis_head':'1f1815e5ca7aca53d0893152e9f2926877c05c68','scope_source':'Sentinel_05ffbbd842d08191a86a1d3d32c81fc9','role_correction_source':'Sentinel_b2789cd77240819194fdcc93430add48','three_d_deliverables':False,'designs':designs,'deliverable_pngs':pngs,'layouts':layouts,'operations':['exact official PNG copying','character bbox cropping','isotropic layout scaling','labels'],'not_tested':['hidden anatomical joint angles','same exact 3D projection','material physics','3D/rig/animation','app/browser integration','new C human selection'],'library':None}
    (P/'final-inspection.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print('Packaged',len(pngs),'PNGs; selected raw images',sum(x['selected'] for x in gens))
    for x in designs:print(x['id'],x['front_head_measurement']['head_units'],x['a_pose_sleeve_outer_edge']['degrees_from_vertical'])

if __name__=='__main__':main()
