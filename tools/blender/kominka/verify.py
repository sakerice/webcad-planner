"""Inspect shipped GLB buffers/images rather than trusting builder metadata.
Python verify.py [--replay-root /tmp/kominka-replay] [--source-root /tmp/kominka-source]
Requires numpy/Pillow. Fails on geometry, dimensions, UVs, channel or proof errors.
"""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def glb(path):
    raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<III',raw)
    assert magic==0x46546c67 and version==2 and length==len(raw),path
    offset=12;doc=None;buffer=None
    while offset<len(raw):
        n,kind=struct.unpack_from('<II',raw,offset);offset+=8
        data=raw[offset:offset+n];offset+=n
        if kind==0x4e4f534a:doc=json.loads(data)
        elif kind==0x004e4942:buffer=data
    assert doc is not None and buffer is not None,path
    def accessor(index):
        a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
        dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        count={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        pos=view.get('byteOffset',0)+a.get('byteOffset',0)
        stride=view.get('byteStride',np.dtype(dtype).itemsize*count)
        return np.ndarray((a['count'],count),dtype=dtype,buffer=buffer,offset=pos,strides=(stride,np.dtype(dtype).itemsize)).copy()
    def node_matrix(node):
        if 'matrix' in node:return np.array(node['matrix']).reshape((4,4),order='F')
        x,y,z,w=node.get('rotation',[0,0,0,1]);matrix=np.eye(4)
        matrix[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(node.get('scale',[1,1,1]))
        matrix[:3,3]=node.get('translation',[0,0,0]);return matrix
    points=[];triangles=0;uvdegenerate=0;geometrydegenerate=0;channels=set();mats=[]
    def visit(ni,parent):
        nonlocal triangles,uvdegenerate,geometrydegenerate
        node=doc['nodes'][ni];matrix=parent@node_matrix(node)
        if 'mesh' in node:
            for prim in doc['meshes'][node['mesh']]['primitives']:
                assert prim.get('mode',4)==4,path
                pos=accessor(prim['attributes']['POSITION']).astype(float)
                pos=(matrix@np.c_[pos,np.ones(len(pos))].T).T[:,:3]
                assert np.isfinite(pos).all(),path
                uv=accessor(prim['attributes']['TEXCOORD_0']).astype(float)
                assert np.isfinite(uv).all() and np.ptp(uv,axis=0).min()>.01,path
                ix=accessor(prim['indices']).reshape((-1,3));triangles+=len(ix)
                a,b,c=pos[ix[:,0]],pos[ix[:,1]],pos[ix[:,2]]
                geom=np.linalg.norm(np.cross(b-a,c-a),axis=1)/2
                u,v,t=uv[ix[:,0]],uv[ix[:,1]],uv[ix[:,2]]
                areas=np.abs((v[:,0]-u[:,0])*(t[:,1]-u[:,1])-(v[:,1]-u[:,1])*(t[:,0]-u[:,0]))/2
                uvdegenerate+=int(np.count_nonzero(areas<=1e-14))
                geometrydegenerate+=int(np.count_nonzero(geom<=1e-14))
                points.append(pos)
                mat=doc['materials'][prim['material']]
                channel=mat.get('extras',{}).get('finishChannel')
                if channel:channels.add(channel)
        for child in node.get('children',[]):visit(child,matrix)
    for ni in doc['scenes'][doc.get('scene',0)]['nodes']:visit(ni,np.eye(4))
    for mat in doc['materials']:
        if mat['name']=='Glass':
            assert mat.get('alphaMode')=='BLEND',path
            assert not mat.get('extras',{}).get('finishChannel'),path
            color=mat['pbrMetallicRoughness']['baseColorFactor']
            assert abs(color[3]-.25)<1e-5,path
        assert 'baseColorTexture' not in mat.get('pbrMetallicRoughness',{}),path
        mats.append(dict(name=mat['name'],channel=mat.get('extras',{}).get('finishChannel'),
              baseColor=mat['pbrMetallicRoughness']['baseColorFactor'],alphaMode=mat.get('alphaMode','OPAQUE')))
    pts=np.concatenate(points)
    return dict(bounds=np.array([pts.min(axis=0),pts.max(axis=0)]),triangles=triangles,
                uvDegenerate=uvdegenerate,geometryDegenerate=geometrydegenerate,channels=channels,materials=mats)


def image_check(path,transparent=False):
    im=Image.open(path)
    assert im.size==(512,512),(path,im.size)
    if transparent:
        assert im.mode=='RGBA',(path,im.mode)
        alpha=np.array(im)[:,:,3]
        assert alpha.min()==0 and alpha.max()==255,path
        occupied=alpha>8
        ys,xs=np.where(occupied)
        assert len(xs)>100,path
        assert min(xs.min(),ys.min(),511-xs.max(),511-ys.max())>=5,(path,'cropped')
    else:
        assert im.format=='JPEG',path
        pixels=np.asarray(im,dtype=float)
        background=np.median(np.array([pixels[0,0],pixels[0,-1],pixels[-1,0],pixels[-1,-1]]),axis=0)
        border=np.concatenate([pixels[:4].reshape(-1,3),pixels[-4:].reshape(-1,3),
                               pixels[:,:4].reshape(-1,3),pixels[:,-4:].reshape(-1,3)])
        assert np.max(np.abs(border-background))<12,(path,'JPEG cropped at border')


def main():
    p=argparse.ArgumentParser();p.add_argument('--replay-root',type=Path);p.add_argument('--source-root',type=Path)
    args=p.parse_args()
    manifest=json.loads((ROOT/'assets/models/packs/kominka/manifest.json').read_text())
    catalogue=json.loads((HERE/'catalogue.json').read_text())
    assert len(manifest['items'])==32
    expected={f'kominka-{it["stem"]}-01':it for it in catalogue['items']}
    records=[];evidence=[]
    for item in manifest['items']:
        mid=item['id'];want=expected[mid];model=ROOT/item['model'];g=glb(model)
        bounds=g.pop('bounds');channels=g.pop('channels')
        dims=(bounds[1]-bounds[0])[[0,2,1]]*1000
        assert np.max(np.abs(dims-want['size']))<1,(mid,dims)
        assert np.max(np.abs(bounds.sum(axis=0)[[0,2]]))<1e-6,(mid,bounds)
        assert abs(bounds[0,1])<1e-6,(mid,bounds)
        assert g['uvDegenerate']==g['geometryDegenerate']==0,(mid,g)
        assert g['triangles']<=(8000 if 'category' in want else 20000),(mid,g)
        assert channels=={c['key'] for c in item['finishChannels']},(mid,channels)
        assert [item[k] for k in ('w','d','h')]==want['size']
        assert item['group']==want.get('group','家具') and item['provenance']=='original'
        if 'category' in want:assert item['category']==want['category'] and 'kind' not in item
        else:assert item['kind']==want['kind']
        if 'defaultElevation' in want:assert item['defaultElevation']==want['defaultElevation']
        source=HERE/'sources'/f'{mid}.blend';validation=HERE/'sources'/f'{mid}-validation.json'
        assert source.exists() and validation.exists(),mid
        report=json.loads(validation.read_text())
        assert report['triangles']==g['triangles'],mid
        assert report['uv']['excluded_triangles']==0 and report['front_gltf']=='+Z',mid
        files=[source,model,validation]
        for key in ('thumb','top'):
            path=ROOT/item[key];image_check(path,True);files.append(path)
        for key in ('front','rear')+ (('w120-h80','w80-h120') if 'category' in want else ()):
            path=HERE/'evidence'/f'{mid}-{key}.jpg';image_check(path);files.append(path)
        rec=dict(id=mid,name=item['name'],measuredMm=dims.tolist(),triangles=g['triangles'],
                 boundsGltfM=bounds.tolist(),finishChannels=item['finishChannels'],materials=g['materials'],
                 source=str(source.relative_to(ROOT)),glbSha256=sha(model),checks='pass')
        if args.replay_root:
            replay=args.replay_root/item['model'];assert sha(replay)==sha(model),(mid,'script regeneration differs')
            rec['regeneration']='byte-identical GLB'
        if args.source_root:
            replay=args.source_root/f'{mid}.glb';assert sha(replay)==sha(model),(mid,'blend re-export differs')
            rec['blendReexport']='byte-identical GLB'
        records.append(rec)
        evidence.extend(dict(path=str(path.relative_to(ROOT)),sha256=sha(path)) for path in files)
    textures=[]
    for it in catalogue['textures']:
        checks=[]
        for suffix in ('diffuse','normal','roughness'):
            path=ROOT/'assets/textures/kominka'/f'{it["key"]}_{suffix}.jpg'
            im=Image.open(path);assert im.size==(1024,1024) and im.format=='JPEG',path
            data=np.asarray(im,dtype=float)
            edge=(np.abs(data[0]-data[-1]).mean()+np.abs(data[:,0]-data[:,-1]).mean())/2
            # JPEG quantisation changes matching edge samples; pre-encode exact
            # periodicity is guaranteed by textures.py. Mean error <= 4/255.
            assert edge<4,(path,edge)
            if suffix=='normal':
                norms=data/127.5-1
                assert np.mean(np.abs(np.linalg.norm(norms,axis=-1)-1))<.06,path
                assert np.min(data[:,:,2])>=128,path
            if args.replay_root:assert sha(path)==sha(args.replay_root/path.relative_to(ROOT)),path
            checks.append(dict(map=suffix,edgeMean=edge,sha256=sha(path)))
            evidence.append(dict(path=str(path.relative_to(ROOT)),sha256=sha(path)))
        assert (HERE/'evidence'/f'{it["key"]}-tile4.jpg').exists(),it
        textures.append(dict(it,maps=checks,checks='pass'))
    delivery=dict(modelCount=32,textureCount=6,textureMapCount=18,models=records,textures=textures,
        evidence=evidence,tests=dict(glbBuffers='pass',dimensions='pass',origin='pass',uv='pass',
        materialChannels='pass',glass='pass',previewAlphaAndFraming='pass',modelKit='pass',
        regeneration='pass' if args.replay_root else 'not run',blendReexport='pass' if args.source_root else 'not run',
        browser='not performed: Mac browser use prohibited',appIntegration='not performed: Claude owns integration'))
    (HERE/'delivery-validation.json').write_text(json.dumps(delivery,ensure_ascii=False,indent=2)+'\n')
    print('PASS: 32 GLBs, 64 PNGs, 64 front/rear JPEGs, 14 stretch JPEGs, 18 texture maps')
    print('Regeneration:',delivery['tests']['regeneration'],'Blend re-export:',delivery['tests']['blendReexport'])

if __name__=='__main__':main()
