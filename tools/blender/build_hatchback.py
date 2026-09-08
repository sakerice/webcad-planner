"""Reference-inspired compact hatchback. +Y front, metres. Editable quality master."""
import bpy, math
from mathutils import Vector
from pathlib import Path
R=Path(__file__).resolve().parents[2]; out=R/'tools/blender/work/quality';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(n,c,r=.3,m=0):
 a=bpy.data.materials.new(n);a.diffuse_color=(*c,1);a.use_nodes=True;p=a.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=r;p.inputs['Metallic'].default_value=m;return a
paint=mat('Azure metallic paint',(.012,.32,.52),.25,.65);paint.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value=.5
black=mat('Satin rubber',(.012,.015,.019),.72);glass=mat('Smoked glass',(.055,.10,.13),.12,.25);alloy=mat('Machined aluminium',(.58,.62,.66),.24,.8);red=mat('Red optical lens',(.48,.008,.012),.2,.15);white=mat('LED lens',(.8,.9,1),.18);dark=mat('Lamp housing',(.015,.022,.03),.24);brake=mat('Brake steel',(.19,.20,.21),.5,.7)
def mesh(n,v,f,m):
 d=bpy.data.meshes.new(n);d.from_pydata(v,[],f);d.update();o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def bevel(o,w=.02):
 mod=o.modifiers.new('Rounded manufactured edges','BEVEL');mod.width=w;mod.segments=3;return o
def box(n,pos,dim,m,b=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=n;o.scale=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);bevel(o,b);return o
def line(n,pts,m,r=.005):
 c=bpy.data.curves.new(n,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('POLY');s.points.add(len(pts)-1)
 for p,co in zip(s.points,pts):p.co=(*co,1)
 o=bpy.data.objects.new(n,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def panel(n,pts,m,crown=.02,axis=2,sign=1):
 vs=[];fs=[];N=16
 for j in range(N+1):
  v=j/N
  for i in range(N+1):
   u=i/N;p=Vector(pts[0])*(1-u)*(1-v)+Vector(pts[1])*u*(1-v)+Vector(pts[2])*u*v+Vector(pts[3])*(1-u)*v;p[axis]+=sign*crown*math.sin(math.pi*u)*math.sin(math.pi*v);vs.append(p)
 for j in range(N):
  for i in range(N):a=j*(N+1)+i;fs.append((a,a+1,a+N+2,a+N+1))
 o=mesh(n,vs,fs,m)
 for p in o.data.polygons:p.use_smooth=True
 return o
# Dense longitudinal shell, defined by smooth section interpolation.
S=[(-2.05,.68,.22,.82),(-1.96,.81,.15,.91),(-1.62,.875,.14,.94),(-1.15,.88,.14,.92),(-.4,.885,.14,.87),(.45,.88,.14,.81),(1.1,.86,.15,.74),(1.65,.81,.18,.67),(1.98,.72,.23,.59),(2.05,.59,.29,.54)]
v=[];f=[]
for y,w,z0,z1 in S:
 for j in range(32):
  a=2*math.pi*j/32;x=w*math.copysign(abs(math.sin(a))**.48,math.sin(a));z=(z0+z1)/2+(z1-z0)/2*math.copysign(abs(math.cos(a))**.45,math.cos(a));v.append((x,y,z))
for i in range(len(S)-1):
 for j in range(32):a=i*32+j;b=i*32+(j+1)%32;f.append((a,b,b+32,a+32))
f += [tuple(reversed(range(32))),tuple(range((len(S)-1)*32,len(S)*32))]
o=mesh('Continuous formed body',v,f,paint);sub=o.modifiers.new('Class A surface smoothing','SUBSURF');sub.levels=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=sub.name)
for y in (-1.28,1.24):
 bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=.352,depth=2.2,location=(0,y,.33),rotation=(0,math.pi/2,0));c=bpy.context.object;mod=o.modifiers.new('Wheel opening','BOOLEAN');mod.operation='DIFFERENCE';mod.object=c;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)
