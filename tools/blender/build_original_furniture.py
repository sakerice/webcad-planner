"""Independently authored furniture. Only category, ID and requested dimensions are read from the catalogue; no source geometry or texture is imported."""
import bpy,math,json,os,struct
from pathlib import Path
from mathutils import Vector,Matrix
R=Path(__file__).resolve().parents[2];OUT=R/'assets/models/original';WORK=R/'tools/blender/work/original';OUT.mkdir(exist_ok=True);WORK.mkdir(exist_ok=True)
def material(name,col,rough=.6,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def box(name,pos,size,mat,r=.012):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat);b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=min(r,min(size)*.45);b.segments=4;n=o.modifiers.new('Surface normals','WEIGHTED_NORMAL');return o
def piping(name,pos,sx,sy,corner,mat):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=.0014;curve.bevel_resolution=2
 spline=curve.splines.new('POLY');points=[]
 for cx,cy,start in [(sx/2-corner,sy/2-corner,0),(-sx/2+corner,sy/2-corner,90),(-sx/2+corner,-sy/2+corner,180),(sx/2-corner,-sy/2+corner,270)]:
  for k in range(9):
   a=math.radians(start+k*90/8);points.append((pos[0]+cx+corner*math.cos(a),pos[1]+cy+corner*math.sin(a),pos[2],1))
 spline.points.add(len(points)-1)
 for p,co in zip(spline.points,points):p.co=co
 spline.use_cyclic_u=True;o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);curve.materials.append(mat)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
 return bpy.context.object
def sphere(name,pos,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,a,b,r,mat):
 a,b=Vector(a),Vector(b);delta=b-a;bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r*.72 if name in ('Leg','Tapered support') else r,radius2=r,depth=delta.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();o.data.materials.append(mat);bv=o.modifiers.new('Edge','BEVEL');bv.width=r*.18;bv.segments=3
 for p in o.data.polygons:p.use_smooth=True
 return o
def ring(name,pos,rx,ry,r,mat):
 bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=12,major_radius=1,minor_radius=r,location=pos);o=bpy.context.object;o.name=name;o.scale=(rx,ry,1);o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def mesh(name,vs,fs,mat):
 d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(mat)
 for p in d.polygons:p.use_smooth=True
 return o
def bowl(w,d,z,depth,mat):
 vs=[];fs=[];N=64
 for k in range(13):
  t=k/12;r=.10+.90*t;zz=z-depth*(1-t*t)
  for j in range(N):a=j*math.tau/N;vs.append((w*.46*r*math.cos(a),d*.44*r*math.sin(a),zz))
 for k in range(12):
  for j in range(N):a=k*N+j;b=k*N+(j+1)%N;fs.append((a,b,b+N,a+N))
 fs.append(tuple(reversed(range(N))));o=mesh('Continuous ceramic bowl',vs,fs,mat);s=o.modifiers.new('Ceramic shell','SOLIDIFY');s.thickness=min(w,d)*.025;return o
