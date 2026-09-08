"""Prepare CC-BY-4.0 BMW model for planner; retain geometry, normalize and tune materials."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[2];W=R/'tools/blender/work/quality'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(W/'sources/bmw-m4.glb'))
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
coords=[o.matrix_world@Vector(v) for o in objs for v in o.bound_box];lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)))
print('SOURCE BOUNDS',list(lo),list(hi));print('MATERIALS',[(m.name,m.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value if m.node_tree.nodes.get('Principled BSDF') else None) for m in bpy.data.materials])
# Bake world transforms and centre ground origin. Source dimensions preserved proportionally.
for o in objs:
 world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
for o in list(bpy.context.scene.objects):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
# Model longest horizontal axis becomes Y in Blender (+/- front resolved by review).
length=max(hi.x-lo.x,hi.y-lo.y);scale=4.79/length
for o in objs:
 for v in o.data.vertices:
  q=o.matrix_world@v.co;q-=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));v.co=q*scale
 o.matrix_world.identity()
 if hi.x-lo.x>hi.y-lo.y:
  for v in o.data.vertices:v.co=Vector((-v.co.y,v.co.x,v.co.z))
for m in bpy.data.materials:
 p=m.node_tree.nodes.get('Principled BSDF')
 if not p:continue
 if any(k in m.name for k in ['white41','body151','livery1','zx1']):
  for key in ['Base Color','Metallic','Roughness','Alpha']:
   for l in list(p.inputs[key].links):m.node_tree.links.remove(l)
  p.inputs['Alpha'].default_value=1
  p.inputs['Base Color'].default_value=(.009,.23,.40,1);p.inputs['Metallic'].default_value=.6;p.inputs['Roughness'].default_value=.26;p.inputs['Coat Weight'].default_value=.55;m.name='CarBody_'+m.name
 if 'windows1' in m.name:
  for name in ['Base Color','Alpha','Roughness','Metallic']:
   for l in list(p.inputs[name].links):m.node_tree.links.remove(l)
  p.inputs['Base Color'].default_value=(.12,.17,.21,1);p.inputs['Roughness'].default_value=.13;p.inputs['Metallic'].default_value=.15;p.inputs['Alpha'].default_value=.34
 if 'led' in m.name:
  p.inputs['Emission Strength'].default_value=.35
bpy.ops.wm.save_as_mainfile(filepath=str(W/'precision_car.blend'))
bpy.ops.export_scene.gltf(filepath=str(W/'precision_car.glb'),export_format='GLB',export_apply=True)
# Diagnostic studio render.
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.012
m=bpy.data.materials.new('Studio');m.diffuse_color=(.22,.25,.29,1);floor.data.materials.append(m)
world=bpy.data.worlds.new('Studio world');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.60,.70,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
for pos,power,size in [((2,3,6),1500,5),((-4,0,3),1100,4),((0,-4,5),1600,3)]:
 bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,.6))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,-6,3.0));c=bpy.context.object;c.rotation_euler=(Vector((0,0,.7))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=6.2
sc=bpy.context.scene;sc.camera=c;sc.render.engine='CYCLES';sc.cycles.samples=24;sc.render.resolution_x=1200;sc.render.resolution_y=850;sc.render.resolution_percentage=100;sc.render.filepath=str(W/'precision_car.png');bpy.ops.render.render(write_still=True)
