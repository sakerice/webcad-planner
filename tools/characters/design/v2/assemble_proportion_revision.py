"""Issue167: exact native outputs and measured, isotropic review layouts."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from inspect_proportion_fronts import bbox
import json, hashlib, shutil, math

P=Path(__file__).resolve().parent
S=P/'candidates/proportion-issue167-20261014'
H=P/'candidates/superseded-adult-issue143-20261014'
A=P/'candidates/attachment-style-review-20261014'
IDS=[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def save_new(im,path):
    tmp=path.with_name(path.stem+'.fresh.png');im.save(tmp);tmp.replace(path)
def place(canvas,path,col,width,height,baseline):
    im=Image.open(path).convert('RGB');b=bbox(im);crop=im.crop(b)
    scale=height/(b[3]-b[1]-1);w=round(crop.width*scale)
    assert w<width-12,(path.name,w,width)
    xy=(col*width+(width-w)//2,baseline-height)
    canvas.paste(crop.resize((w,height+1),Image.Resampling.LANCZOS),xy)
    return {'input':path.name,'crop':list(b),'scale':scale,'xy':list(xy),'size':[w,height+1]}

def measured_panel(canvas,source,layout,raw):
    # Identify an actual dark contour pixel near the transformed verified source point.
    sx,sy=raw['chin_xy'];b=layout['crop'];xy=layout['xy'];s=layout['scale']
    x=round(xy[0]+(sx-b[0])*s);y=round(xy[1]+(sy-b[1])*s)
    points=[]
    for yy in range(y-2,y+3):
        for xx in range(x-3,x+4):
            rgb=canvas.getpixel((xx,yy))
            if max(rgb)<180:points.append((xx,yy))
    assert points,source
    pt=min(points,key=lambda p:(abs(p[1]-y),abs(p[0]-x)))
    # Crown and sole are independently rescanned inside this composed panel.
    panel=canvas.crop((xy[0],0,xy[0]+layout['size'][0],1231));pb=bbox(panel)
    crown=pb[1];sole=pb[3]-1;head=pt[1]-crown;full=sole-crown
    return {'crown_y':crown,'chin_xy':list(pt),'chin_raw_rgb':list(canvas.getpixel(pt)),'sole_y':sole,'head_height_px':head,'full_height_px':full,'head_units':full/head,'measurement':'Actual final composed panel crown/sole plus visible chin contour pixel near registered original point, visually checked','boundary_uncertainty_px':1}

def main():
    before=json.loads((H/'final-inspection.json').read_text())
    f={x['id']:x for x in json.loads((S/'front-inspection.json').read_text())}
    side={x['id']:x for x in json.loads((S/'side-inspection.json').read_text())}
    assert all(5.3<=x['head_units']<=5.8 for x in list(f.values())+list(side.values()))
    for id in IDS:
        for v in ['front','side','back']:
            src=S/f'{id}-{v}.png';tmp=P/f'{id}-{v}.fresh.png'
            shutil.copy2(src,tmp);tmp.replace(P/f'{id}-{v}.png')
    designs=[];layouts=[]
    for i,id in enumerate(IDS):
        views=[]
        for v in ['front','side','back']:
            im=Image.open(P/f'{id}-{v}.png').convert('RGB');b=bbox(im)
            m=f[id] if v=='front' else side[id] if v=='side' else None
            if v=='back':
                pts=[]
                for y in range(150,[223,211,231,235,230,220][i]):
                    for x in range(610,631):
                        c=im.getpixel((x,y))
                        if max(c)<180 and c[0]>c[1]*1.1:pts.append((x,y))
                py=max(y for x,y in pts);pt=min((t for t in pts if t[1]==py),key=lambda t:abs(t[0]-620))
                m={'crown_y':b[1],'chin_xy':None,'sole_y':b[3]-1,'full_height_px':b[3]-1-b[1],'head_units':None,'visible_posterior_hair_boundary_xy':list(pt),'visible_posterior_hair_boundary_rgb':list(im.getpixel(pt)),'visible_hair_height_px':py-b[1],'measurement':'Chin is occluded from back; posterior hair/nape boundary is a separate visible landmark, not substituted for chin or a head-unit measurement'}
            views.append({'view':v,'size':list(im.size),'bbox':list(b),'vertical_fill_percent':100*(b[3]-b[1])/im.height,'head_measurement':m})
        canvas=Image.new('RGB',(3120,1280),'#E5E5E5');draw=ImageDraw.Draw(canvas);font=ImageFont.truetype(FONT,30);cols=[]
        for j,v in enumerate(['front','side','back']):
            cols.append(place(canvas,P/f'{id}-{v}.png',j,1040,1204 if i<3 else 1120,1230))
            draw.text((j*1040+40,1244),id+' / '+v,font=font,fill='#283A35')
        tm={v:measured_panel(canvas,v,cols[j],f[id] if v=='front' else side[id]) for j,v in enumerate(['front','side'])}
        tm['back']={'crown_y':1230-(1204 if i<3 else 1120),'sole_y':1230,'full_height_px':1204 if i<3 else 1120,'chin_xy':None,'head_units':None,'measurement':'Back chin not visible; actual panel crown/sole recorded, no inferred chin ratio'}
        save_new(canvas,P/f'{id}-turnaround.png');layouts.append({'file':id+'-turnaround.png','views':cols,'px_per_cm':7,'column_width':1040})
        d=next(x for x in before['designs'] if x['id']==id)
        designs.append({'id':id,'intent':d['intent'],'height_cm':172 if i<3 else 160,'approved_style_source':d['approved_source'],'human_approved_scope':'style only, not proportions or these final variants','front_head_measurement':f[id],'side_head_measurement':side[id],'views':views,'turnaround_head_measurements':tm,'a_pose_local_sleeve_degrees':f[id]['a_pose_local_sleeve_degrees']})
    canvas=Image.new('RGB',(5400,1280),'#E5E5E5');draw=ImageDraw.Draw(canvas);font=ImageFont.truetype(FONT,32);cols=[]
    for i,id in enumerate(IDS):
        cols.append(place(canvas,P/f'{id}-front.png',i,900,1032 if i<3 else 960,1132))
        draw.text((i*900+40,1182),id,font=font,fill='#283A35')
    save_new(canvas,P/'lineup.png');layouts.append({'file':'lineup.png','columns':cols,'column_width':900,'px_per_cm':6,'sole_y':1132,'male_full_height_px':1032,'female_full_height_px':960})
    comparison=Image.new('RGB',(3600,1280),'#EEEEEE');draw=ImageDraw.Draw(comparison);font=ImageFont.truetype(FONT,25);face_records=[]
    for i,id in enumerate(IDS):
        source=A/f'attached-{id.split("-")[1]}-{id[-1]}-front.png' if id[-1]!='c' else H/f'{id}-front.png'
        x=(i%3)*1200;y=(i//3)*640
        for j,src in enumerate([source,P/f'{id}-front.png']):
            crop=Image.open(src).convert('RGB').crop((480,0,760,280)).resize((560,560),Image.Resampling.LANCZOS)
            comparison.paste(crop,(x+j*600,y+42))
            label=('STYLE APPROVED' if id[-1]!='c' else 'PREVIOUS C (not approved)') if j==0 else 'NEW issue167'
            draw.text((x+j*600+10,y+606),label,font=font,fill='#283A35')
        draw.text((x+10,y+6),id,font=font,fill='#283A35')
        face_records.append({'id':id,'before':str(source.relative_to(P)),'before_sha256':sha(source),'after':id+'-front.png','crop':[480,0,760,280],'same_scale':2,'before_human_approved_style':id[-1]!='c'})
    save_new(comparison,P/'approved-face-comparison.png')
    generations=json.loads((S/'generation-records.json').read_text())
    for g in generations:
        g['raw_sha256']=sha(Path(g['raw_path']));g['input_snapshots']=[]
        for input in g['inputs']:
            path=Path(input)
            if path.parent==P:path=H/path.name
            g['input_snapshots'].append({'path':str(path),'sha256':sha(path)})
        if g['selected']:assert sha(P/g['repository_output'])==g['raw_sha256']
    assert sum(g['selected'] for g in generations)==18
    dump(P/'production-generations.json',generations)
    data={'issue':167,'sourceId':'claude-code:webcad-planner/walk-characters-design-v2-proportion-2026-10-14','sourceSessionId':'fbf688bf-1ba3-4478-bef4-3ba2070ab0ed','style_basis_head':'1f1815e5ca7aca53d0893152e9f2926877c05c68','previous_issue143_head':'e7fb1a30899e40aa35ae44fd0c1983eb567f494c','style_only_approval':True,'required_head_units':[5.3,5.8],'three_d_deliverables':False,'designs':designs,'layouts':layouts,'face_comparison':face_records,'operations':['exact native official output copy','bbox crop','isotropic composite scaling','labels'],'deliverable_pngs':[{'file':q.name,'sha256':sha(q),'bytes':q.stat().st_size,'size':list(Image.open(q).size)} for q in sorted(P.glob('*.png'))],'not_tested':['hidden back chin/anatomical joint angles','same exact3Dprojection','human final selection of revised proportions','material physics','3D/rig/animation','app/browser/real room'],'library':None}
    dump(P/'final-inspection.json',data)
    dump(P/'library-save-status.json',{'issue':167,'status':'deferred_to_parent','reason':'Current Library skill/helper source became unavailable after capability update; cloud skill list empty and helper fetch failed. No unofficial or stale-helper save attempted. Parent authorized PR/file delivery first and will check formal route.','current_revision_library_file_id':None,'previous_issue143_library_preserved':['libfile_958eda43d7908191a1c635ab01097b5f','libfile_d0bf6ac10bcc8191bdbba3f173c5ae21']})
    print('Packaged26PNG,18 native selected;39 generation records')
    for d in designs:print(d['id'],{v:round(t['head_units'],6) for v,t in d['turnaround_head_measurements'].items() if t['head_units'] is not None})

if __name__=='__main__':main()
