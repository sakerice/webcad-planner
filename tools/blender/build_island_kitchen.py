"""Independent sink island and wall cooking counter; Blender -Y = site +Z."""
import bpy, math, json, struct
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/models/original'; SRC=ROOT/'tools/blender/work/original'; PRE=ROOT/'assets/models/previews-v2'

def mat(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;m['finishChannel']=name.split('_')[0];return m

def box(name,loc,size,material,bevel=.003):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:
  b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 return o

def pipe(name,points,r,material):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=5;s=c.splines.new('POLY');s.points.add(len(points)-1)
 for p,co in zip(s.points,points):p.co=(*co,1)
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(material);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)

def build(ident,w,d,island):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 wood=mat('wood_WarmOak',(.46,.35,.24),.58);stone=mat('stone_IvoryQuartz',(.78,.76,.70),.32);metal=mat('metal_BrushedSteel',(.38,.41,.43),.25,.85);dark=mat('accent_ShadowGap',(.035,.037,.04),.55);glass=mat('glass_Induction',(.012,.018,.024),.17,.15)
 box('Recessed plinth',(0,0,.055),(w-.14,d-.14,.11),dark)
 for x in (-w/2+.014,w/2-.014):box('End panel',(x,0,.47),(.028,d-.03,.71),wood)
 box('Back panel',(0,d/2-.024,.47),(w-.04,.025,.71),wood)
 box('Internal shelf',(0,0,.20),(w-.05,d-.05,.025),wood)
 count=3 if island else 4
 for i in range(count):
  x=-w/2+(i+.5)*w/count
  for z,h in ((.38,.46),(.72,.20)):
   box('Handleless drawer',(x,-d/2+.025,z),(w/count-.006,.027,h),wood)
  box('Recessed finger pull',(x,-d/2+.04,.61),(w/count-.022,.019,.018),dark,.001)
 if island:
  sx,sy,sw,sd=-.42,-.08,.64,.43
  # Worktop is four solid pieces around a real undermount basin opening.
  left=sx-sw/2;right=sx+sw/2
  box('Stone left',((-w/2+left)/2,0,.835),(left+w/2,d,.03),stone)
  box('Stone prep',((right+w/2)/2,0,.835),(w/2-right,d,.03),stone)
  for y0,y1 in ((-d/2,sy-sd/2),(sy+sd/2,d/2)):
   box('Stone sink rail',(sx,(y0+y1)/2,.835),(sw,y1-y0,.03),stone)
  box('Basin bottom',(sx,sy,.66),(sw,.43,.012),metal,.015)
  for x in (sx-sw/2,sx+sw/2):box('Basin wall',(x,sy,.744),(.012,sd,.17),metal,.005)
  for y in (sy-sd/2,sy+sd/2):box('Basin wall',(sx,y,.744),(sw,.012,.17),metal,.005)
  bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.038,depth=.004,location=(sx,sy,.669));bpy.context.object.data.materials.append(dark)
  pts=[(sx,.23,.85),(sx,.23,1.07)]
  pts += [(sx,.12+.11*math.cos(t),1.07+.11*math.sin(t)) for t in [i*math.pi/24 for i in range(25)]]
  pts += [(sx,.01,1.04)]
  pipe('Gooseneck mixer',pts,.013,metal)
  box('Mixer base',(sx,.23,.857),(.06,.06,.016),metal,.006)
  box('Mixer lever',(sx+.07,.23,.93),(.10,.012,.012),metal)
 else:
  box('Continuous quartz worktop',(0,0,.835),(w,d,.03),stone)
  box('Induction glass',(.75,0,.855),(.60,.50,.008),glass)
  for x,y,r in ((.60,-.09,.095),(.92,-.07,.075),(.79,.135,.065)):
   pipe('Induction ring',[(x+r*math.cos(t),y+r*math.sin(t),.860) for t in [i*math.tau/64 for i in range(65)]],.0014,metal)
  for x in (.67,.72,.77,.82):box('Touch control',(x,-.21,.860),(.018,.008,.001),metal,.0003)
 # Join geometry for a stable editable single asset.
 bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.ops.object.join();o=bpy.context.object;o.name=ident
 bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
 bpy.ops.wm.save_as_mainfile(filepath=str(SRC/f'{ident}.blend'))
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{ident}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
 path=OUT/f'{ident}.glb';b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);j['asset']['extras']={'front':'+Z','up':'+Y','provenance':'Independently authored Blender geometry','source':'tools/blender/build_island_kitchen.py'};raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.world.color=(.4,.4,.4)
 for loc,power,size in [((1,-3,4),650,4),((-3,-1,2),400,3),((0,3,4),700,3)]:
  bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,.5))-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=w*1.35
 for label,loc in [('thumb',(3,-4,3)),('front',(0,-5,1.7)),('back',(0,5,1.7)),('top',(0,0,6))]:
  cam.location=loc;cam.rotation_euler=(Vector((0,0,.5))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(PRE/f'{ident}-{label}.png');bpy.ops.render.render(write_still=True)
 return {'id':ident,'name':'シンクアイランド 2100' if island else '壁付IHカウンター 2560','group':'住設','category':'キッチン','w':round(w*1000),'d':round(d*1000),'h':1180 if island else 861,'model':f'assets/models/original/{ident}.glb','thumb':f'assets/models/previews-v2/{ident}-thumb.png','top':f'assets/models/previews-v2/{ident}-top.png','previewVersion':2,'provenance':'original','sourceBlend':f'tools/blender/work/original/{ident}.blend','frontAxis':'+Z','finishChannels':[{'key':k,'label':label,'default':color} for k,label,color in [('wood','木部','#B39A78'),('stone','天板','#E4E0D4'),('metal','金物','#A6AFB4')]]}
if __name__ == '__main__':
 new=[build('original-kitchen-island',2.1,.9,True),build('original-kitchen-cooking',2.56,.65,False)]
 p=ROOT/'assets/models/custom/manifest.json';m=json.loads(p.read_text());ids={i['id'] for i in new};m['items']=[i for i in m['items'] if i['id'] not in ids]+new;p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');p.with_suffix('.js').write_text('window.CUSTOM_MODEL_MANIFEST = '+json.dumps(m,ensure_ascii=False,indent=2)+';\n')
