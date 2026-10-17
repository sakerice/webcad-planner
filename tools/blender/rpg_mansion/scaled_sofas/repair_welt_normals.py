"""Targeted shading-only repair preserving exported geometry, UVs and PBR."""
from pathlib import Path
import sys,json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parents[1])]
import bpy
import qa_asset_delivery as qa
from native_utils import sanitize,export_active
from build import stamp
TARGETS={'rpg-mansion-camelback-settee-two-01':'Camelback panel attached inset piping','rpg-mansion-camelback-settee-three-01':'Camelback panel attached inset piping','rpg-mansion-asymmetric-fainting-couch-01':'Fainting back attached perimeter seam'}
def key(ob,p):return tuple(sorted(tuple(round(float(x),7)for x in ob.matrix_world@ob.data.vertices[i].co)for i in p.vertices))
def flatten(ob):
 for p in ob.data.polygons:p.use_smooth=False
 ob.data.update()
items=json.loads((H/'descriptors.json').read_text())['items'];rows=[]
for it in items:
 if it['id'] not in TARGETS:continue
 stem=it['id'];part=TARGETS[stem];model=R/it['model'];before_hash=qa.sha256(model);d,b=qa.load_glb(model);before=qa.shape_signature(d,qa.scene_geometry(d,b));materials=d.get('materials')
 source=R/it['sourceBlend'];before_source=qa.sha256(source);bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
 target=next(o for o in bpy.data.scenes['Native authoring parts'].objects if o.name==part);keys={key(target,p)for p in target.data.polygons};flatten(target)
 export=next(o for o in bpy.data.scenes['Validated export'].objects if o.type=='MESH');changed=0
 for p in export.data.polygons:
  if key(export,p)in keys:p.use_smooth=False;changed+=1
 assert changed==len(keys),(stem,changed,len(keys));export.data.update()
 sanitize(stem);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
 export_active(export,model);stamp(model,stem)
 nd,nb=qa.load_glb(model);after=qa.shape_signature(nd,qa.scene_geometry(nd,nb))
 assert before==after,(stem,'Geometry or UV changed during a shading-only repair')
 assert nd.get('materials')==materials,(stem,'PBR changed during a shading-only repair')
 authoring=R/it['authoringBlend'];before_authoring=qa.sha256(authoring);bpy.ops.wm.open_mainfile(filepath=str(authoring),load_ui=False)
 target=next(o for o in bpy.context.scene.objects if o.name==part);assert {key(target,p)for p in target.data.polygons}==keys
 flatten(target);sanitize(stem);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(authoring),compress=True)
 it['sha256']=qa.sha256(model);it['sourceSha256']=qa.sha256(source);it['authoringSha256']=qa.sha256(authoring)
 vpath=R/it['validation'];v=json.loads(vpath.read_text());v.update(glb_bytes=model.stat().st_size,glb_sha256=it['sha256'],source_sha256=it['sourceSha256']);vpath.write_text(json.dumps(v,indent=2)+'\n')
 rows.append(dict(id=stem,part=part,changed_polygon_shading_flags=changed,repair='Flat shading on the thin sharp-turn perimeter welt only; no positions, topology, UVs or materials changed',before_model_sha256=before_hash,after_model_sha256=it['sha256'],before_source_sha256=before_source,after_source_sha256=it['sourceSha256'],before_authoring_sha256=before_authoring,after_authoring_sha256=it['authoringSha256'],exact_geometry_and_uv_signature_unchanged=before==after,full_exported_pbr_unchanged=nd.get('materials')==materials,geometry_uv_signature=after))
 print('SHADING_ONLY_REPAIRED',stem,changed,flush=True)
(H/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',name='洋館・ソファ十八種',items=items),ensure_ascii=False,indent=2)+'\n')
(H/'qa/shading-only-repair.json').write_text(json.dumps(dict(items=rows,errors=0),indent=2)+'\n')
