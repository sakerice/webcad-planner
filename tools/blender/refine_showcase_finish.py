"""Second quality pass: woven fabric and denser curved automotive surfaces."""
import bpy,math,random
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/models/refined';WORK=ROOT/'tools/blender/work/quality'
bpy.ops.wm.open_mainfile(filepath=str(WORK/'sofa_tailored_v1.blend'))
m=bpy.data.materials['Woven upholstery'];p=m.node_tree.nodes['Principled BSDF'];p.inputs['Sheen Weight'].default_value=.28
n=128;image=bpy.data.images.new('Linen weave normal',width=n,height=n);pixels=[]
for y in range(n):
 for x in range(n):
  dx=.22*math.sin(x*math.pi/2)*(0.65+0.35*math.cos(y*math.pi/4));dy=.22*math.sin(y*math.pi/2)*(0.65+0.35*math.cos(x*math.pi/4));z=math.sqrt(max(0,1-dx*dx-dy*dy));pixels.extend((dx*.5+.5,dy*.5+.5,z*.5+.5,1))
image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(pixels);image.update();image.pack()
t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=image;normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.35;m.node_tree.links.new(t.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],p.inputs['Normal'])
for o in bpy.context.scene.objects:
 if o.type=='MESH' and m in list(o.data.materials):
  for uv in o.data.uv_layers.active.data:uv.uv*=12
bpy.ops.export_scene.gltf(filepath=str(OUT/'sofa_tailored_v1.glb'),export_format='GLB',export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'sofa_tailored_v1.blend'))
bpy.ops.wm.read_factory_settings(use_empty=True)
src=(ROOT/'tools/blender/car_build.py').read_text().replace("sub.levels = 2","sub.levels = 3").replace("sub = gh.modifiers.new('Sub', 'SUBSURF'); sub.levels = 3","sub = gh.modifiers.new('Sub', 'SUBSURF'); sub.levels = 4").replace('vertices=40','vertices=80').replace('major_segments=32, minor_segments=8','major_segments=64, minor_segments=12').replace("for k in range(5):","for k in range(10):").replace('a = k * math.tau / 5','a = k * math.tau / 10').replace('WHEEL_R*0.17, WHEEL_R*0.68','WHEEL_R*0.075, WHEEL_R*0.68')
exec(compile(src,'car_quality_rebuild','exec'),globals())
for name,rough,metal in [('CarBody',.26,.15),('CarGlass',.12,.05),('CarHeadlight',.22,.1),('CarRim',.32,.55)]:
 p=bpy.data.materials[name].node_tree.nodes['Principled BSDF'];p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
bpy.data.materials['CarRim'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.62,.65,.69,1)
bpy.data.materials['CarTaillight'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.35,.004,.008,1)
bpy.data.materials['CarDrl'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.65
bpy.ops.export_scene.gltf(filepath=str(OUT/'car_sedan_v3.glb'),export_format='GLB',export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'car_sedan_v3.blend'))
