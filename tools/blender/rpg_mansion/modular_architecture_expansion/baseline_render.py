"""Reopen final canonical sources and render actual four-view evidence with vertex fit.
No source writes. Orthographic fit reserves >12px alpha margin after anti-aliasing.
"""
import sys,math,json,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from png_metadata import strip_metadata

def render(objects,path,direction=(6,-8,5),resolution=512,target=None,samples=32):
 scene=bpy.context.scene
 for ob in list(scene.objects):
  if ob.type in['CAMERA','LIGHT']:bpy.data.objects.remove(ob,do_unlink=True)
 scene.render.engine='CYCLES';scene.cycles.samples=samples;scene.cycles.use_denoising=False;scene.render.resolution_x=resolution;scene.render.resolution_y=resolution;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True;scene.render.filepath=str(path)
 scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.2
 world=bpy.data.worlds.new('Neutral proof world');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.85,1,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55
 bpy.context.view_layer.update();pts=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices];lo=Vector(tuple(min(p[i]for p in pts)for i in range(3)));hi=Vector(tuple(max(p[i]for p in pts)for i in range(3)));center=(lo+hi)*.5 if target is None else Vector(target);span=(hi-lo).length
 d=Vector(direction).normalized();bpy.ops.object.camera_add(location=center+d*span*3);cam=bpy.context.object;cam.name='Actual vertex fitted proof camera';cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.lens=50;cam.data.clip_end=span*10;scene.camera=cam;bpy.context.view_layer.update()
 inv=cam.matrix_world.inverted();projected=[inv@p for p in pts];xc=(max(p.x for p in projected)+min(p.x for p in projected))/2;yc=(max(p.y for p in projected)+min(p.y for p in projected))/2;cam.location+=cam.matrix_world.to_3x3()@Vector((xc,yc,0));cam.data.ortho_scale=max(max(p.x for p in projected)-min(p.x for p in projected),max(p.y for p in projected)-min(p.y for p in projected))/.89
 for label,loc,power,size in [('key',(-3,-4,6),180,4),('fill',(4,2,4),100,5),('rim',(-2,5,6),130,4)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(loc)*max(span*.45,.5));light=bpy.context.object;light.name=label;light.data.energy=power*max(span,1)**2;light.data.shape='DISK';light.data.size=size*max(span*.4,.5);light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.render.render(write_still=True);strip_metadata(path)
 return dict(direction=list(direction),resolution=resolution,orthographicScale=cam.data.ortho_scale,fit='project all actual mesh vertices; centre measured camera-space envelope; occupancy 89 percent')

def main():
 path=H/'descriptors.json';doc=json.loads(path.read_text());only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
 for item in doc['items']:
  if only and not any(k in item['id']for k in only):continue
  source=ROOT/item['sourceBlend'];before=hashlib.sha256(source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False);obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');camera={}
  for key,direction in [('thumb',(6,-8,5)),('top',(0,0,1)),('front',(0,-1,0)),('rear',(0,1,0))]:camera[key]=render([obj],ROOT/item[key],direction)
  assert before==hashlib.sha256(source.read_bytes()).hexdigest();item['hashes'].update({k:hashlib.sha256((ROOT/item[k]).read_bytes()).hexdigest()for k in ['thumb','top','front','rear']});binding=dict(id=item['id'],sourceSha256=before,modelSha256=item['hashes']['model'],images={k:dict(path=item[k],sha256=item['hashes'][k],camera=camera[k])for k in camera});(H/'work'/(item['id']+'-render-binding.json')).write_text(json.dumps(binding,indent=2)+'\n');path.write_text(json.dumps(doc,indent=2)+'\n');print('RENDER_READY',item['id'],flush=True)
if __name__=='__main__':main()
