"""Material-independent surface dedupe and actual GLB floor support evidence.
Read-only model audit. A support hull is geometric evidence, not stability engineering.
"""
import json,hashlib,sys
from pathlib import Path
import numpy as np
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path.insert(0,str(H.parent))
import qa_asset_delivery as qa

def hull(points):
 p=sorted(set(map(tuple,points)))
 def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
 lower=[];upper=[]
 for q in p:
  while len(lower)>1 and cross(lower[-2],lower[-1],q)<=0:lower.pop()
  lower.append(q)
 for q in reversed(p):
  while len(upper)>1 and cross(upper[-2],upper[-1],q)<=0:upper.pop()
  upper.append(q)
 return lower[:-1]+upper[:-1]

def digest(tris):
 rows=sorted(tuple(sorted(map(tuple,t))) for t in tris)
 return hashlib.sha256(repr(rows).encode()).hexdigest()

rows=[];seen={};errors=[]
for item in json.loads((H/'descriptors.json').read_text())['items']:
 doc,binary=qa.load_glb(ROOT/item['model']);geometry=qa.scene_geometry(doc,binary)
 points=np.concatenate([a['positions']for a in geometry]);triangles=np.concatenate([a['positions'][a['indices']]for a in geometry]);lo=points.min(0);hi=points.max(0)
 normalized=(triangles-lo)/(hi-lo);signature=digest(np.round(normalized,6));floor=points[points[:,1]<=.00002][:,[0,2]];poly=hull(np.round(floor,6))
 area=abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1]for i in range(len(poly))))/2 if len(poly)>2 else 0
 rocker='curved-rocker' in item['id']
 if not rocker and area<.025:errors.append(item['id']+' insufficient static floor contact footprint')
 if signature in seen:errors.append(item['id']+' duplicates normalized geometry '+seen[signature])
 seen[signature]=item['id']
 rows.append(dict(id=item['id'],modelSha256=qa.sha256(ROOT/item['model']),materialIndependentNormalizedSurfaceSha256=signature,groundContactHullXZMetres=poly,groundContactHullAreaM2=area,floorContactVertices=len(floor),staticRockerContactException=rocker))
report=dict(items=rows,distinctGeometryCount=len(seen),errors=errors,method='Actual GLB triangles, ignoring names and materials; independently normalize bounds before surface hashing. Floor hull uses actual vertices within 20 micrometres of ground; curved rocker intentionally contacts along its two central rail segments.')
(H/'distinct-support-qa.json').write_text(json.dumps(report,indent=2)+'\n');print('DISTINCT_SUPPORT',len(rows),'ERRORS',errors);assert not errors