for p in o.data.polygons:p.use_smooth=True
bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30));o.select_set(False)
# Separate panels with clean window boundaries rather than face-index colour patches.
for s in (-1,1):
 side=[(s*.80,.88,.82),(s*.68,.22,1.36),(s*.66,-1.06,1.38),(s*.79,-1.62,.95)]
 q=panel('Glazing side',side,glass,.018,axis=0,sign=s)
 line('Window weatherseal',side+[side[0]],black,.012)
 line('B pillar',[(s*.785,-.40,.89),(s*.673,-.40,1.41)],black,.030)
 line('Rear quarter pillar',[(s*.79,-1.30,.94),(s*.675,-1.11,1.39)],paint,.034)
 for y in (.5,-.93):
  line('Door panel gap',[(s*.858,y,.27),(s*.879,y,.62),(s*.815,y,.86)],black,.003)
  box('Recessed handle',(s*.875,y-.15,.77),(.025,.17,.032),paint,.013)
 line('Rocker trim',[(s*.84,-.91,.19),(s*.85,.86,.19)],black,.027)
 box('Mirror stalk',(s*.86,.69,.92),(.15,.06,.035),black)
 box('Mirror painted shell',(s*.98,.67,.96),(.19,.23,.11),paint,.045)
 box('Mirror reflective face',(s*.98,.557,.96),(.16,.008,.074),glass,.023)
 for y in (-1.28,1.24):
  bpy.ops.mesh.primitive_torus_add(major_segments=80,minor_segments=16,location=(s*.79,y,.33),rotation=(0,math.pi/2,0),major_radius=.254,minor_radius=.076);t=bpy.context.object;t.name='Rounded tyre';t.scale.z=1.4;t.data.materials.append(black)
  for p in t.data.polygons:p.use_smooth=True
  for rad,dep,x,m in [(.217,.04,.88,alloy),(.192,.042,.888,dark),(.166,.012,.917,brake)]:
   bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=rad,depth=dep,location=(s*x,y,.33),rotation=(0,math.pi/2,0));bpy.context.object.data.materials.append(m)
  for k in range(10):
   a=k*math.tau/10;b=box('Sculpted alloy spoke',(s*.936,y+math.sin(a)*.112,.33+math.cos(a)*.112),(.024,.028,.19),alloy,.008);b.rotation_euler.x=-a
  box('Brake caliper',(s*.92,y+.125,.33),(.035,.052,.12),brake)
  for k in range(5):
   a=k*math.tau/5;box('Wheel bolt',(s*.953,y+math.sin(a)*.045,.33+math.cos(a)*.045),(.018,.013,.013),alloy,.005)
# Crown roof patch and front/rear glazing.
roof=[(-.68,.22,1.39),(.68,.22,1.39),(.66,-1.06,1.41),(-.66,-1.06,1.41)]
q=panel('Painted roof',roof,paint,.055);sol=q.modifiers.new('Roof thickness','SOLIDIFY');sol.thickness=.035;bevel(q,.025)
for n,pts in [('Windscreen',[(-.80,.94,.79),(.80,.94,.79),(.68,.22,1.39),(-.68,.22,1.39)]),('Rear window',[(-.66,-1.06,1.41),(.66,-1.06,1.41),(.79,-1.68,.95),(-.79,-1.68,.95)])]:
 panel(n,pts,glass,.025);line(n+' surround',pts+[pts[0]],black,.012)
box('Roof spoiler',(0,-1.13,1.43),(1.40,.20,.045),paint,.02)
line('Rear wiper',[(.15,-1.69,.966),(-.35,-1.53,1.07)],black,.009)
for s in (-1,1):
 line('Wiper',[(s*.48,.95,.812),(s*.10,.83,.90)],black,.008)
 b=box('Headlamp',(s*.56,1.86,.55),(.38,.07,.055),dark,.024);b.rotation_euler.z=-s*.16
 line('LED signature',[(s*.76,1.92,.586),(s*.54,1.997,.562),(s*.36,1.998,.565)],white,.009)
 b=box('Rear optical cluster',(s*.60,-1.985,.82),(.42,.08,.09),red,.025)
 line('Tail light guide',[(s*.79,-1.96,.85),(s*.58,-2.035,.86),(s*.40,-2.03,.82)],red,.011)
box('Lower intake',(0,1.982,.40),(1.05,.065,.18),black,.045)
for z in (.35,.39,.43,.47):box('Intake fin',(0,2.023,z),(.94,.008,.009),dark,.003)
box('Rear diffuser',(0,-1.99,.26),(1.33,.07,.16),black,.04)
# Apply modifiers and consolidate by material for a modest draw count.
for ob in list(bpy.context.scene.objects):
 bpy.context.view_layer.objects.active=ob;ob.select_set(True)
 if ob.type=='CURVE':bpy.ops.object.convert(target='MESH')
 for mod in list(ob.modifiers):
  try:bpy.ops.object.modifier_apply(modifier=mod.name)
  except:pass
 ob.select_set(False)
for m in list(bpy.data.materials):
 obs=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==m]
 if not obs:continue
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'hatchback_v1.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'hatchback_v1.glb'),export_format='GLB',export_apply=True)
# Neutral studio review; camera and lights excluded from delivered GLB.
floor=box('Studio floor',(0,0,-.09),(200,200,.1),mat('Studio',(.30,.33,.37),.8))
world=bpy.context.scene.world or bpy.data.worlds.new('World');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.50,.60,1);world.node_tree.nodes['Background'].inputs[1].default_value=.5
for pos,power,size in [((2,3,6),1800,5),((-4,0,3),1400,4),((0,-4,5),2000,3)]:
 bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,.6))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,6,3.0));c=bpy.context.object;c.rotation_euler=(Vector((0,0,.7))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=5.7
sc=bpy.context.scene;sc.camera=c;sc.render.engine='CYCLES';sc.cycles.samples=32;sc.render.resolution_x=1100;sc.render.resolution_y=800;sc.render.resolution_percentage=100;sc.render.filepath=str(out/'hatchback_v1.png');bpy.ops.render.render(write_still=True)
