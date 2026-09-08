"""Quality-first authored replacements. No decimation; original assets preserved."""
import bpy,math,runpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/models/refined'
OUT.mkdir(exist_ok=True)
WORK=ROOT/'tools/blender/work/quality'
WORK.mkdir(parents=True,exist_ok=True)
def export(name):
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str((WORK if name=='car_sedan_v2' else OUT)/(name+'.glb')),export_format='GLB',export_apply=True,export_yup=True,export_cameras=False,export_lights=False)
 bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(name+'.blend')))
def mat(name,c,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def box(name,pos,scale,m,bevel=.03):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  mod=o.modifiers.new('Tailored rounded edges','BEVEL');mod.width=bevel;mod.segments=5
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 for poly in o.data.polygons:poly.use_smooth=True
 mod=o.modifiers.new('Surface normals','WEIGHTED_NORMAL');mod.keep_sharp=True
 return o
bpy.ops.wm.read_factory_settings(use_empty=True)
fabric=mat('Woven upholstery',(.42,.46,.43),.92);welt=mat('Upholstery seam',(.25,.29,.26),.95);wood=mat('Oak legs',(.24,.12,.055),.5)
# Front is Blender -Y = glTF +Z. Separate padded arms, seat and back cushions.
box('Upholstered base',(0,0,.30),(2.0,.87,.27),fabric,.085)
for x in [-.89,.89]:
 box('Padded arm',(x,0,.54),(.22,.94,.58),fabric,.08)
 for y in [-.30,.30]:box('Oak leg',(x,y,.10),(.075,.075,.20),wood,.012)
box('Back frame',(0,.34,.68),(1.62,.22,.68),fabric,.065)
for x in [-.405,.405]:
 seat=box('Separate seat cushion',(x,-.065,.51),(.79,.70,.20),fabric,.075)
 back=box('Soft back cushion',(x,.22,.80),(.79,.22,.51),fabric,.09);back.rotation_euler.x=math.radians(-9)
 # Tailored perimeter welt, a small seam follows the rounded seat outline.
 curve=bpy.data.curves.new('Seat welt','CURVE');curve.dimensions='3D';curve.bevel_depth=.0025;curve.bevel_resolution=3
 spline=curve.splines.new('POLY');points=[]
 for cx,cy,start in [(.32,.265,0),(-.32,.265,90),(-.32,-.265,180),(.32,-.265,270)]:
  for i in range(9):
   a=math.radians(start+i*90/8);points.append((x+cx+.06*math.cos(a),-.065+cy+.06*math.sin(a),.555))
 spline.points.add(len(points)-1)
 for p,v in zip(spline.points,points):p.co=(*v,1)
 spline.use_cyclic_u=True;o=bpy.data.objects.new('Seat seam',curve);bpy.context.collection.objects.link(o);o.data.materials.append(welt)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
export('sofa_tailored_v1')
# Rebuild the sedan: retain the authored lower chassis and replace jagged cabin face
# assignments with explicitly bounded window panels, roof and pillars.
bpy.ops.wm.read_factory_settings(use_empty=True)
src=(ROOT/'tools/blender/car_build.py').read_text()
exec(compile(src,str(ROOT/'tools/blender/car_build.py'),'exec'),globals())
bpy.data.objects.remove(bpy.data.objects['car_glasshouse'],do_unlink=True)
GLASS.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.025,.055,.075,1)
GLASS.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.05
GLASS.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.13
DRLW.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.6
BODY.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.27
# Panel helper: subdivision provides curved, smooth glass and controlled boundaries.
def panel(name,points,material,bulge=0):
 verts=[];faces=[];n=12
 for j in range(n+1):
  v=j/n
  for i in range(n+1):
   u=i/n;p=(Vector(points[0])*(1-u)+Vector(points[1])*u)*(1-v)+(Vector(points[3])*(1-u)+Vector(points[2])*u)*v;p.z+=bulge*math.sin(math.pi*u)*math.sin(math.pi*v);verts.append(p)
 for j in range(n):
  for i in range(n):a=j*(n+1)+i;faces.append((a,a+1,a+n+2,a+n+1))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(material)
 for p in me.polygons:p.use_smooth=True
 return o
panel('car_roof',[(-.61,.29,1.33),(.61,.29,1.33),(.61,-.83,1.33),(-.61,-.83,1.33)],BODY,.055)
panel('car_windshield',[(-.73,1.08,.82),(.73,1.08,.82),(.61,.29,1.33),(-.61,.29,1.33)],GLASS,.022)
panel('car_rear_window',[(.69,-1.50,.86),(-.69,-1.50,.86),(-.61,-.83,1.33),(.61,-.83,1.33)],GLASS,.018)
for sign in [-1,1]:
 panel('car_side_glass',[(sign*.735,1.04,.82),(sign*.695,-1.48,.86),(sign*.61,-.83,1.33),(sign*.61,.29,1.33)],GLASS)
 # Pillars are actual surfaces, not coarse polygon material classification.
 for label,y0,y1,ztop in [('A',1.08,.29,1.33),('C',-1.50,-.83,1.33)]:
  panel('car_'+label+'_pillar',[(sign*.74,y0,.815),(sign*.74,y0-.075,.815),(sign*.617,y1-.055,ztop),(sign*.617,y1+.02,ztop)],BODY)
 panel('car_B_pillar',[(sign*.73,-.12,.825),(sign*.727,-.23,.825),(sign*.617,-.23,1.34),(sign*.617,-.12,1.34)],TRIM)
 panel('car_window_sill',[(sign*.738,1.07,.805),(sign*.702,-1.49,.845),(sign*.702,-1.49,.87),(sign*.738,1.07,.83)],CHROME)
# The existing chassis is +Y-front (glTF -Z); keep car plan convention unchanged.
export('car_sedan_v2')
