"""Actual-byte, native scene, outward winding, seat top and source re-export QA."""
import sys,json,hashlib,math
from pathlib import Path
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
import qa_asset_delivery as qa
qa.ROOT=ROOT
items=json.loads((H/'descriptors.json').read_text())['items']

def byte_checks():
 reports=[]
 for item in items:
  row=qa.audit_item(item);doc,binary=qa.load_glb(ROOT/item['model'])
  if len(doc.get('scenes',[]))!=1:row['errors'].append('Release GLB is not one scene')
  if row['triangles']>item['triangleBudget']:row['errors'].append('Explicit triangle budget exceeded')
  if row['triangles']!=item['measuredTriangles']or row['bytes']!=item['glbBytes']:row['errors'].append('Payload accounting differs')
  if row['bytes']>=1000000:row['errors'].append('GLB exceeds 1 MB')
  for field,digest in item['hashes'].items():
   if qa.sha256(ROOT/item[field])!=digest:row['errors'].append(field+' hash mismatch')
  # Independently measure broad upper velvet seat surfaces in actual GLB triangles.
  geometry=qa.scene_geometry(doc,binary);tops=[]
  for part in geometry:
   mat=doc['materials'][part['material']]
   if mat.get('extras',{}).get('finishChannel') not in item.get('seatFinishChannels',['fabric']):continue
   for face in part['indices']:
    pts=part['positions'][face];heights=pts[:,1]
    if max(heights)-min(heights)<1e-7 and abs(float(heights[0])-.460)<1e-5:
     area=float(__import__('numpy').linalg.norm(__import__('numpy').cross(pts[1]-pts[0],pts[2]-pts[0]))*.5)
     if area>1e-7:tops.append(area)
  row['actualSeatTopMm']=460 if tops else None;row['actualHorizontalSeatTopTriangles']=len(tops);row['actualHorizontalSeatTopAreaM2']=sum(tops)
  if not tops:row['errors'].append('GLB does not substantiate 460 mm broad seat surface')
  for key in ['thumb','top','front','rear']:
   p=qa.png_report(ROOT/item[key])
   if p['size']!=[512,512]or p['mode']!='RGBA'or p['edge_nontransparent_pixels']:row['errors'].append('Evidence PNG gate '+key)
   box=p['pixel_bbox_alpha_gt_0'];margin=min(box[0],box[1],512-box[2],512-box[3]) if box else -1
   if margin<12:row['errors'].append('PNG actual alpha margin below 12px: '+key+' '+str(margin))
  reports.append(row)
 output=dict(items=reports,actualModelBytes=sum(r['bytes']for r in reports),actualTriangles=sum(r['triangles']for r in reports),errors=sum(len(r['errors'])for r in reports));(H/'actual-byte-qa.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
 print('ACTUAL_BYTE_QA',output['actualModelBytes'],output['actualTriangles'],'ERRORS',output['errors'])
 for r in reports:
  if r['errors']:print(r['id'],r['errors'])
 assert not output['errors']

def source_checks():
 import bpy,bmesh
 from repair_winding import repair_mesh_winding
 import model_kit as kit
 reports=[]
 for item in items:
  doc,binary=qa.load_glb(ROOT/item['model']);actual=qa.shape_signature(doc,qa.scene_geometry(doc,binary));entries=[];errors=[]
  for field in ['authoringBlend','sourceBlend']:
   path=ROOT/item[field];before=qa.sha256(path);bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False);active=bpy.context.scene;native=bpy.data.scenes.get('Native authoring parts');assert native
   sig=qa.native_scene_signature(native)
   if sig['point_support']!=actual['point_support']or sig['triangle_counts']!=actual['triangle_counts']:errors.append(field+' native geometry/material differs')
   parts=[ob for ob in native.objects if ob.type=='MESH'];active_meshes=[ob for ob in active.objects if ob.type=='MESH'];orientation=[]
   if field=='sourceBlend'and(len(active_meshes)!=1 or len(bpy.data.scenes)!=2 or active==native):errors.append('Canonical active scene contract')
   if field=='authoringBlend'and(active!=native or len(bpy.data.scenes)!=1):errors.append('Part-only authoring scene contract')
   seat=max((ob.matrix_world@v.co).z for ob in parts if ob.get('seatSurface')for v in ob.data.vertices)*1000
   if abs(seat-460)>.01:errors.append('Native seat height')
   for scene in bpy.data.scenes:
    for ob in scene.objects:
     if ob.type!='MESH':continue
     report=repair_mesh_winding(ob,repair=False);orientation.append(dict(scene=scene.name,**report));bm=bmesh.new();bm.from_mesh(ob.data)
     if any(not e.is_manifold for e in bm.edges):errors.append(ob.name+' nonmanifold')
     bm.free()
     if any(c['signedVolumeAfterM3']<=0 for c in report['components']):errors.append(ob.name+' nonpositive signed volume')
     if len(ob.data.uv_layers)!=1:errors.append(ob.name+' UV layer count')
     uv=kit.uv_report(ob)
     if uv['degenerate_world']or uv['degenerate_uv']:errors.append(ob.name+' degenerate UV/world triangles')
     if ob.modifiers:errors.append(ob.name+' unapplied modifiers')
     if scene==native and not ob.get('constructionPart'):errors.append(ob.name+' missing part identity')
   if bpy.data.libraries or any(im.source=='FILE'and im.filepath for im in bpy.data.images):errors.append('External dependency')
   if any(not s.render.filepath.startswith('//')for s in bpy.data.scenes):errors.append('Private render path')
   if qa.sha256(path)!=before:errors.append('Read-only source changed bytes')
   entries.append(dict(field=field,sha256=before,activeScene=active.name,sceneCount=len(bpy.data.scenes),activeMeshes=len(active_meshes),nativeParts=len(parts),nativeSeatTopMm=seat,partNames=[o.name for o in parts],orientation=orientation))
  reports.append(dict(id=item['id'],sources=entries,errors=errors))
  (H/'reopened-source-qa.json').write_text(json.dumps(dict(items=reports,errors=sum(len(r['errors'])for r in reports)),indent=2)+'\n');print('NATIVE_QA',item['id'],errors,flush=True)
 assert not any(r['errors']for r in reports)
 # Use canonical accepted source QA helper for full PBR/geometry/UV re-export.
 from types import SimpleNamespace
 out=H/'source-reexport-qa';out.mkdir(exist_ok=True);req=out/'request.json';response=out/'checkpoint.json';req.write_text(json.dumps([dict(id=i['id'],source=str(ROOT/i['sourceBlend']))for i in items],indent=2)+'\n')
 qa.blender_sources(SimpleNamespace(source_request=req,source_response=response,output=out));rows=json.loads(response.read_text());actual=[qa.audit_item(i)for i in items];qa.compare_source_reports(rows,actual);response.write_text(json.dumps(rows,indent=2)+'\n');print('REEXPORT_ERRORS',[(r['id'],r['errors'])for r in rows if r['errors']],flush=True);assert not any(r['errors']for r in rows)

if '--sources'in sys.argv:source_checks()
else:byte_checks()
