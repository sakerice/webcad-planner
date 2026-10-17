"""Bind current GLBs to native reexports without numeric rounding or tolerance."""
from pathlib import Path
import sys,json,hashlib
import numpy as np
H=Path(__file__).resolve().parent;R=H.parents[3];sys.path.insert(0,str(H.parent))
import qa_asset_delivery as qa

def exact_surface(path):
 d,b=qa.load_glb(path);rows=[]
 for p in qa.scene_geometry(d,b):
  for ix in p['indices']:
   corners=tuple(tuple(float(v)for v in np.concatenate((p['positions'][i],p['uv'][i])))for i in ix)
   # Cyclic rotation preserves triangle winding while ignoring starting index.
   rows.append((p['material'],min(corners[n:]+corners[:n]for n in range(3))))
 return sorted(rows),d.get('materials')

items=json.loads((H/'descriptors.json').read_text())['items'];rows=[]
for it in items:
 path=R/it['model'];replay=H/'qa/regenerated'/(it['id']+'.glb');d,b=qa.load_glb(path);rd,rb=qa.load_glb(replay)
 a=d['meshes'][0]['primitives'];z=rd['meshes'][0]['primitives'];same=len(a)==len(z);checks=[]
 if same:
  for p,q in zip(a,z):
   attrs=p['attributes'];other=q['attributes'];equal=(set(attrs)==set(other)and p.get('material')==q.get('material')and np.array_equal(qa.accessor(d,b,p['indices']),qa.accessor(rd,rb,q['indices'])))
   fields={k:bool(k in other and np.array_equal(qa.accessor(d,b,v),qa.accessor(rd,rb,other[k])))for k,v in attrs.items()}
   same=bool(same and equal and all(fields.values()));checks.append(fields)
 surface,pbr=exact_surface(path);other,opbr=exact_surface(replay)
 errs=[]
 if not same:errs.append('Decoded index/attribute arrays differ from current native source reexport')
 if surface!=other:errs.append('Exact world triangle position/UV/material mapping differs')
 if pbr!=opbr:errs.append('Full exported PBR differs')
 rows.append(dict(id=it['id'],model_sha256=qa.sha256(path),source_sha256=qa.sha256(R/it['sourceBlend']),reexport_sha256=qa.sha256(replay),exact_index_attribute_arrays_equal=same,primitive_attributes=checks,exact_world_geometry_uv_material_equal=surface==other,full_pbr_equal=pbr==opbr,errors=errs))
 print('SOFA_EXACT_REPLAY',it['id'],errs)

invariants=[]
if '--before-welt' in sys.argv:
 before=Path(sys.argv[sys.argv.index('--before-welt')+1]);previous=json.loads((H/'qa/shading-only-repair.json').read_text())
 for old in previous['items']:
  it=next(i for i in items if i['id']==old['id']);bp=before/(it['id']+'.glb');assert qa.sha256(bp)==old['before_verified_source_replay_sha256'],'Historical source replay bytes changed'
  a,ma=exact_surface(bp);b,mb=exact_surface(R/it['model']);assert a==b and ma==mb,'Shading repair modified geometry, UV, winding or PBR'
  invariants.append(dict(id=it['id'],before_verified_source_replay_sha256=qa.sha256(bp),model_sha256=qa.sha256(R/it['model']),exact_triangle_positions_uvs_winding_and_material_mapping_unchanged=True,exact_full_pbr_unchanged=True))

out=dict(method=__doc__,comparison='Decoded numeric equality, no rounding or tolerance; source reexport checks include indices and every attribute, historical shading checks use winding-preserving triangle-corner rotation.',items=rows,shading_only_invariants=invariants,errors=sum(len(r['errors'])for r in rows))
(H/'qa/exact-replay.json').write_text(json.dumps(out,indent=2)+'\n')
raise SystemExit(bool(out['errors']))
