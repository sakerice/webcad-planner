"""Inspect actual GLB buffers and final icons, without a browser.

python tools/blender/rpg_mansion/doors/validate.py (numpy, Pillow)
"""
import json
import struct
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
IDS=['rpg-mansion-door-six-panel-01','rpg-mansion-door-glazed-01',
     'rpg-mansion-door-ledged-01','rpg-mansion-entrance-door-01','rpg-mansion-entrance-door-glazed-01']


def glb_read(path):
    data=path.read_bytes()
    magic,version,total=struct.unpack_from('<4sII',data)
    assert magic==b'glTF' and version==2 and total==len(data)
    jl,jtype=struct.unpack_from('<II',data,12)
    doc=json.loads(data[20:20+jl])
    bl,btype=struct.unpack_from('<II',data,20+jl)
    assert jtype==0x4E4F534A and btype==0x004E4942
    binary=data[28+jl:28+jl+bl]
    def accessor(idx):
        a=doc['accessors'][idx];bv=doc['bufferViews'][a['bufferView']]
        dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        offset=bv.get('byteOffset',0)+a.get('byteOffset',0)
        item=np.dtype(dt).itemsize
        return np.ndarray((a['count'],width),dtype=dt,buffer=binary,offset=offset,
                          strides=(bv.get('byteStride',item*width),item)).copy()
    return doc,accessor


def matrix(node):
    if 'matrix' in node:return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1])
    m=np.eye(4)
    m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                      [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]) @ np.diag(node.get('scale',[1,1,1]))
    m[:3,3]=node.get('translation',[0,0,0])
    return m


def inspect(stem,icons=True):
    path=ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb')
    doc,read=glb_read(path)
    assert len(doc['meshes'])==1
    assert not doc.get('animations') and not doc.get('skins')
    points=[];metalpoints=[];tris=0;uvbad=0;worldbad=0
    def visit(idx,parent):
        nonlocal tris,uvbad,worldbad
        node=doc['nodes'][idx];world=parent@matrix(node)
        if 'mesh' in node:
            assert node.get('extras',{}).get('doorLeafOnly') is True
            assert node['extras']['front']=='+Z'
            for p in doc['meshes'][node['mesh']]['primitives']:
                assert p.get('mode',4)==4
                vertices=read(p['attributes']['POSITION'])
                vertices=(world@np.c_[vertices,np.ones(len(vertices))].T).T[:,:3]
                points.append(vertices)
                indices=read(p['indices']).reshape(-1,3)
                uv=read(p['attributes']['TEXCOORD_0'])
                assert np.isfinite(uv).all()
                a,b,c=uv[indices[:,0]],uv[indices[:,1]],uv[indices[:,2]]
                area=abs((b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(b[:,1]-a[:,1])*(c[:,0]-a[:,0]))/2
                uvbad+=int((area<1e-14).sum())
                a,b,c=vertices[indices[:,0]],vertices[indices[:,1]],vertices[indices[:,2]]
                worldbad+=int((np.linalg.norm(np.cross(b-a,c-a),axis=1)<2e-14).sum())
                tris+=len(indices)
                mat=doc['materials'][p['material']]
                if mat.get('extras',{}).get('finishChannel')=='metal':metalpoints.append(vertices)
        for child in node.get('children',[]):visit(child,world)
    for idx in doc['scenes'][doc.get('scene',0)]['nodes']:visit(idx,np.eye(4))
    points=np.concatenate(points);lo=points.min(axis=0);hi=points.max(axis=0)
    target=[940,2300,90] if 'entrance' in stem else [760,2000,60]
    got=(hi-lo)*1000
    assert np.max(abs(got-target))<.05,(stem,got)
    assert abs(lo[1])<1e-6 and abs(lo[0]+hi[0])<1e-6 and abs(lo[2]+hi[2])<1e-6
    assert tris<=12000 and uvbad==0 and worldbad==0,(stem,tris,uvbad,worldbad)
    channels={m['name']:m.get('extras',{}).get('finishChannel') for m in doc['materials']}
    assert set(v for v in channels.values() if v)=={'wood','metal'}
    glass=[]
    for m in doc['materials']:
        if m['name'].startswith('Glass'):
            assert 'finishChannel' not in m.get('extras',{})
            assert m['alphaMode']=='BLEND' and abs(m['pbrMetallicRoughness']['baseColorFactor'][3]-.25)<1e-5
            glass.append(m['name'])
    assert len(glass)==(4 if 'entrance-door-glazed' in stem else 1 if 'door-glazed' in stem else 0)
    metalpoints=np.concatenate(metalpoints)
    edge=metalpoints[metalpoints[:,0]>.20]
    depth=target[2]/2000
    assert edge[:,2].max()>=depth-1e-5 and edge[:,2].min()<=-depth+1e-5,'Two-face +X controls missing'
    native=json.loads((HERE/'sources'/(stem+'-validation.json')).read_text())
    assert native['triangles']==tris
    assert native['uv']['excluded_triangles']==0
    result=dict(id=stem,dimensions_mm_W_D_H=[float(got[i]) for i in (0,2,1)],triangles=tris,
                uv_degenerate=uvbad,geometry_degenerate=worldbad,channels=channels,glass_materials=glass,
                two_face_controls=True,origin='bottom centre',front='+Z',native_model_kit='pass')
    if icons:
        result['icons']={}
        for view in ('thumb','top'):
            image=Image.open(ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-'+view+'.png'))
            assert image.size==(512,512) and image.mode=='RGBA'
            alpha=np.asarray(image)[:,:,3]
            assert alpha.min()==0 and alpha.max()>200
            bbox=image.getchannel('A').getbbox()
            assert bbox[0]>0 and bbox[1]>0 and bbox[2]<512 and bbox[3]<512,(stem,view,bbox)
            result['icons'][view]=dict(size=[512,512],rgba=True,alpha_bounds=bbox)
    return result


if __name__=='__main__':
    import sys
    report=dict(checks='actual exported GLB buffers; model_kit records; icon alpha',
                browser_check='not performed: browser use prohibited',
                visual_review='pending',models=[inspect(s,icons='--no-icons' not in sys.argv) for s in IDS])
    (HERE/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
