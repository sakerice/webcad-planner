"""Render only reopened canonical assets, leaving saved native bytes untouched."""
import sys,json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from build import config_render,kit
from png_metadata import strip_metadata
import exterior_build
config_render()
only=set(sys.argv[sys.argv.index('--only')+1].split(',')) if '--only' in sys.argv else None
for item in json.loads((H/'descriptors.json').read_text())['items']:
 if only and item['id'] not in only and item['id'].replace('rpg-mansion-','').removesuffix('-01') not in only:continue
 if '--missing-only' in sys.argv and all((ROOT/item[k]).exists() for k in ['thumb','top','front','rear']):continue
 before=hashlib.sha256((ROOT/item['sourceBlend']).read_bytes()).hexdigest()
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']),load_ui=False);obj=next(ob for ob in bpy.context.scene.objects if ob.type=='MESH')
 kit.render_top(obj,str(ROOT/item['top']));kit.render_thumb(obj,str(ROOT/item['thumb']))
 for key,y in [('front',-1),('rear',1)]:
  scene=exterior_build._icon_scene(obj);exterior_build._sun(3.2,(math.radians(45),0,math.radians(25)),(3,-4,6));span=max(obj.dimensions)
  bpy.ops.object.camera_add(location=(0,y*3*span,obj.dimensions.z*.5));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=span*1.12;scene.camera=cam;cam.rotation_euler=(Vector((0,0,obj.dimensions.z*.5))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(ROOT/item[key]);bpy.ops.render.render(write_still=True)
 for key in ['thumb','top','front','rear']:strip_metadata(ROOT/item[key])
 assert before==hashlib.sha256((ROOT/item['sourceBlend']).read_bytes()).hexdigest()
 binding=dict(id=item['id'],sourceSha256=before,modelSha256=hashlib.sha256((ROOT/item['model']).read_bytes()).hexdigest(),images={k:dict(path=item[k],sha256=hashlib.sha256((ROOT/item[k]).read_bytes()).hexdigest())for k in ['thumb','top','front','rear']})
 (H/'work'/(item['id']+'-render-binding.json')).write_text(json.dumps(binding,indent=2)+'\n')
 print('RENDER_READY',item['id'],flush=True)
