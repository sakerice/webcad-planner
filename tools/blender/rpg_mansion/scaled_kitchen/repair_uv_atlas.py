"""Handle-only metric unfolded charts: geometry, topology and normals stay intact.

Closed brass sweeps have folded Smart-UV charts. Unfold each warped quad around its actual loop-triangle diagonal and give it
its own metre-scaled chart and uniformly repack the combined atlas. Original
vertex positions, cyclic triangles, material/shading data and normals are not
reallocated. Native authoring parts already have valid metric face atlases.
"""
from pathlib import Path
import sys,json,hashlib,math
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parent.parent)]
import model_kit as kit
from build import annotate

def signature(obj):
 mesh=obj.data;mesh.calc_loop_triangles();normals=[tuple(n.vector)for n in mesh.corner_normals];rows=[]
 for tri in mesh.loop_triangles:
  corners=[(tuple(obj.matrix_world@mesh.vertices[v].co),normals[l])for v,l in zip(tri.vertices,tri.loops)]
  rows.append((mesh.materials[tri.material_index].name,mesh.polygons[tri.polygon_index].use_smooth,min(tuple(corners[i:]+corners[:i])for i in range(3))))
 return hashlib.sha256(repr(sorted(rows)).encode()).hexdigest()

def repair(obj,part_names,author):
 before=signature(obj);mesh=obj.data;density=kit.uv_report(obj)['meters_per_uv'];layer=mesh.uv_layers.active
 parts=[ob for ob in author.objects if ob.type=='MESH'and ob.name in part_names]
 assert len(parts)==len(part_names)
 coords={tuple(ob.matrix_world@v.co)for ob in parts for v in ob.data.vertices}
 vertices={v.index for v in mesh.vertices if tuple(obj.matrix_world@v.co)in coords}
 mesh.calc_loop_triangles();tris={}
 for tri in mesh.loop_triangles:tris.setdefault(tri.polygon_index,[]).append(tuple(tri.vertices))
 target=[p for p in mesh.polygons if all(v in vertices for v in p.vertices)]
 assert target
 for chart,p in enumerate(target):
  pts=[obj.matrix_world@mesh.vertices[mesh.loops[i].vertex_index].co for i in p.loop_indices]
  edges=[pts[(i+1)%len(pts)]-pts[i]for i in range(len(pts))]
  pair=tris[p.index]
  if len(p.vertices)==4 and len(pair)==2:
   shared=set(pair[0])&set(pair[1]);assert len(shared)==2
   a,b=sorted(shared);c=next(v for v in pair[0]if v not in shared);d=next(v for v in pair[1]if v not in shared)
   point={i:obj.matrix_world@mesh.vertices[i].co for i in p.vertices};length=(point[b]-point[a]).length;assert length>1e-12
   sign=1 if any(tuple(pair[0][k:]+pair[0][:k])==(a,b,c)for k in range(3))else -1
   coords={a:(0.,0.),b:(length,0.)}
   for index,direction in [(c,sign),(d,-sign)]:
    ac=(point[index]-point[a]).length;bc=(point[index]-point[b]).length
    x=(ac*ac+length*length-bc*bc)/(2*length);height=math.sqrt(max(0.,ac*ac-x*x));assert height>1e-12
    coords[index]=(x,direction*height)
   xy=[coords[mesh.loops[i].vertex_index]for i in p.loop_indices]
  else:
   u=max(edges,key=lambda e:e.length).normalized();n=(obj.matrix_world.to_3x3().inverted().transposed()@p.normal).normalized();v=n.cross(u).normalized()
   xy=[(q.dot(u),q.dot(v))for q in pts]
  lo=[min(q[i]for q in xy)for i in range(2)]
  for i,(a,b)in zip(p.loop_indices,xy):layer.data[i].uv=((a-lo[0])/density+3*(chart+1),(b-lo[1])/density)
 obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.select_all(action='SELECT')
 bpy.ops.uv.pack_islands(rotate=True,margin=0.008);bpy.ops.object.mode_set(mode='OBJECT');mesh.update()
 assert signature(obj)==before,'Render-relevant geometry/material/smoothing/normal association changed'
 obj['metricHandleFaceUvRepair']=True;obj['metricHandleQuadUvRepair']=True
 return dict(native_parts=part_names,corrected_polygons=len(target),geometry_normals_material_signature=before,render_relevant_signature_preserved=True,uv=kit.uv_report(obj))

def main():
 defect_path=Path(sys.argv[sys.argv.index('--defects')+1]) if '--defects'in sys.argv else None
 targets={r['id']:r for r in json.loads(defect_path.read_text())['items']}if defect_path else {}
 items=json.loads((HERE/'descriptors.json').read_text())['items'];reports=[]
 for item in items:
  path=ROOT/item['sourceBlend'];bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
  obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');author=next(s for s in bpy.data.scenes if s.name.startswith('Native authoring parts'))
  if obj.get('metricHandleQuadUvRepair'):continue
  if not obj.get('metricHandleFaceUvRepair'):continue
  defect=targets.get(item['id'])
  if defect:
   assert hashlib.sha256(path.read_bytes()).hexdigest()==defect['source_sha256'],'Stale source-bound defect map'
   assert hashlib.sha256((ROOT/item['model']).read_bytes()).hexdigest()==defect['model_sha256'],'Stale GLB-bound defect map'
   names=list(defect['offending_parts'])
  elif defect_path:continue
  else:names=[o.name for o in author.objects if o.type=='MESH'and o.name.startswith('Curved brass drawer pull')]
  if not names:continue
  row=repair(obj,names,author)
  for scene in bpy.data.scenes:
   scene.render.filepath='//renders/'+item['id']+'.png'
   for vl in scene.view_layers:
    for ob in vl.objects:ob.select_set(False,view_layer=vl)
  bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
  obj.select_set(True);bpy.context.view_layer.objects.active=obj;glb=ROOT/item['model']
  bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False)
  annotate(glb)
  vp=ROOT/item['validation'];validation=json.loads(vp.read_text());validation.update(uv=row['uv'],packed_handle_uv_repair=row,glb_bytes=glb.stat().st_size,glb_sha256=hashlib.sha256(glb.read_bytes()).hexdigest(),source_sha256=hashlib.sha256(path.read_bytes()).hexdigest());vp.write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
  row.update(id=item['id'],source_sha256=validation['source_sha256'],model_sha256=validation['glb_sha256']);reports.append(row)
  (HERE/'packed-uv-repair-report.json').write_text(json.dumps(dict(items=reports,errors=[]),indent=2)+'\n')
  print('KITCHEN_UV_REPAIRED '+item['id'],flush=True)
if __name__=='__main__':main()
