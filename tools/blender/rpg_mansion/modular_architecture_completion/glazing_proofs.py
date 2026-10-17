"""Actual exported-glass optical proof with white/black markers and clear control.
Imported GLB partitions are split by existing material without geometry changes.
Only the glass partition is hidden for the clear control. QA markers are fixtures,
not product assets; stable saved sources reopen without calling builders.
"""
import sys,json,hashlib,math
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
from sanitize_sources import sanitize_loaded
from png_metadata import strip_metadata
OUT=H/'glazing-proofs';OUT.mkdir(exist_ok=True)
D={i['id']:i for i in json.loads((H/'descriptors.json').read_text())['items']}
PLAN=[dict(id='rpg-mansion-tall-fixed-french-window-bay-01',cx=-.23,cz=1.25,scale=.8,y=.20,x0=-.425,x1=-.035,z0=.915,z1=1.60,rois=[[-.36,-.30,1.20,1.30],[-.16,-.10,1.20,1.30]]),dict(id='rpg-mansion-fixed-shed-dormer-01',cx=-.20,cz=.85,scale=.65,y=-.49,x0=-.39,x1=-.012,z0=.585,z1=1.12,rois=[[-.31,-.27,.80,.90],[-.13,-.09,.80,.90]])]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def marker(name,lo,hi,value):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple((a+b)/2 for a,b in zip(lo,hi)));ob=bpy.context.object;ob.name=name;ob.dimensions=tuple(b-a for a,b in zip(lo,hi));bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;nt.nodes.clear();node=nt.nodes.new('ShaderNodeEmission');node.inputs['Color'].default_value=(value,value,value,1);node.inputs['Strength'].default_value=1;out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(node.outputs[0],out.inputs['Surface']);ob.data.materials.append(m);ob['verificationFixture']=True;return ob

def build(spec):
 it=D[spec['id']];bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/it['model']));objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==1;ob=objects[0];off=Vector(it['moduleContract']['constructionToAssetTranslationM']);ob.matrix_world=Matrix.Translation(-off)@ob.matrix_world
 bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
 glass=[]
 for o in [o for o in bpy.context.scene.objects if o.type=='MESH']:
  isglass=any(m.get('finishChannel')=='glass' for m in o.data.materials);o['actualGlbPartition']=True;o['glassPartition']=isglass
  if isglass:glass.append(o.name)
 assert glass
 mid=(spec['x0']+spec['x1'])/2;y=spec['y'];marker('QA white transmission marker',(spec['x0'],y,spec['z0']),(mid,y+.004,spec['z1']),1);marker('QA black transmission marker',(mid,y,spec['z0']),(spec['x1'],y+.004,spec['z1']),0)
 scene=bpy.context.scene;scene.name='Actual GLB optical transmission proof';scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=False;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=False;scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
 world=bpy.data.worlds.new('Neutral optical proof world');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.85,1,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55
 bpy.ops.object.camera_add(location=(spec['cx'],-4,spec['cz']));cam=bpy.context.object;cam.rotation_euler=(Vector((spec['cx'],0,spec['cz']))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=spec['scale'];scene.camera=cam
 bpy.ops.object.light_add(type='AREA',location=(-2,-3,4));light=bpy.context.object;light.data.energy=300;light.data.shape='DISK';light.data.size=4;light.rotation_euler=(Vector((0,0,1.5))-light.location).to_track_quat('-Z','Y').to_euler()
 scene['verificationOnly']=True;scene['sourceAsset']=it['id'];scene['modelSha256']=it['hashes']['model'];scene['glassPartitionNames']=json.dumps(glass);sanitize_loaded(it['id']+'-optical-proof');source=OUT/(it['id']+'-optical-proof.blend');bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
 rois=[]
 for x0,x1,z0,z1 in spec['rois']:rois.append([round(256+(x0-spec['cx'])/spec['scale']*512),round(256-(z1-spec['cz'])/spec['scale']*512),round(256+(x1-spec['cx'])/spec['scale']*512),round(256-(z0-spec['cz'])/spec['scale']*512)])
 return dict(id=it['id'],model=it['model'],modelSha256=it['hashes']['model'],source=str(source.relative_to(ROOT)),sourceSha256=sha(source),glassPartitionNames=glass,roisPixels=rois,camera=dict(nativeCentre=[spec['cx'],-4,spec['cz']],orthoScale=spec['scale'],resolution=[512,512],samples=64),proofFixtures=['white marker','black marker'],views={})

def render_proof(receipt):
 source=ROOT/receipt['source'];before=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
 for label,hidden in [('actual-glass',False),('clear-control',True)]:
  for o in bpy.context.scene.objects:
   if o.get('glassPartition'):o.hide_render=hidden
  path=OUT/(receipt['id']+'-'+label+'.png');bpy.context.scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);receipt['views'][label]=dict(path=str(path.relative_to(ROOT)),sha256=sha(path))
 assert before==sha(source)
 return receipt
if __name__=='__main__':
 rows=[]
 for spec in PLAN:
  if spec['id'] not in D:continue
  receipt=build(spec);(OUT/(spec['id']+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
  if '--build-only' not in sys.argv:receipt=render_proof(receipt);(OUT/(spec['id']+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
  rows.append(receipt);print('GLAZING_PROOF_READY',spec['id'],flush=True)
