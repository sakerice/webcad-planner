"""Inspect actual GLB buffers and PNG pixels; no browser is started.

python3 tools/blender/rpg_mansion/classic_car/verify.py
python3 tools/blender/rpg_mansion/classic_car/verify.py --compare /tmp/replay-root
python3 tools/blender/rpg_mansion/classic_car/verify.py --compare-source /tmp/source-root
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
import qa_asset_delivery as qa

ID = 'rpg-mansion-classic-sedan-01'
MODEL = Path('assets/models/packs/rpg-mansion/models')/(ID+'.glb')
PREVIEWS = Path('assets/models/packs/rpg-mansion/previews')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(root):
    path = root/MODEL
    doc, binary = qa.load_glb(path)
    geometry = qa.scene_geometry(doc,binary)
    stats = qa.uv_statistics(geometry)
    points = np.concatenate([p['positions'][np.unique(p['indices'])] for p in geometry])
    lo,hi = points.min(axis=0),points.max(axis=0)
    dims = (hi-lo)*1000
    assert len(doc['meshes']) == 1
    assert len(doc['nodes']) == 1
    assert not doc.get('images') and not doc.get('textures')
    assert np.max(np.abs(dims-[1750,1650,4600])) < 1, dims
    assert abs(lo[1]) < 1e-6
    assert max(abs(lo[0]+hi[0]),abs(lo[2]+hi[2])) < 1e-6
    assert stats['triangles'] <= 12000
    for key in ['degenerate_world','degenerate_uv','missing_uv_triangles',
                'nonfinite_position_vertices','nonfinite_uv_vertices']:
        assert stats[key] == 0,(key,stats[key])
    assert stats['p95_p05'] < 2
    assert all('TEXCOORD_0' in g['attributes'] and 'TEXCOORD_1' not in g['attributes'] for g in geometry)
    mats = doc['materials']
    channels = {m.get('extras',{}).get('finishChannel') for m in mats if m.get('extras',{}).get('finishChannel')}
    assert channels == {'body'},channels
    extras = doc['nodes'][0].get('extras',{})
    assert extras['assetId'] == ID and extras['frontAxis'] == '+Z'
    assert extras['upAxis'] == '+Y' and extras['units'] == 'meters'
    assert [m['alphaMode'] for m in mats if m['name']=='Classic window glass'] == ['BLEND']
    # Geometric landmarks prove front/back instead of relying on metadata alone.
    lamp_index = next(i for i,m in enumerate(mats) if m['name']=='Classic headlamp lens')
    tail_index = next(i for i,m in enumerate(mats) if m['name']=='Classic ruby tail lamp')
    lamp_points = np.concatenate([g['positions'] for g in geometry if g['material']==lamp_index])
    tail_points = np.concatenate([g['positions'] for g in geometry if g['material']==tail_index])
    assert lamp_points[:,2].mean() > 2.1 and tail_points[:,2].mean() < -2.0
    return {
        'assetId':ID,'glb_bytes':path.stat().st_size,'glb_sha256':sha(path),
        'gltf_dimensions_mm_xyz':dims.tolist(),'dimensions_mm_wdh':[dims[0],dims[2],dims[1]],
        'bounds_gltf_m':[lo.tolist(),hi.tolist()],'origin':'ground-center',
        'front_landmarks_gltf_z_m':{'headlights':float(lamp_points[:,2].mean()),'tail_lights':float(tail_points[:,2].mean())},
        'triangles':stats['triangles'],'triangle_budget':12000,'uv':stats,
        'mesh_count':len(doc['meshes']),'primitive_count':len(geometry),
        'material_count':len(mats),'finish_channels':sorted(channels),'image_textures':0,
        'material_definitions':mats,
        'signature':qa.shape_signature(doc,geometry),
    }


def png(path,size):
    with Image.open(path) as image:
        assert image.size == size and image.mode == 'RGBA',(path,image.size,image.mode)
        alpha = np.array(image.getchannel('A'))
    ys,xs = np.nonzero(alpha>16)
    assert len(xs)>1000 and alpha.min()==0 and alpha.max()==255,path
    clipped = int((alpha[0]>16).sum()+(alpha[-1]>16).sum()+(alpha[:,0]>16).sum()+(alpha[:,-1]>16).sum())
    assert clipped == 0,(path,clipped)
    return {'path':str(path.relative_to(ROOT)),'size':list(size),'rgba':True,
            'alpha_range':[int(alpha.min()),int(alpha.max())],
            'visible_bbox':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],
            'clipped_edge_pixels':clipped,'sha256':sha(path)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--compare',type=Path)
    parser.add_argument('--compare-source',type=Path)
    args = parser.parse_args()
    report = inspect(ROOT)
    if args.compare:
        other = inspect(args.compare.resolve())
        # A fresh Smart UV pack can choose a different atlas layout. Verify exact
        # geometry/material assignment and inspect every replay UV triangle.
        for key in ('point_support','triangle_counts','triangle_surfaces'):
            assert report['signature'][key] == other['signature'][key],('replay mismatch',key)
        assert report['material_definitions'] == other['material_definitions']
        report['regeneration'] = {'passed':True,'method':'clean factory-startup replay; per-material geometry signatures, PBR values and all UV triangles',
                                  'geometry_identical':True,'materials_identical':True,
                                  'uv_valid_triangles':other['uv']['valid_triangles'],
                                  'uv_p95_p05':other['uv']['p95_p05'],
                                  'same_uv_layout':report['signature']['uv_triangle_mapping']==other['signature']['uv_triangle_mapping'],
                                  'same_glb_sha256':report['glb_sha256']==other['glb_sha256'],
                                  'note':'Fresh UV island packing may vary; use the saved export source to reproduce the delivered atlas exactly.'}
    if args.compare_source:
        other=inspect(args.compare_source.resolve())
        assert report['signature'] == other['signature'],'source re-export mismatch'
        assert report['glb_sha256'] == other['glb_sha256'],'source GLB byte mismatch'
        report['source_reexport']={'passed':True,'same_geometry_materials_uv':True,'same_glb_sha256':True}
    report['previews'] = [png(ROOT/PREVIEWS/(ID+'-'+view+'.png'),(512,512)) for view in ('thumb','top')]
    report['evidence'] = [png(HERE/'evidence'/(ID+'-'+view+'.png'),size) for view,size in
                          [('front',(768,768)),('side',(1024,640)),('rear',(768,768))]]
    # Existing registry IDs are authoritative. The new asset remains unregistered.
    collisions = []
    for pattern in ('assets/models/**/manifest.json','assets/models/asset-sets.json'):
        for path in ROOT.glob(pattern):
            if ID in path.read_text():
                collisions.append(str(path.relative_to(ROOT)))
    assert not collisions,collisions
    report['id_collisions'] = collisions
    report['browser_validation'] = {'status':'not_performed','reason':'Browser operation prohibited by task instruction'}
    report['scope'] = 'GLB buffer inspection, Cycles GLB readback PNGs and optional clean regeneration; no browser or editor placement QA'
    report['status'] = 'passed'
    (HERE/'checks.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({key:report[key] for key in ['status','dimensions_mm_wdh','triangles','glb_bytes','finish_channels','regeneration','source_reexport'] if key in report},indent=2))


if __name__ == '__main__':
    main()
