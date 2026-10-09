"""Inspect actual exported normals and geometry-only duplicate signatures."""
from pathlib import Path
import json,sys,hashlib,collections
import numpy as np
H=Path(__file__).resolve().parent;R=H.parents[3];sys.path.insert(0,str(H.parent))
import qa_asset_delivery as qa
items=json.loads((H/'descriptors.json').read_text())['items'];rows=[];signatures=collections.defaultdict(list)
def geometry_digest(geo):
 tris=[]
 for p in geo:
  for t in p['positions'][p['indices']]:
   # Sort vertices and triangles: independent of indices, channels and palette.
   tris.append(tuple(sorted(tuple(float(x) for x in q) for q in np.round(t,7))))
 return hashlib.sha256(json.dumps(sorted(tris),separators=(',',':')).encode()).hexdigest()
for item in items:
 d,b=qa.load_glb(R/item['model']);geo=qa.scene_geometry(d,b);sig=geometry_digest(geo);signatures[sig].append(item['id']);errs=[];stats=[];reexport_normals=None
 for mi,mesh in enumerate(d['meshes']):
  for pi,p in enumerate(mesh['primitives']):
   attrs=p['attributes']
   if 'NORMAL' not in attrs:errs.append('Missing exported vertex normals');continue
   n=qa.accessor(d,b,attrs['NORMAL']).astype(float);pos=qa.accessor(d,b,attrs['POSITION']).astype(float);idx=qa.accessor(d,b,p['indices']).reshape((-1,3)).astype(int)
   lens=np.linalg.norm(n,axis=1);t=pos[idx];face=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);face/=np.linalg.norm(face,axis=1)[:,None]
   alignment=np.einsum('ij,ij->i',face,n[idx].mean(1));corner_alignment=np.einsum('ij,ikj->ik',face,n[idx]);bad=int((alignment<-.00001).sum());bad_corners=int((corner_alignment<-.00001).sum())
   if not np.isfinite(n).all() or np.max(np.abs(lens-1))>1e-5:errs.append('Non-finite or non-unit exported normals')
   if bad:errs.append('Exported smooth normals oppose triangle winding')
   if bad_corners:errs.append('Individual exported corner normals oppose their incident triangle')
   stats.append(dict(primitive=pi,vertices=len(n),max_normal_length_error=float(np.max(np.abs(lens-1))),min_face_average_normal_dot=float(alignment.min()),opposed_face_count=bad,min_face_corner_normal_dot=float(corner_alignment.min()),opposed_corner_count=bad_corners))
 regenerated=H/'qa/regenerated'/(item['id']+'.glb')
 if regenerated.exists():
  rd,rb=qa.load_glb(regenerated);a=d['meshes'][0]['primitives'];z=rd['meshes'][0]['primitives']
  reexport_normals=len(a)==len(z) and all(np.array_equal(qa.accessor(d,b,p['attributes']['NORMAL']),qa.accessor(rd,rb,q['attributes']['NORMAL']))for p,q in zip(a,z))
  if not reexport_normals:errs.append('Reopened source normal arrays differ from final GLB')
 else:errs.append('Reopened source normals not yet verified')
 rows.append(dict(id=item['id'],model_sha256=qa.sha256(R/item['model']),source_sha256=qa.sha256(R/item['sourceBlend']),geometry_only_signature=sig,normal_primitives=stats,source_reexport_normals_match=reexport_normals,errors=errs))
exact=[ids for ids in signatures.values() if len(ids)>1]
variants=[dict(id=i['id'],variant_of=i['variantOf'],basis=i['semanticCoverage'])for i in items if i.get('variantOf')]
report=dict(items=rows,geometry_only_duplicate_groups=exact,explicit_variants=variants,palette_only_assets_counted=0,structural_design_families=len(items)-len(variants),errors=sum(len(r['errors'])for r in rows)+len(exact))
(H/'qa').mkdir(exist_ok=True);(H/'qa/normals-dedupe.json').write_text(json.dumps(report,indent=2)+'\n')
print('SOFA_NORMALS_DEDUPE',len(rows),'errors',report['errors'])
for r in rows:
 if r['errors']:print(r['id'],r['errors'])
raise SystemExit(bool(report['errors']))
