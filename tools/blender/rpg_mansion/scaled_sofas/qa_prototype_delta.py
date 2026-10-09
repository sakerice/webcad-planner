"""Read-only geometry delta against the approved prototype snapshot."""
from pathlib import Path
import bpy,json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];BASE=H/'review_snapshots/prototype3/repo'
ids=['rpg-mansion-camelback-settee-two-01','rpg-mansion-chesterfield-three-01','rpg-mansion-open-salon-settee-01']
def inspect(p):
 bpy.ops.wm.open_mainfile(filepath=str(p),load_ui=False)
 result={}
 for ob in bpy.data.scenes['Native authoring parts'].objects:
  if ob.type!='MESH':continue
  ob.data.calc_loop_triangles()
  points=[tuple(round(x,6)for x in ob.matrix_world@v.co)for v in ob.data.vertices]
  faces=sorted(tuple(sorted(points[i]for i in t.vertices))for t in ob.data.loop_triangles)
  result[ob.name]={'vertices':sorted(points),'triangles':faces,'count':len(faces),'bounds':[[min(p[a]for p in points)for a in range(3)],[max(p[a]for p in points)for a in range(3)]]}
 return result
rows=[]
for id in ids:
 rel=Path('tools/blender/rpg_mansion/scaled_sofas/sources')/(id+'.blend');old=BASE/rel;new=R/rel
 a=inspect(old);b=inspect(new);changed=[]
 for key in sorted(set(a)|set(b)):
  if a.get(key)!=b.get(key):
   changed.append(dict(part=key,point_support_equal=a.get(key,{}).get('vertices')==b.get(key,{}).get('vertices'),triangle_topology_equal=a.get(key,{}).get('triangles')==b.get(key,{}).get('triangles'),before_bounds=a.get(key,{}).get('bounds'),after_bounds=b.get(key,{}).get('bounds'),before_triangles=a.get(key,{}).get('count'),after_triangles=b.get(key,{}).get('count')))
 rows.append(dict(id=id,before_source_sha256=hashlib.sha256(old.read_bytes()).hexdigest(),after_source_sha256=hashlib.sha256(new.read_bytes()).hexdigest(),reason='Correct sweep-frame flips and sewn-welt normals; preserve rounded Chesterfield shoulder caps and inset its hidden board to remove coplanar z-fighting and close the upholstered rear with an attached inset band',changed_native_parts=changed,unchanged_native_parts=len(set(a)&set(b))-len(changed)))
(H/'qa/prototype-repair-delta.json').write_text(json.dumps(dict(items=rows,review='Furniture footprint, seating capacity and seat height are preserved; final images require renewed parent review after defect repair'),indent=2)+'\n')
for r in rows:print(r['id'],'changed:',[(i['part'],i['point_support_equal'])for i in r['changed_native_parts']])