items=json.load(open(R/'assets/models/furniture_mega/manifest.json'))['items'];items += [{'id':'original-washer','name':'WashingMachine','sourceFolder':'Appliance','w':600,'d':650,'h':900},{'id':'original-media-console','name':'MediaConsole','sourceFolder':'Media','w':1500,'d':400,'h':1100}];filt=os.environ.get('ORIGINAL_FILTER')
if os.environ.get('ORIGINAL_COLLECTION'):items=json.load(open(R/'tools/blender/original-collection.json'))['items']
if filt:items=[i for i in items if i['id'] in filt.split(',')]
family=os.environ.get('ORIGINAL_FAMILY')
if family:items=[i for i in items if i['sourceFolder'] in family.split(',')]
for ix,it in enumerate(items):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 w,d,h=[max(.08,it[k]/1000) for k in ('w','d','h')];u=min(w,d,h);seed=sum(map(ord,it['id']));variant=seed%3
 wood=material('Original oak',[(.34,.21,.11),(.17,.09,.045),(.48,.34,.20)][variant],.62)
 cloth=material('Original woven upholstery',[(.40,.46,.43),(.51,.43,.34),(.30,.36,.43)][variant],.94)
 cream=material('Warm matte lacquer',(.78,.76,.70),.43);metal=material('Satin hardware',(.28,.30,.32),.32,.75);black=material('Recess and rubber',(.018,.023,.026),.82);ceramic=material('Glazed ceramic',(.88,.90,.89),.24);white=material('Cotton bedding',(.80,.79,.74),.96)
 # Original periodic grain and weave maps; generated mathematically, no imported imagery.
 for mat,kind in [(wood,'wood'),(cloth,'cloth'),(white,'cloth')]:
  N=512 if os.environ.get('ORIGINAL_COLLECTION') and kind=='wood' else 128;pixels=[]
  base=mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3]
  for yy in range(N):
   for xx in range(N):
    if kind=='wood':
     phase=xx*math.tau*97/N+3.6*math.sin(yy*math.tau/N)+.75*math.sin(yy*math.tau*3/N)
     shade=.968+.015*math.sin(phase)+.008*math.sin(phase*2)+.007*math.sin(xx*math.tau*31/N+.5*math.sin(yy*math.tau/N))
    else:shade=.95+.025*math.cos(xx*math.pi/4)+.025*math.cos(yy*math.pi/4)
    pixels.extend(([shade,shade,shade] if os.environ.get('ORIGINAL_COLLECTION') else [min(1,c*shade) for c in base])+[1])
  image=bpy.data.images.new('Original '+kind,width=N,height=N);image.pixels.foreach_set(pixels);image.update();image.pack()
  node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
  if kind=='cloth':
   uv=mat.node_tree.nodes.new('ShaderNodeTexCoord');mapping=mat.node_tree.nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(1,1,1) if os.environ.get('ORIGINAL_COLLECTION') else (40,40,1);mat.node_tree.links.new(uv.outputs['UV'],mapping.inputs['Vector']);mat.node_tree.links.new(mapping.outputs['Vector'],node.inputs['Vector'])
  pbr=mat.node_tree.nodes['Principled BSDF']
  if os.environ.get('ORIGINAL_COLLECTION'):
   mul=mat.node_tree.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[2].default_value=(*base,1);mat.node_tree.links.new(node.outputs['Color'],mul.inputs[1]);mat.node_tree.links.new(mul.outputs[0],pbr.inputs['Base Color'])
  else:mat.node_tree.links.new(node.outputs['Color'],pbr.inputs['Base Color'])
 if os.environ.get('ORIGINAL_COLLECTION'):
  for m in (cloth,white):
   N=128;px=[]
   for yy in range(N):
    for xx in range(N):
     nx=.18*math.sin(xx*math.pi/4);ny=.18*math.sin(yy*math.pi/4);px.extend((.5+nx/2,.5+ny/2,.5+math.sqrt(1-nx*nx-ny*ny)/2,1))
   image=bpy.data.images.new('Original woven normal',width=N,height=N);image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(px);image.pack();tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
   normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.32;m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],m.node_tree.nodes['Principled BSDF'].inputs['Normal'])
 name=it['name'].lower();folder=it['sourceFolder']
 if folder=='Media':
  box('Media cabinet',(0,0,h*.20),(w,d,h*.38),wood,u*.03)
  box('Display frame',(0,0,h*.71),(w*.82,d*.10,h*.56),black,u*.02)
  screen=material('Anti glare display',(.014,.026,.036),.24)
  box('Display surface',(0,-d*.058,h*.72),(w*.78,d*.015,h*.51),screen,u*.01)
  for x in (-w*.20,w*.20):tube('Display support',(x,0,h*.45),(x,-d*.20,h*.40),u*.015,metal)
 elif name=='washingmachine':
  box('Washer enclosure',(0,0,h*.50),(w,d,h),cream,u*.04)
  box('Control panel',(0,-d*.505,h*.86),(w*.92,d*.025,h*.13),cream,u*.012)
  bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=w*.31,depth=.018,location=(0,-d*.515,h*.48),rotation=(math.pi/2,0,0));bpy.context.object.data.materials.append(black)
  rim=ring('Washer door ring',(0,-d*.535,h*.48),w*.34,w*.34,.028,metal);rim.rotation_euler.x=math.pi/2
  sphere('Dial',(w*.27,-d*.54,h*.86),(w*.055,.022,w*.055),metal)
 elif folder=='Beds':
  box('Platform',(0,0,h*.21),(w*.97,d*.96,h*.30),wood,u*.05)
  box('Mattress',(0,-d*.025,h*.47),(w*.96,d*.91,h*.24),white,u*.12)
  box('Upholstered headboard',(0,d*.46,h*.58),(w,d*.08,h*.84),cloth,u*.09)
  for x in (-w*.25,w*.25):box('Soft pillow',(x,d*.29,h*.65),(w*.42,d*.19,h*.16),white,u*.12)
  if os.environ.get('ORIGINAL_COLLECTION'):
   for x in (-w*.25,w*.25):piping('Pillow stitched edge',(x,d*.29,h*.65),w*.42+.002,d*.19+.002,min(u*.12,h*.071),white)
   for x in (-w*.46,w*.46):box('Platform side rail',(x,-d*.02,h*.36),(w*.035,d*.89,h*.06),wood,.008)
   box('Recessed bed plinth',(0,0,h*.06),(w*.83,d*.84,h*.12),black,.005)
  # Smooth irregular cloth surface with draping side edges.
  vs=[];fs=[];N=32;M=28
  for j in range(M+1):
   y=-d*.50+j/M*d*.67
   for k in range(N+1):
    x=(k/N-.5)*w*1.04;edge=max(0,min(1,(abs(x)/w-.48)/.04));front=max(0,min(1,(-y/d-.46)/.04));z=h*.615-h*.13*max(edge*edge,front*front)+h*.022*math.sin(math.pi*k/N)*math.sin(math.pi*j/M)+h*.006*math.sin(k*.55+j*.33)*math.sin(j*.22);vs.append((x,y,z))
  for j in range(M):
   for k in range(N):a=j*(N+1)+k;fs.append((a,a+1,a+N+2,a+N+1))
  o=mesh('Draped cotton duvet',vs,fs,cloth);sub=o.modifiers.new('Soft duvet folds','SUBSURF');sub.levels=1;so=o.modifiers.new('Fabric thickness','SOLIDIFY');so.thickness=.006
 elif folder in ('Sofas','Chairs'):
  sofa=folder=='Sofas';seatZ=h*(.42 if sofa else .46)
  for x in (-w*.39,w*.39):
   for y in (-d*.34,d*.34):tube('Tapered support',(x,y,.025),(x*.93,y*.93,seatZ*.82),u*.042,wood)
  box('Seat frame',(0,0,seatZ*.84),(w*.94,d*.91,h*.11),wood,u*.04)
  count=max(1,round(w/.64)) if sofa else 1
  for k in range(count):
   x=(k-(count-1)/2)*w*.82/count
   box('Tailored seat cushion',(x,-d*.05,seatZ),(w*.80/count,d*.76,h*.15),cloth,u*.12)
   if os.environ.get('ORIGINAL_COLLECTION'):piping('Seat welt seam',(x,-d*.05,seatZ+h*.018),w*.80/count+.004,d*.76+.004,min(u*.12,h*.0675),cloth)
   o=box('Upholstered back',(x,d*.32,h*.74),(w*.81/count,d*.18,h*.51),cloth,u*.10);o.rotation_euler.x=-.10
  if os.environ.get('ORIGINAL_COLLECTION'):
   box('Underseat dust cover',(0,0,seatZ*.76),(w*.86,d*.84,.009),black,.003)
   for x in (-w*.38,w*.38):tube('Back frame upright',(x,d*.40,seatZ*.74),(x,d*.46,h*.80),u*.025,wood)
   tube('Back frame rail',(-w*.42,d*.46,h*.77),(w*.42,d*.46,h*.77),u*.025,wood)
   for k in range(count):
    x=(k-(count-1)/2)*w*.82/count
    welt=piping('Back cushion seam',(0,0,0),w*.81/count+.002,h*.51+.002,min(u*.10,d*.080),cloth)
    welt.rotation_euler.x=math.pi/2-.10;welt.location=(x,d*.32,h*.74)
  if sofa or variant==1:
   for x in (-w*.45,w*.45):box('Rounded arm',(x,0,h*.52),(w*.095,d*.92,h*.28),cloth,u*.09)
 elif folder=='Tables':
  box('Solid wood top',(0,0,h*.96),(w,d,h*.08),wood,u*.055)
  for x in (-w*.40,w*.40):
   for y in (-d*.38,d*.38):tube('Leg',(x*1.03,y*1.03,.02),(x,y,h*.91),u*.045,wood)
  for y in (-d*.36,d*.36):box('Apron',(0,y,h*.83),(w*.83,u*.06,h*.15),wood,u*.018)
  if os.environ.get('ORIGINAL_COLLECTION'):
   for x in (-w*.40,w*.40):box('End apron',(x,0,h*.83),(u*.06,d*.75,h*.15),wood,.007)
   for x in (-w*.40,w*.40):
    for y in (-d*.38,d*.38):box('Leg fixing plate',(x,y,h*.90),(.10,.10,.005),metal,.003)

 elif ('cabinet' in name and 'sink' in name) or 'vanity' in name:
  box('Vanity base',(0,0,h*.37),(w,d,h*.74),wood,u*.025)
  for sign in (-1,1):
   box('Vanity door',(sign*w*.245,-d*.51,h*.38),(w*.48,d*.025,h*.65),wood,u*.012)
   tube('Door handle',(sign*w*.10,-d*.54,h*.52),(sign*w*.10,-d*.54,h*.66),u*.014,metal)
  bowl(w*.95,d*.90,h*.97,h*.19,ceramic)
  ring('Basin rim',(0,0,h*.97),w*.44,d*.40,u*.04,ceramic)
  tube('Tap',(w*.30,d*.32,h*.92),(w*.30,d*.32,h*1.12),u*.023,metal)
  tube('Spout',(w*.30,d*.32,h*1.12),(w*.30,d*.09,h*1.12),u*.023,metal)
 elif os.environ.get('ORIGINAL_COLLECTION') and folder in ('Closets','Drawers'):
  plinth=.065;thickness=.022
  box('Recessed cabinet plinth',(0,d*.02,plinth/2),(w-.10,d-.09,plinth),black,.004)
  for x in (-w/2+thickness/2,w/2-thickness/2):box('Cabinet side panel',(x,0,(h+plinth)/2),(thickness,d,h-plinth),wood,.002)
  box('Solid cabinet top',(0,0,h-thickness/2),(w,d,thickness),wood,.003)
  box('Cabinet base',(0,0,plinth+thickness/2),(w,d,thickness),wood,.002)
  box('Recessed back panel',(0,d/2-.009,(h+plinth)/2),(w-.035,.012,h-plinth-.035),wood,.001)
  frontHeight=h-plinth-2*thickness;rows=3 if folder=='Drawers' else 1;cols=2
  for row in range(rows):
   for col in range(cols):
    pw=(w-2*thickness)/cols-.003;ph=frontHeight/rows-.003;x=(col-.5)*(w-2*thickness)/2;z=plinth+thickness+(row+.5)*frontHeight/rows
    box('Door panel',(x,-d/2-.001,z),(pw,.021,ph),wood,.002)
    hz=z+ph*.25 if rows>1 else h*.51;hx=x if rows>1 else ((-1 if col==0 else 1)*.055)
    if rows>1:
     for dx in (-.055,.055):tube('Handle standoff',(hx+dx,-d/2-.013,hz),(hx+dx,-d/2-.032,hz),.004,metal)
     tube('Pull',(hx-.070,-d/2-.032,hz),(hx+.070,-d/2-.032,hz),.0045,metal)
    else:
     for dz in (-.070,.070):tube('Handle standoff',(hx,-d/2-.013,hz+dz),(hx,-d/2-.032,hz+dz),.004,metal)
     tube('Pull',(hx,-d/2-.032,hz-.085),(hx,-d/2-.032,hz+.085),.0045,metal)
 elif folder in ('Closets','Drawers') or any(k in name for k in ('cabinet','vanity','refrigerator','oven','microwave')):
  appliance=any(k in name for k in ('refrigerator','oven','microwave'));m=cream if appliance else wood
  box('Cabinet carcass',(0,0,h*.51),(w,d*.96,h*.98),m,u*.025)
  rows=4 if folder=='Drawers' else (2 if 'refrigerator' in name else 1);cols=2 if folder=='Closets' else 1
  for j in range(rows):
   for k in range(cols):
    x=(k-(cols-1)/2)*w/cols;z=(j+.5)*h/rows
    box('Recess reveal',(x,-d*.494,z),(w/cols*.97,d*.013,h/rows*.96),black,u*.005)
    box('Door panel',(x,-d*.507,z),(w/cols*.95,d*.025,h/rows*.94),m,u*.012)
    if not appliance and variant==1:
     box('Inset panel',(x,-d*.525,z),(w/cols*.77,d*.012,h/rows*.74),m,u*.012)
    tube('Pull',(x-w/cols*.16,-d*.536,z+h/rows*.28),(x+w/cols*.16,-d*.536,z+h/rows*.28),u*.012,metal)
  if 'oven' in name or 'microwave' in name:box('Smoked oven window',(0,-d*.53,h*.45),(w*.72,d*.015,h*.53),black,u*.025)
 elif 'bathtub' in name or 'washbasin' in name or 'sink' in name:
  bowl(w,d,h*.96,h*.58,ceramic);ring('Rounded basin lip',(0,0,h*.96),w*.46,d*.44,u*.06,ceramic)
  if 'washbasin' in name:box('Pedestal',(0,d*.12,h*.30),(w*.30,d*.33,h*.60),ceramic,u*.09)
  tube('Waste outlet',(0,0,h*.39),(0,0,h*.405),u*.06,metal)
  tube('Tap stem',(w*.22,d*.32,h*.77),(w*.22,d*.32,h*1.06),u*.024,metal)
  tube('Tap spout',(w*.22,d*.32,h*1.06),(w*.22,d*.13,h*1.06),u*.024,metal)
 elif 'toilet' in name:
  sphere('Pedestal',(0,0,h*.25),(w*.31,d*.31,h*.25),ceramic)
  bowl(w,d*.70,h*.64,h*.20,ceramic);ring('Seat',(0,-d*.08,h*.65),w*.44,d*.30,u*.035,cream)
  box('Cistern',(0,d*.34,h*.67),(w*.77,d*.25,h*.65),ceramic,u*.07);box('Cistern lid',(0,d*.34,h*.99),(w*.80,d*.27,h*.035),cream,u*.012)
 elif any(k in name for k in ('hanger','shower')):
  tube('Wall rail',(-w*.45,0,h*.45),(w*.45,0,h*.45),u*.035,metal)
  for x in (-w*.45,w*.45):tube('Bracket',(x,0,h*.45),(x,d*.8,h*.45),u*.04,metal)
  if 'shower' in name:
   tube('Riser',(0,0,0),(0,0,h*.93),u*.045,metal);tube('Overhead arm',(0,0,h*.93),(0,-d*.75,h*.93),u*.045,metal);box('Rain shower head',(0,-d*.75,h*.93),(w*.8,d*.45,h*.035),metal,u*.06)
 else:
  # Kitchen appliances: an original functional enclosure with separated controls.
  box('Appliance body',(0,0,h*.5),(w,d,h),cream,u*.035)
  if 'stove' in name:
   box('Glass cooktop',(0,0,h),(w*.97,d*.97,.012),black,u*.025)
   for x in (-w*.24,w*.24):
    for y in (-d*.23,d*.23):ring('Burner',(x,y,h+.012),min(w,d)*.18,min(w,d)*.18,.008,metal)
  elif 'exhaust' in name:
   box('Hood intake',(0,0,h*.02),(w*.90,d*.85,h*.025),black,u*.02)
   for k in range(9):box('Filter slat',((k-4)*w*.08,0,h*.005),(w*.025,d*.75,h*.022),metal,u*.003)
  else:
   for k in range(3):sphere('Control',((k-1)*w*.20,-d*.51,h*.78),(u*.025,u*.012,u*.025),metal)
 # Explicit editable finish channels; fixed fittings retain their authored surface.
 if os.environ.get('ORIGINAL_COLLECTION'):
  wood['finishChannel']='wood';cloth['finishChannel']='fabric'
  for m in bpy.data.materials:
   if m not in (wood,cloth):m['lockColor']=True
 # Bake only own geometry. Export axes conversion gives +Z front from Blender -Y.
 for o in list(bpy.context.scene.objects):
  bpy.context.view_layer.objects.active=o
  for mod in list(o.modifiers):
   try:bpy.ops.object.modifier_apply(modifier=mod.name)
   except Exception:pass
 # Use metre-based grain mapping so tall doors retain vertical grain.
 for o in bpy.context.scene.objects:
  if o.type!='MESH' or not o.data.materials or o.data.materials[0]!=wood:continue
  layer=o.data.uv_layers.active or o.data.uv_layers.new(name='Original grain UV')
  for poly in o.data.polygons:
   normal=o.matrix_world.to_3x3()@poly.normal
   for li in poly.loop_indices:
    p=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
    if abs(normal.z)>.7:uv=(p.y/.5,p.x/1.8)
    elif abs(normal.x)>.7:uv=(p.y/.5,p.z/1.8)
    else:uv=(p.x/.5,p.z/1.8)
    layer.data[li].uv=uv
 if os.environ.get('ORIGINAL_COLLECTION'):
  bpy.context.view_layer.update();objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];corners=[o.matrix_world@Vector(c) for o in objects for c in o.bound_box]
  low=Vector([min(c[k] for c in corners) for k in range(3)]);high=Vector([max(c[k] for c in corners) for k in range(3)])
  shift=Matrix.Translation(Vector((-(low.x+high.x)/2,-(low.y+high.y)/2,-low.z)))
  scale=Matrix.Diagonal((w/(high.x-low.x),d/(high.y-low.y),h/(high.z-low.z),1))
  for o in objects:o.matrix_world=scale@shift@o.matrix_world
 if os.environ.get('ORIGINAL_COLLECTION'):
  for o in bpy.context.scene.objects:
   if o.type!='MESH' or not o.data.materials or o.data.materials[0] not in (cloth,white):continue
   layer=o.data.uv_layers.active or o.data.uv_layers.new(name='Metre cloth UV')
   for poly in o.data.polygons:
    n=o.matrix_world.to_3x3()@poly.normal
    for li in poly.loop_indices:
     v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
     layer.data[li].uv=(v.x/.064,v.y/.064) if abs(n.z)>.7 else ((v.y/.064,v.z/.064) if abs(n.x)>.7 else (v.x/.064,v.z/.064))
 bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(it['id']+'.blend')))
 if os.environ.get('ORIGINAL_COLLECTION'):
  for m in (wood,cloth,white):
   tex=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE');m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
 bpy.ops.export_scene.gltf(filepath=str(OUT/(it['id']+'.glb')),export_format='GLB',export_apply=True,export_extras=True)
 if os.environ.get('ORIGINAL_COLLECTION'):
  path=OUT/(it['id']+'.glb');data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length])
  for m in doc['materials']:
   source=bpy.data.materials.get(m['name'])
   if source in (wood,cloth,white):m['pbrMetallicRoughness']['baseColorFactor']=list(source.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)
  doc['asset']['extras']={'provenance':'Independently authored in Blender; no imported geometry or imagery','front':'+Z','up':'+Y','source':'tools/blender/build_original_furniture.py'}
  raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=data[20+length:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
 print('ORIGINAL',ix+1,len(items),it['id'],flush=True)
