"""Check actual GLB normal directions/PBR and exact reopened-source shading.
Does not accept volume/winding as proof of valid exported shading normals.
"""
import json,hashlib,sys
from pathlib import Path
import numpy as np
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path.insert(0,str(H.parent));import qa_asset_delivery as qa

def signature(doc,binary):
 result={}
 for mesh in doc['meshes']:
  for p in mesh['primitives']:
   a=p['attributes'];pos=qa.accessor(doc,binary,a['POSITION']);normal=qa.accessor(doc,binary,a['NORMAL']);uv=qa.accessor(doc,binary,a['TEXCOORD_0']);ids=qa.accessor(doc,binary,p['indices']).reshape(-1,3)
   values=np.round(np.concatenate([pos,normal,uv],axis=1),6);values[values==0]=0
   corners=sorted(tuple(sorted(map(tuple,values[t])))for t in ids)
   result[doc['materials'][p['material']]['name']]=hashlib.sha256(repr(corners).encode()).hexdigest()
 return result

rows=[]
for item in json.loads((H/'descriptors.json').read_text())['items']:
 doc,binary=qa.load_glb(ROOT/item['model']);errors=[];bad=0;corners=0;worst=0;length_error=0
 for mesh in doc['meshes']:
  for p in mesh['primitives']:
   attrs=p['attributes']
   if 'NORMAL'not in attrs:errors.append('Missing NORMAL');continue
   pos=qa.accessor(doc,binary,attrs['POSITION']);normal=qa.accessor(doc,binary,attrs['NORMAL']);ids=qa.accessor(doc,binary,p['indices']).reshape(-1,3)
   triangles=pos[ids];faces=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]);faces/=np.linalg.norm(faces,axis=1)[:,None]
   dot=np.clip((faces[:,None,:]*normal[ids]).sum(-1),-1,1);angles=np.degrees(np.arccos(dot));worst=max(worst,float(angles.max()));bad+=int((angles>90.1).sum());corners+=int(angles.size);length_error=max(length_error,float(np.abs(np.linalg.norm(normal,axis=1)-1).max()))
   if not np.isfinite(normal).all():errors.append('Nonfinite normals')
 if bad:errors.append('Exported normals face inward at triangle corners')
 if length_error>1e-4:errors.append('Nonunit exported normals')
 regenerated=H/'source-reexport-qa/regenerated'/(item['id']+'.glb');pbr_equal=None;normal_equal=None
 if regenerated.exists():
  src,sb=qa.load_glb(regenerated);pbr_equal=src['materials']==doc['materials'];normal_equal=signature(src,sb)==signature(doc,binary)
  if not pbr_equal:errors.append('Reopened source PBR differs')
  if not normal_equal:errors.append('Reopened source normals/UV/geometry corner signature differs')
 elif '--require-reexport' in sys.argv:errors.append('Reopened source re-export missing')
 rows.append(dict(id=item['id'],modelSha256=qa.sha256(ROOT/item['model']),sourceSha256=qa.sha256(ROOT/item['sourceBlend']),triangleCorners=corners,inwardFacingNormalCorners=bad,maximumNormalFaceAngleDegrees=worst,maximumNormalLengthError=length_error,reexportPbrMatches=pbr_equal,reexportCornerShadingMatches=normal_equal,errors=errors))
report=dict(items=rows,errors=sum(len(r['errors'])for r in rows));(H/'shading-qa.json').write_text(json.dumps(report,indent=2)+'\n');print('SHADING_ERRORS',report['errors']);print([(r['id'],r['errors'])for r in rows if r['errors']]);assert not report['errors']
