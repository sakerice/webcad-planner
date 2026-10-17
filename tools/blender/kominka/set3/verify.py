"""Independent inspection of final GLB buffers, real pixels and reproduction.
Requires numpy/Pillow. No reliance on Blender's cached obj.dimensions.
"""
import argparse
import hashlib
import importlib.util
import json
import struct
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ID = 'kominka-kitchen-run-2560-01'
spec = importlib.util.spec_from_file_location('first_verify', HERE.parent/'verify.py')
V = importlib.util.module_from_spec(spec)
spec.loader.exec_module(V)


def positions_by_material(path):
    raw = path.read_bytes()
    n = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+n])
    buffer = raw[28+n:]
    def acc(i):
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        assert a['componentType'] == 5126 and a['type'] == 'VEC3'
        return np.ndarray((a['count'], 3), dtype='<f4', buffer=buffer,
            offset=v.get('byteOffset', 0)+a.get('byteOffset', 0),
            strides=(v.get('byteStride', 12), 4)).copy()
    assert len(doc['nodes']) == 1 and len(doc['meshes']) == 1
    node = doc['nodes'][0]
    assert node.get('scale', [1,1,1]) == [1,1,1]
    assert node.get('translation', [0,0,0]) == [0,0,0]
    assert node.get('rotation', [0,0,0,1]) == [0,0,0,1]
    assert node['extras']['frontAxis'] == '+Z' and node['extras']['upAxis'] == '+Y'
    assert node['extras']['pivot'] == 'bottom-center'
    points = {}
    for prim in doc['meshes'][0]['primitives']:
        name = doc['materials'][prim['material']]['name']
        points[name] = acc(prim['attributes']['POSITION']).astype(float)
    return doc, points


