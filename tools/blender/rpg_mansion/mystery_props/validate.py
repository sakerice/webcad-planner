"""Actual mystery GLB buffers and icon checks; compile concise review images.

python tools/blender/rpg_mansion/mystery_props/validate.py (numpy, Pillow)
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent/'doors'))
from validate import glb_read,matrix


def check(native,icons=True):
    stem=native['model'];doc,read=glb_read(ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb'))
    assert len(doc['meshes'])==1 and not doc.get('animations')
    points=[];triangles=0;bad_uv=0;bad_world=0
    def visit(idx,parent):
        nonlocal triangles,bad_uv,bad_world
        node=doc['nodes'][idx];world=parent@matrix(node)
        if 'mesh' in node:
            assert node['extras']['front']=='+Z' and node['extras']['bloodlessGameProp'] is True
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                p=read(primitive['attributes']['POSITION']);p=(world@np.c_[p,np.ones(len(p))].T).T[:,:3]
                points.append(p);uv=read(primitive['attributes']['TEXCOORD_0']);idxs=read(primitive['indices']).reshape(-1,3)
                a,b,c=uv[idxs[:,0]],uv[idxs[:,1]],uv[idxs[:,2]]
                area=abs((b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(b[:,1]-a[:,1])*(c[:,0]-a[:,0]))/2
                bad_uv+=int((area<1e-14).sum())
                a,b,c=p[idxs[:,0]],p[idxs[:,1]],p[idxs[:,2]]
                bad_world+=int((np.linalg.norm(np.cross(b-a,c-a),axis=1)<2e-14).sum())
                triangles+=len(idxs)
        for child in node.get('children',[]):visit(child,world)
    for node in doc['scenes'][doc.get('scene',0)]['nodes']:visit(node,np.eye(4))
    p=np.concatenate(points);lo=p.min(axis=0);hi=p.max(axis=0)
    actual=(hi-lo)*1000;expected=np.array(native['dimensions_mm'])[[0,2,1]]
    assert np.max(abs(actual-expected))<.05
    assert abs(lo[1])<1e-6 and abs(lo[0]+hi[0])<1e-6 and abs(lo[2]+hi[2])<1e-6
    assert triangles==native['triangles'] and triangles<=12000 and bad_uv==bad_world==0
    assert native['uv']['excluded_triangles']==0
    channels={m['name']:m.get('extras',{}).get('finishChannel') for m in doc['materials']}
    assert set(v for v in channels.values() if v)==set(v for v in native['materials'].values() if v)
    glass=[]
    for m in doc['materials']:
        if m['name'].startswith('Glass'):
            assert m.get('alphaMode')=='BLEND' and not m.get('extras',{}).get('finishChannel')
            glass.append(m['name'])
    result=dict(id=stem,dimensions_mm_W_D_H=[float(actual[i]) for i in (0,2,1)],triangles=triangles,
                degenerate_world=bad_world,degenerate_uv=bad_uv,channels=channels,glass_materials=glass,
                origin='bottom centre',front='+Z',model_kit='pass')
    if icons:
        result['icons']={}
        for view in ('thumb','top'):
            im=Image.open(ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-'+view+'.png'))
            assert im.size==(512,512) and im.mode=='RGBA'
            alpha=np.asarray(im)[:,:,3];assert alpha.min()==0 and alpha.max()>60
            bbox=im.getchannel('A').getbbox()
            assert bbox and bbox[0]>0 and bbox[1]>0 and bbox[2]<512 and bbox[3]<512,(stem,view,bbox)
            result['icons'][view]=dict(size=[512,512],rgba=True,alpha_bounds=bbox)
    return result


def sheet(models,proof=False):
    if not proof:
        reuse=json.loads((HERE/'reuse.json').read_text())['assets']
        models=models+[dict(id=r['id'],reuse=True,thumb=r['thumb']) for r in reuse]
    cols=4;rows=(len(models)+cols-1)//cols
    # Dark neutral backdrop makes white chalk and transparent glass readable.
    out=Image.new('RGB',(cols*400,rows*(750 if proof else 430)),'#45474b');d=ImageDraw.Draw(out)
    font_path=Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    font=ImageFont.truetype(str(font_path),20) if font_path.exists() else ImageFont.load_default()
    names={'ceramic-ashtray-01':'陶器灰皿','chalk-outline-01':'人型のチョーク跡','corked-bottle-01':'コルク栓の小瓶',
           'evidence-marker-01':'証拠番号札 1','fallen-wine-glass-01':'倒れたワイングラスと破片',
           'glass-ashtray-01':'ガラス灰皿','knife-01':'ナイフ','pocket-watch-01':'懐中時計',
           'rpg-mansion-key-01':'古い真鍮の鍵','rpg-mansion-letter-01':'封蝋付きの手紙'}
    for i,record in enumerate(models):
        stem=record['id'];x=(i%cols)*400;y=(i//cols)*(750 if proof else 430)
        short=stem.replace('rpg-mansion-mystery-','')
        d.text((x+8,y+8),names.get(short,short)+('（既存活用）' if record.get('reuse') else ''),font=font,fill='white')
        paths=[ROOT/record['thumb'] if record.get('reuse') else ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-thumb.png')]
        if proof:paths=[Path('/tmp/webcad-mystery-proofs')/(stem+'-rear.png'),Path('/tmp/webcad-mystery-proofs')/(stem+'-glb.png')]
        for j,path in enumerate(paths):
            im=Image.open(path).convert('RGBA')
            bounds=im.getchannel('A').getbbox()
            if bounds:im=im.crop(bounds)
            im.thumbnail((360,310 if proof else 340))
            iy=y+(55+j*350 if proof else 55)
            out.paste(im,(x+(400-im.width)//2,iy+(340-im.height)//2),im)
            if proof:d.text((x+8,y+32+j*350),'背面' if j==0 else 'GLB 再読込み',font=font,fill='#c9cbd0')
    dest=HERE/'evidence'/('mystery-rear-glb.jpg' if proof else 'mystery-props.jpg')
    dest.parent.mkdir(exist_ok=True);out.save(dest,quality=90,subsampling=0)


if __name__=='__main__':
    native=[json.loads(p.read_text()) for p in sorted((HERE/'sources').glob('*-validation.json'))]
    assert len(native)>=8
    icons='--no-icons' not in sys.argv
    models=[check(n,icons) for n in native]
    report=dict(status='pass',models=models,visual_review='pending',
                browser_check='not performed: browser use prohibited')
    (HERE/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    if icons:sheet(models);sheet(models,True)
    print('PASS:',len(models),'mystery GLBs',flush=True)
