"""Independent shipped GLB/image inspections; compare regenerated and source exports.
python verify.py --replay-root /tmp/kominka-set2-replay --source-root /tmp/kominka-set2-reexport
Use a Python environment with numpy/Pillow. No browser or external network is used.
"""
import argparse,hashlib,importlib.util,json,struct,subprocess
from pathlib import Path
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
spec=importlib.util.spec_from_file_location('kominka_inspect',HERE.parent/'verify.py')
V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
sha=V.sha


def geometry_signature(path):
    """Triangle positions/normals and materials independent of vertex/UV atlas order."""
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length]);buffer=raw[28+length:]
    def acc(index):
        a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
        dt=np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']])
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        return np.ndarray((a['count'],n),dtype=dt,buffer=buffer,
          offset=view.get('byteOffset',0)+a.get('byteOffset',0),strides=(view.get('byteStride',dt.itemsize*n),dt.itemsize)).copy()
    parts=[]
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            pos=acc(prim['attributes']['POSITION']);norm=acc(prim['attributes']['NORMAL'])
            ix=acc(prim['indices']).reshape(-1,3);triangles=[]
            for tri in ix:
                vertices=[tuple(np.r_[pos[j],norm[j]].tolist()) for j in tri]
                # Cyclic rotation preserves winding; reversed normals/triangles fail.
                start=min(range(3),key=lambda i:vertices[i])
                triangles.append(tuple(vertices[start:]+vertices[:start]))
            triangles.sort()
            mat=doc['materials'][prim['material']]
            parts.append(dict(material=mat,triangles=triangles))
    parts.sort(key=lambda part:part['material']['name'])
    # Node transforms/extras are also compared, so axis or placement cannot slip.
    payload=dict(parts=parts,nodes=doc['nodes'],scenes=doc['scenes'])
    return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def image_check(path,transparent):
    V.image_check(path,transparent)
    im=Image.open(path);arr=np.asarray(im)
    if transparent:
        alpha=arr[:,:,3];ys,xs=np.where(alpha>8)
        return dict(size=list(im.size),mode=im.mode,occupiedPixels=len(xs),
                    alphaRange=[int(alpha.min()),int(alpha.max())],
                    margins=[int(xs.min()),int(511-xs.max()),int(ys.min()),int(511-ys.max())])
    return dict(size=list(im.size),format=im.format)


def scope_check(ids,base):
    old_text=subprocess.check_output(['git','show',base+':assets/models/packs/kominka/manifest.json'],cwd=ROOT,text=True)
    old=json.loads(old_text);new=json.loads((ROOT/'assets/models/packs/kominka/manifest.json').read_text())
    assert new['items'][:len(old['items'])]==old['items'],'existing manifest items changed'
    assert new['items'][len(old['items']):] and {it['id'] for it in new['items'][len(old['items']):]}==ids
    assert {k:v for k,v in new.items() if k!='items'}=={k:v for k,v in old.items() if k!='items'}
    paths=set(subprocess.check_output(['git','diff','--name-only',base],cwd=ROOT,text=True).splitlines())
    paths.update(subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines())
    paths={p for p in paths if '__pycache__/' not in p}
    for path in sorted(paths):
        if path=='assets/models/packs/kominka/manifest.json':continue
        if path.startswith('tools/blender/kominka/set2/'):continue
        allowed=False
        for mid in ids:
            allowed|=path==f'assets/models/packs/kominka/models/{mid}.glb'
            allowed|=path in [f'assets/models/packs/kominka/previews/{mid}-{view}.png' for view in ('thumb','top')]
        assert allowed,('out of scope',path)
        # The new asset IDs must not have existed at the main baseline.
        assert subprocess.run(['git','cat-file','-e',base+':'+path],cwd=ROOT,capture_output=True).returncode!=0,('existing asset',path)
    return dict(base=subprocess.check_output(['git','rev-parse',base],cwd=ROOT,text=True).strip(),
                oldItemCount=len(old['items']),newItemCount=len(ids),changedPaths=sorted(paths),checks='pass')