def pixels(path, size=(512,512), transparent=False):
    im = Image.open(path)
    im.load()
    assert im.size == size, (path, im.size)
    ar = np.asarray(im)
    if transparent:
        V.image_check(path, True)
        mask = ar[:,:,3] > 8
        alpha = dict(zero=int(np.count_nonzero(ar[:,:,3]==0)),
            opaque=int(np.count_nonzero(ar[:,:,3]==255)))
    else:
        corner = np.median(np.array([ar[0,0], ar[-1,0], ar[0,-1], ar[-1,-1]]), axis=0)
        mask = np.max(np.abs(ar.astype(float)-corner), axis=2)>15
        alpha = None
    y,x = np.where(mask)
    assert len(x)>1000 and np.std(ar[mask,:3])>8, (path, 'Blank image')
    bounds = [int(x.min()),int(y.min()),int(x.max()),int(y.max())]
    assert min(bounds[0],bounds[1],size[0]-1-bounds[2],size[1]-1-bounds[3])>=5
    return dict(path=str(path.relative_to(ROOT)),size=list(im.size),mode=im.mode,
        occupiedPixels=int(len(x)),contentBoundsPx=bounds,alpha=alpha,sha256=V.sha(path))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--replay-root', type=Path, required=True)
    p.add_argument('--source-root', type=Path, required=True)
    a = p.parse_args()
    manifest_path = 'assets/models/packs/kominka/manifest.json'
    manifest = json.loads((ROOT/manifest_path).read_text())
    baseline = json.loads(subprocess.check_output(['git','show',f'origin/main:{manifest_path}'],cwd=ROOT))
    assert manifest['items'][:-1] == baseline['items'], 'Existing manifest row changed'
    item = manifest['items'][-1]
    assert item['id'] == ID and sum(i['id']==ID for i in manifest['items']) == 1
    assert [item[k] for k in ('w','d','h')] == [2560,650,850]
    assert item['kind']=='cooktop' and item['group']=='住設' and item['provenance']=='original'
    model = ROOT/item['model']
    g = V.glb(model)
    bounds = g.pop('bounds')
    channels = g.pop('channels')
    dims = (bounds[1]-bounds[0])[[0,2,1]]*1000
    assert np.max(np.abs(dims-[2560,650,850])) < 1
    assert abs(bounds[0,1])<1e-6 and np.max(np.abs(bounds.sum(axis=0)[[0,2]]))<1e-6
    assert g['triangles']<=20000 and g['uvDegenerate']==g['geometryDegenerate']==0
    assert channels=={'wood','stone','plaster','metal'}=={c['key'] for c in item['finishChannels']}
    doc, pts = positions_by_material(model)
    # Actual geometry: recessed fire mouths and pull handles face glTF +Z.
    fire = pts['Kominka_fire']
    iron = pts['Kominka_metal']
    assert fire[:,2].min()>.17 and fire[:,1].max()<.42
    handle = iron[(iron[:,1]<.62) & (iron[:,0]<.285)]
    assert len(handle)>100 and handle[:,2].min()>.25
    # Actual lathe vertices prove both pot rims remain circular after export.
    circles = []
    for cx in (.515,1.030):
        band = iron[(abs(iron[:,1]-.712)<1e-6) & (abs(iron[:,0]-cx)<.217)]
        radius = np.sqrt((band[:,0]-cx)**2 + (band[:,2]-.005)**2)
        radius = radius[abs(radius-.216)<.002]
        assert len(radius)>=40 and np.ptp(radius)<1e-6
        circles.append(dict(centerX=cx,radiusMm=float(np.mean(radius)*1000),
            radialVariationMm=float(np.ptp(radius)*1000)))
    for mid in ('kominka-sink-01','kominka-kamado-01'):
        old = V.glb(ROOT/f'assets/models/packs/kominka/models/{mid}.glb')
        oldm = {m['name']:m for m in old['materials']}
        for m in g['materials']:
            if m['name'] in oldm:
                assert np.max(np.abs(np.array(m['baseColor'])-oldm[m['name']]['baseColor']))<1e-6
    for material in doc['materials']:
        assert not any(k.endswith('Texture') for k in material.get('pbrMetallicRoughness', {}))
    source = HERE/f'sources/{ID}.blend'
    check = json.loads((HERE/f'sources/{ID}-validation.json').read_text())
    assert source.exists() and check['triangles']==g['triangles']
    assert check['uv']['excluded_triangles']==0
    assert V.sha(model)==V.sha(a.replay_root/item['model']), 'Script regeneration differs'
    assert V.sha(model)==V.sha(a.source_root/f'{ID}.glb'), 'Blend re-export differs'
    images = [pixels(ROOT/item[k],transparent=True) for k in ('thumb','top')]
    images += [pixels(HERE/f'evidence/{ID}-{v}.jpg') for v in ('front','rear')]
    images += [pixels(HERE/'evidence/compare-kitchen.jpg',size=(1024,512))]
    for rec in images:
        original = np.asarray(Image.open(ROOT/rec['path']))
        replay = np.asarray(Image.open(a.replay_root/rec['path']))
        assert np.array_equal(original,replay), (rec['path'],'Regenerated pixels differ')
        rec['regeneratedPixels'] = 'identical'
    independent = json.loads((HERE/'glb-reimport-validation.json').read_text())
    assert independent['triangles']==g['triangles'] and independent['uv']['excluded_triangles']==0
    record = dict(id=ID,sourceOrder=dict(branch='claude/kominka-kitchen',
        blobSha='7cce2dde555c8225c814e7ee9bf83692ab6925a8',
        commonOrderSha='eaec626ece41e1eff4de3273ca52a831323ea08c'),
        measuredMm=dims.tolist(),boundsGltfM=bounds.tolist(),**g,
        finishChannels=item['finishChannels'],circularPotRims=circles,
        images=images,glbSha256=V.sha(model),blendSha256=V.sha(source),
        blenderReimport=independent,
        checks=dict(modelKit='pass',independentGlbBuffers='pass',unitsAxesOrigin='pass',
            actualFrontGeometry='pass: handles and hearths face +Z',uv='pass',
            fourMaterialChannels='pass',existingPalette='pass',noGlobalScaling='pass',
            manifestAppendOnly='pass',pixelsAlphaFraming='pass',
            scriptRegeneration='byte-identical GLB',blendReexport='byte-identical GLB',
            imageRegeneration='all five images pixel-identical',
            browser='not performed: browser operation prohibited',
            appPlacementAndFinishInteraction='not performed: Claude owns integration'))
    (HERE/'delivery-validation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(measuredMm=record['measuredMm'],triangles=g['triangles'],
        checks=record['checks']),ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
