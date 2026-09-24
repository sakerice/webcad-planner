"""Original residential fixtures, authored in metres; Blender -Y is front (glTF +Z)."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from original_geometry import *
from shape_kit import unwrap
import json
R=Path(__file__).resolve().parents[2]
OUT=R/'assets/models/original';WORK=R/'tools/blender/work/original'
SPECS=[('ac-unit','室外機・ディテールモデル',800,300,630),('heat-pump','ヒートポンプ（貯湯タンク用）',850,320,640),('mailbox','独立ポスト',420,250,1250),('parcel-box','宅配ボックス',450,450,820),('entry-column','インターホン門柱',180,160,1500),('garden-tap','立水栓・水受け',500,500,850),('tank','エコキュート 貯湯タンク',630,760,1850),('meter','電力メーター',180,120,250),('gas-unit','壁掛け給湯器',470,240,700),('drain-cover','点検蓋',300,300,20)]
SPECS += [('parcel-slim-column','宅配ポスト・薄型機能門柱',340,220,1500),('parcel-integrated-column','宅配ポスト・一体型機能門柱',470,440,1500),('parcel-pole-mounted','宅配ボックス・二本脚型',460,450,1150)]
def line(name,points,r,mat):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for p,co in zip(s.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);c.materials.append(mat);return o
def cylinder(name,pos,r,depth,mat,front=False,verts=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=pos);o=bpy.context.object;o.name=name
 if front:o.rotation_euler.x=math.pi/2
 o.data.materials.append(mat);m=o.modifiers.new('Rolled edge','BEVEL');m.width=min(.002,depth*.12);m.segments=3
 for p in o.data.polygons:p.use_smooth=True
 return o
def screw(x,y,z):
 cylinder('Stainless fixing screw',(x,y,z),.004,.003,steel,True,12)
 box('Screw slot',(x,y-.002,z),(.005,.001,.001),dark,.0002)
def face_panel(name,x,y,z,w,h,mat):return box(name,(x,y,z),(w,.012,h),mat,.003)
def front_ring(name,pos,r,thickness,mat):
 bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=thickness,major_segments=64,minor_segments=8,location=pos,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def fan(x,z,r,y):
 cylinder('Fan recess',(x,y+.038,z),r,.012,dark,True)
 for k in range(3):
  vs=[]
  for radius,angle,depth in [(.035,-18,0),(.07,-40,-.004),(r*.82,-25,-.012),(r*.94,4,-.017),(r*.82,31,-.008),(.07,15,.008)]:
   a=math.radians(angle+k*120);vs.append((x+radius*math.cos(a),y+.026+depth,z+radius*math.sin(a)))
  o=mesh('Swept impeller blade',vs,[tuple(range(6))],rubber);so=o.modifiers.new('Blade thickness','SOLIDIFY');so.thickness=.004;be=o.modifiers.new('Blade edge','BEVEL');be.width=.002;be.segments=2
 cylinder('Motor hub',(x,y+.012,z),r*.22,.025,rubber,True)
 for k in range(1,10):
  front_ring('Concentric wire guard',(x,y,z),r*k/10,.0018,steel)
 for k in range(12):
  a=k*math.tau/12;tube('Radial guard wire',(x+math.cos(a)*r*.18,y-.001,z+math.sin(a)*r*.18),(x+math.cos(a)*r*.98,y-.001,z+math.sin(a)*r*.98),.0016,steel)
 front_ring('Fan rim',(x,y+.006,z),r,.007,paint)
for key,name,wm,dm,hm in SPECS:
 if os.environ.get('EXTERIOR_FILTER') and key not in os.environ['EXTERIOR_FILTER'].split(','):continue
 bpy.ops.wm.read_factory_settings(use_empty=True);w,d,h=wm/1000,dm/1000,hm/1000
 paint=material('Powder coated shell',(.60,.64,.64),.48,.10);paint['finishChannel']='body'
 steel=material('Brushed stainless',(.30,.34,.36),.32,.78);dark=material('Recess shadow',(.016,.021,.023),.86);rubber=material('Elastomer and impeller',(.035,.043,.047),.86);brass=material('Brass fittings',(.42,.28,.10),.36,.72);ceramic=material('Glazed water pan',(.69,.70,.66),.31)
 for m in (steel,dark,rubber,brass,ceramic):m['lockColor']=True
 if key in ('mailbox','parcel-box','entry-column'):paint.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.055,.070,.075,1)
 if key in ('ac-unit','heat-pump'):
  shell=box('Pressed enclosure',(0,0,.354),(.794,.290,.55),paint,.015)
  for mo in list(shell.modifiers):
   if mo.type=='WEIGHTED_NORMAL':shell.modifiers.remove(mo)
  cut=cylinder('Temporary fan opening',(-.15,-.14,.353),.218,.12,dark,True,64);bpy.context.view_layer.objects.active=shell;mod=shell.modifiers.new('Recessed circular intake','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut
  for mo in list(shell.modifiers):
   if mo.type!='WEIGHTED_NORMAL':bpy.ops.object.modifier_apply(modifier=mo.name)
  bpy.data.objects.remove(cut,do_unlink=True)
  shell.modifiers.new('Final sheet normals','WEIGHTED_NORMAL')
  rubber.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.10,.115,.12,1)
  fan(-.15,.353,.208,-.158)
  face_panel('Service compartment',.292,-.147,.350,.173,.478,paint)
  for x in (.221,.363):
   for z in (.15,.55):screw(x,-.157,z)
  box('Rear coil',(0,.148,.356),(.72,.005,.45),dark,.002)
  for k in range(37):box('Heat exchanger fin',((k-18)*.019,.155,.356),(.002,.008,.43),steel,.0005)
  for k in range(13):box('Side ventilation slot',(.397,.01,.20+k*.023),(.002,.17,.007),dark,.002)
  for x in (-.265,.265):
   box('Mounting rail',(x,0,.04),(.074,.30,.068),paint,.006)
   for y in (-.095,.095):box('Isolation pad',(x,y,.008),(.074,.069,.016),rubber,.002);cylinder('Mounting bolt',(x,y,.079),.009,.012,steel,False,6)
  for z in (.17,.23):cylinder('Refrigerant service valve',(.407,.074,z),.012,.035,brass,True,6)
  face_panel('Specification label',.286,-.155,.385,.10,.047,ceramic)
 elif key in ('mailbox','parcel-box'):
  small=key=='mailbox';bodyZ=.99 if small else .46;bodyH=.41 if small else .70
  if small:
   box('Support post',(0,.025,.43),(.075,.07,.86),paint,.004);box('Anchor foot',(0,.025,.025),(.19,.16,.05),steel,.004)
  else:
   box('Raised plinth',(0,0,.055),(w*.88,d*.90,.11),rubber,.004)
  box('Folded body',(0,0,bodyZ),(w,d,bodyH),paint,.009)
  face_panel('Door gasket',0,-d/2-.003,bodyZ,w-.027,bodyH-.027,dark)
  face_panel('Retrieval door',0,-d/2-.012,bodyZ-.016,w-.042,bodyH-.060,paint)
  face_panel('Rain hood',0,-d/2-.012,bodyZ+bodyH*.40,w+.006,.035,paint)
  face_panel('Mail aperture',0,-d/2-.022,bodyZ+bodyH*.29,w*.74,.028,dark)
  flap=face_panel('Posting flap',0,-d/2-.03,bodyZ+bodyH*.32,w*.77,.05,paint);flap.rotation_euler.x=-.12
  cylinder('Key cylinder',(w*.32,-d/2-.024,bodyZ),.012,.012,steel,True,32)
  box('Keyway',(w*.32,-d/2-.032,bodyZ),(.0015,.002,.011),dark,.0004)
  for z in (bodyZ-bodyH*.24,bodyZ+bodyH*.15):box('Concealed hinge',(-w*.46,-d/2-.01,z),(.018,.012,.045),steel,.002)
  face_panel('Name plate',0,-d/2-.029,bodyZ+.04,w*.35,.035,steel)
 elif key in ('parcel-slim-column','parcel-integrated-column','parcel-pole-mounted'):
  slim=key=='parcel-slim-column';pole=key=='parcel-pole-mounted'
  paint.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.045,.055,.062,1)
  accent=material('Satin front finish',(.24,.255,.25),.56,.12);accent['finishChannel']='panel'
  # Folded metal shells, flush access doors and narrow shadow reveals.
  def door(z,height,y,width,mat):
   box('Weather seal',(0,y+.003,z),(width+.006,.010,height+.006),rubber,.002)
   box('Flush access door',(0,y-.006,z),(width,.014,height),mat,.002)
   x=width*.38
   box('Recessed handle surround',(x,y-.015,z+.055),(.032,.005,.100),dark,.003)
   box('Recessed handle grip',(x+.009,y-.022,z+.055),(.010,.012,.080),paint,.002)
   cylinder('Lock cylinder',(x,y-.020,z-.025),.009,.007,steel,True,32)
   box('Lock keyway',(x,y-.025,z-.025),(.0018,.002,.008),dark,.0003)
   for zz in (z-height*.30,z+height*.30):
    box('Hinge knuckle',(-width*.49,y+.002,zz),(.010,.014,.035),steel,.001)
  if pole:
   for x in (-w*.38,w*.38):
    box('Extruded aluminium support',(x,.035,.34),(.052,.065,.68),paint,.003)
    box('Anchor shoe',(x,.035,.012),(.105,.14,.024),steel,.003)
    for yy in (-.01,.08):cylinder('Anchor bolt',(x,yy,.028),.007,.008,steel,False,6)
   bottom=.52;top=h;box('Parcel shell',(0,0,(bottom+top)/2),(w,d-.025,top-bottom),paint,.005)
   door((bottom+top)/2,top-bottom-.025,-d/2+.002,w-.026,accent)
  else:
   # Slim installation and deeper all-in-one housing use different proportions.
   box('Full height folded housing',(0,.008,h/2),(w,d-.024,h),paint,.004)
   box('Recessed base',(0,0,.035),(w-.024,d-.040,.070),rubber,.002)
   y=-d/2+.007
   door(.53,.64,y,w-.027,accent)
   door(1.015,.245,y,w-.027,accent)
   # Postal entry has its own rain-shedding flap, distinct from the parcel door.
   box('Postal slot shadow',(0,y-.018,1.098),(w-.075,.007,.025),dark,.001)
   box('Postal rain flap',(0,y-.023,1.108),(w-.064,.012,.025),accent,.002)
   face_panel('Intercom glass',0,y-.008,1.262,.090,.125,dark)
   cylinder('Camera bezel',(0,y-.018,1.293),.016,.006,steel,True)
   cylinder('Camera lens',(0,y-.023,1.293),.011,.004,dark,True)
   cylinder('Call button',(0,y-.022,1.225),.011,.006,steel,True)
   for k in range(3):box('Speaker perforation',(0,y-.022,1.260-k*.007),(.035,.002,.002),steel,.0003)
   box('Nameplate',(0,y-.006,1.420),(w*.64,.012,.043),accent,.002)
   box('Sign light visor',(0,y-.012,1.459),(w*.72,.022,.012),paint,.002)
   box('Sign diffuser',(0,y-.021,1.452),(w*.61,.008,.003),ceramic,.0005)
   for x in (-w*.36,w*.36):screw(x,d/2-.003,.13)
  # Overhanging top cap and rear service seam are visible from either side.
  box('Rain cap',(0,0,h-.007),(w+.008,d,.014),paint,.003)
  if not slim:
   rearBottom=.54 if pole else .22;rearTop=h-.04 if pole else 1.14
   box('Rear access gasket',(0,d/2-.009,(rearTop+rearBottom)/2),(w-.030,.008,rearTop-rearBottom),dark,.002)
   box('Rear access panel',(0,d/2-.003,(rearTop+rearBottom)/2),(w-.038,.008,rearTop-rearBottom-.008),paint,.002)
   box('Rear pull',(w*.31,d/2+.007,(rearTop+rearBottom)/2),(.014,.018,.080),steel,.002)
 elif key=='entry-column':
  box('Aluminium post',(0,0,h/2),(w,d,h),paint,.006);box('Top rain cap',(0,0,h-.006),(w+.008,d+.008,.02),steel,.003)
  face_panel('Intercom mounting',0,-d/2-.006,1.23,w*.70,.20,rubber)
  cylinder('Camera bezel',(0,-d/2-.017,1.285),.020,.008,steel,True)
  cylinder('Camera lens',(0,-d/2-.023,1.285),.012,.005,dark,True)
  cylinder('Call button',(0,-d/2-.017,1.17),.017,.009,steel,True)
  for k in range(4):face_panel('Speaker slit',0,-d/2-.018,1.225-k*.008,.055,.002,dark)
  face_panel('Nameplate',0,-d/2-.010,1.41,w*.70,.055,steel)
  for x in (-w*.32,w*.32):screw(x,-d/2-.012,.12)
 elif key=='garden-tap':
  box('Water column',(0,.22,.41),(.10,.10,.82),paint,.006)
  line('Faucet spout',[(0,.20,.69),(0,.08,.69),(0,.05,.65)],.013,steel)
  cylinder('Hose coupling',(0,.05,.635),.017,.026,brass)
  cylinder('Valve stem',(0,.135,.72),.011,.08,steel)
  tube('Cross handle',(-.04,.135,.757),(.04,.135,.757),.008,steel)
  bowl(.50,.44,.09,.068,ceramic);ring('Pan rim',(0,0,.09),.23,.20,.02,ceramic)
  cylinder('Waste grate',(0,-.09,.058),.031,.005,steel)
  for k in range(5):box('Drain slots',((k-2)*.009,-.09,.062),(.003,.042,.002),dark,.001)
 elif key=='tank':
  box('Insulated tank cabinet',(0,0,.963),(w,d,1.77),paint,.025)
  face_panel('Service panel gasket',0,-d/2-.001,.50,w-.05,.66,dark);face_panel('Service door',0,-d/2-.009,.50,w-.062,.646,paint)
  for z in (.25,.76):
   for x in (-w*.40,w*.40):screw(x,-d/2-.018,z)
  for x in (-w*.35,w*.35):box('Base stand',(x,0,.055),(.12,d*.85,.11),steel,.005)
  for x in (-.11,0,.11):tube('Insulated connection',(x,-.10,.05),(x,-.10,.25),.018,rubber)
  face_panel('Service information',.17,-d/2-.018,1.23,.11,.13,ceramic)
 elif key=='meter':
  box('Meter back plate',(0,.01,h/2),(w,d*.74,h),paint,.012)
  face_panel('Instrument bezel',0,-d*.40,h*.56,w*.80,h*.70,rubber)
  display=material('LCD background',(.25,.32,.26),.43);display['lockColor']=True
  face_panel('LCD',0,-d*.46,h*.64,w*.64,h*.20,display)
  for k in range(5):
   x=(k-2)*.017
   for z in (.153,.169):face_panel('LCD digit',x,-d*.48,z,.011,.002,dark)
   for x2 in (x-.005,x+.005):face_panel('LCD digit',x2,-d*.48,.161,.002,.018,dark)
  for x in (-.047,.047):screw(x,-d*.46,h*.28)
 elif key=='gas-unit':
  box('Sheet metal enclosure',(0,0,h*.53),(w,d,h*.93),paint,.016)
  face_panel('Front access panel',0,-d/2-.004,h*.49,w-.018,h*.83,paint)
  face_panel('Exhaust recess',0,-d/2-.016,h*.77,w*.65,.09,dark)
  for k in range(4):box('Exhaust baffle',(0,-d/2-.027,h*.735+k*.017),(w*.64,.028,.004),steel,.001)
  for k in range(4):tube('Pipe connection',((k-1.5)*.074,0,0),((k-1.5)*.074,0,.10),.012,brass)
  for x in (-w*.40,w*.40):screw(x,-d/2-.015,h*.21)
 elif key=='drain-cover':
  cylinder('Inspection rim',(0,0,.010),w/2,.020,steel,False,64);cylinder('Inspection lid',(0,0,.016),w*.465,.009,paint,False,64)
  for k in range(-5,6):
   for l in range(-5,6):
    if k*k+l*l<28:box('Anti slip tread',(k*.022,l*.022,.022),(.012,.006,.002),rubber,.001)
  for x in (-w*.29,w*.29):box('Lifting pocket',(x,0,.022),(.020,.042,.002),dark,.003)
 # Apply authored detail first. Keep the Blender master editable as separate parts.
 bpy.ops.object.select_all(action='DESELECT')
 for o in list(bpy.context.scene.objects):
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
  for mo in list(o.modifiers):
   try:bpy.ops.object.modifier_apply(modifier=mo.name)
   except RuntimeError:pass
  o.select_set(False)
 bpy.context.view_layer.update();objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];corners=[o.matrix_world@Vector(c) for o in objects for c in o.bound_box];lo=Vector([min(v[k] for v in corners) for k in range(3)]);hi=Vector([max(v[k] for v in corners) for k in range(3)]);fit=Matrix.Diagonal((w/(hi.x-lo.x),d/(hi.y-lo.y),h/(hi.z-lo.z),1))@Matrix.Translation((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
 for o in objects:o.matrix_world=fit@o.matrix_world
 ident='original-'+key;bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(ident+'.blend')))
 # Combine by material without removing geometry. Source parts stay in the .blend.
 for mat in list(bpy.data.materials):
  group=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
  if len(group)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in group:o.select_set(True)
   bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
 # **UV層の無い部品を展開する。** 無いと、画面に素材の欄が出るのに柄が出ない
 # (UVの無い面は同じ1点を参照するので単色になる)。立水栓の水受けボウルが
 # これで、4,860三角形のうち3,324が1点に潰れていた。
 # プリミティブや曲線から起こした部品は既にUVを持つので触らない。
 # **層が「有る」だけでは足りない。** 立水栓の水受けボウルは UV層を持って
 # いたが、全ての角が同じ1点を指していた(面積ゼロ)。層の有無ではなく
 # 実際に面積があるかで見る。
 for o in [o for o in bpy.context.scene.objects if o.type=='MESH']:
  layer=o.data.uv_layers.active
  if layer and len(layer.data):
   us=[d.uv.x for d in layer.data];vs=[d.uv.y for d in layer.data]
   if (max(us)-min(us))*(max(vs)-min(vs))>1e-9:continue
  unwrap(o)
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ident+'.glb')),export_format='GLB',export_apply=True,export_extras=True)
 print('EXTERIOR',ident,flush=True)
items=[]
for key,name,w,d,h in SPECS:
 items.append(dict(id='original-'+key,name=name,group='外構',category='設備' if key in ['ac-unit','heat-pump','tank','meter','gas-unit','drain-cover'] else '玄関・庭',sourceFolder='BlenderOriginal',provenance='original',model='assets/models/original/original-'+key+'.glb',thumb='assets/models/previews-v2/original-'+key+'-thumb.png',top='assets/models/previews-v2/original-'+key+'-top.png',previewVersion=2,groundLevel=True,defaultElevation=1600 if key=='meter' else (1300 if key=='gas-unit' else 0),w=w,d=d,h=h,front='+Z',finishChannels=[dict(key='body',label='本体塗装',default='#cbd1d1')]))
for item in items:
 if item['id'] in ('original-parcel-slim-column','original-parcel-integrated-column','original-parcel-pole-mounted'):
  item['finishChannels'].append(dict(key='panel',label='扉・アクセント',default='#858a89'))
(R/'tools/blender/exterior-collection.json').write_text(json.dumps({'items':items},ensure_ascii=False,indent=2)+'\n')