def main():
    p=argparse.ArgumentParser();p.add_argument('--replay-root',type=Path);p.add_argument('--source-root',type=Path)
    p.add_argument('--base',default='origin/main');a=p.parse_args()
    wants=json.loads((HERE/'catalogue.json').read_text())['items'];ids={it['id'] for it in wants}
    allitems=json.loads((ROOT/'assets/models/packs/kominka/manifest.json').read_text())['items']
    items={it['id']:it for it in allitems if it['id'] in ids};assert len(items)==26
    records=[];evidence=[]
    for want in wants:
        mid=want['id'];it=items[mid];model=ROOT/it['model'];g=V.glb(model)
        bounds=g.pop('bounds');channels=g.pop('channels');dims=(bounds[1]-bounds[0])[[0,2,1]]*1000
        assert np.max(np.abs(dims-want['size']))<1,(mid,dims)
        assert np.max(np.abs(bounds.sum(axis=0)[[0,2]]))<1e-6 and abs(bounds[0,1])<1e-6,(mid,bounds)
        assert g['uvDegenerate']==g['geometryDegenerate']==0,(mid,g)
        assert g['triangles']<=20000 and g['triangles']>0,mid
        assert channels=={c['key'] for c in it['finishChannels']},(mid,channels)
        assert it['name']==want['name'] and it['group']==want['group'] and it['provenance']=='original'
        assert [it[k] for k in ('w','d','h')]==want['size']
        if 'kind' in want:assert it['kind']==want['kind']
        else:assert 'kind' not in it and it['category']=='車'
        assert it.get('defaultElevation')==want.get('defaultElevation'),mid
        for m in g['materials']:
            # Fixed white ceramic has no recolourable channel as required by model_kit.
            if m['name']=='Kominka_WhiteCeramic':assert not m['channel']
        validation=HERE/'sources'/f'{mid}-validation.json';source=HERE/'sources'/f'{mid}.blend'
        v=json.loads(validation.read_text());assert source.exists() and v['triangles']==g['triangles']
        assert v['uv']['excluded_triangles']==0 and v['uv']['p95']/v['uv']['p05']<2
        assert v['front_blender']=='-Y' and v['front_gltf']=='+Z'
        pics={}
        for view in ('thumb','top','front','rear'):
            path=ROOT/it[view] if view in ('thumb','top') else HERE/'evidence'/f'{mid}-{view}.jpg'
            pics[view]=image_check(path,view in ('thumb','top'));evidence.append(dict(path=str(path.relative_to(ROOT)),sha256=sha(path)))
        rec=dict(id=mid,name=it['name'],kind=it.get('kind'),group=it['group'],defaultElevation=it.get('defaultElevation'),
                 measuredMm=dims.tolist(),boundsGltfM=bounds.tolist(),triangles=g['triangles'],finishChannels=it['finishChannels'],
                 materials=g['materials'],uvExcludedTriangles=0,uvDensityRatio=v['uv']['p95']/v['uv']['p05'],
                 images=pics,source=str(source.relative_to(ROOT)),sourceSha256=sha(source),glbSha256=sha(model),checks='pass')
        if a.replay_root:
            replay=a.replay_root/it['model']
            assert geometry_signature(model)==geometry_signature(replay),(mid,'regeneration geometry/normals/materials differ')
            replay_g=V.glb(replay)
            assert replay_g['uvDegenerate']==replay_g['geometryDegenerate']==0,(mid,'regenerated UV degeneracy')
            assert replay_g['triangles']==g['triangles'] and replay_g['channels']==channels
            replay_v=json.loads((a.replay_root/validation.relative_to(ROOT)).read_text())
            assert replay_v['uv']['excluded_triangles']==0 and replay_v['uv']['p95']/replay_v['uv']['p05']<2
            rec['regeneration']=dict(geometryNormalsMaterials='identical',uv='valid, zero degenerate triangles',
                 byteIdentical=sha(replay)==sha(model),regeneratedSha256=sha(replay))
        if a.source_root:
            assert sha(model)==sha(a.source_root/f'{mid}.glb'),(mid,'blend re-export differs')
            rec['blendReexport']='byte-identical GLB'
        records.append(rec)
    compares=[]
    for group in ('kitchen','storage','wood','cloth','bath','outdoor','additions'):
        path=HERE/'evidence'/f'compare-{group}.jpg';image_check(path,False)
        compares.append(dict(path=str(path.relative_to(ROOT)),sha256=sha(path),lighting='set 1 unchanged Cycles setup; originals rendered together'))
    scope=scope_check(ids,a.base)
    results=dict(modelCount=26,previewCount=52,frontRearCount=52,sameLightComparisonCount=7,
                 models=records,comparisons=compares,imageEvidence=evidence,scope=scope,
                 tests=dict(modelKit='pass: closed manifold, dimensions, pivot, UV, materials, triangles',
                            glbBuffers='pass',dimensions='pass: <1 mm absolute error',origin='pass',
                            axis='GLB X width / Y height / Z depth; Blender -Y -> GLB +Z; visual front/rear review separately',
                            materialChannels='pass',uv='pass: no excluded triangles',previewPixels='pass',
                            regeneration='pass' if a.replay_root else 'not performed',
                            blendReexport='pass' if a.source_root else 'not performed',
                            scope='pass',browser='not performed: prohibited',appIntegration='not performed: Claude owns integration'))
    (HERE/'delivery-validation.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print('PASS: 26 GLBs, 52 transparent PNGs, 52 front/rear JPEGs, 7 same-light comparisons')
    print('Regeneration:',results['tests']['regeneration'],'Blend re-export:',results['tests']['blendReexport'])

if __name__=='__main__':main()
