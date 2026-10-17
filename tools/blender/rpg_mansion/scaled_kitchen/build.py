"""Measured original modular scullery furniture for the RPG mansion asset set.

Asset-only isolated production. Blender metres/Z-up/-Y front export to glTF
metres/+Y up/+Z front. No imported geometry, imagery, paid APIs or dependencies.
Native authoring-part scene is preserved beside the validated export scene.
"""
from pathlib import Path
import sys,math,json,struct,hashlib
HERE=Path(__file__).resolve().parent
FAMILY=HERE.parent
ROOT=FAMILY.parents[2]
sys.path[:0]=[str(HERE),str(FAMILY),str(FAMILY.parent)]
import model_kit as kit
import bpy,bmesh
from mathutils import Vector
from build_decor import lathe,loop
from shape_kit import rounded_rect
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
WORK=HERE/'work';EVIDENCE=HERE/'evidence'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews';kit.WORK_DIR=WORK
P={}

def palette():
 def mat(name,color,channel,rough=.6,metal=0):
  m=kit.matp(name,color,rough,metal);m['finishChannel']=channel;return m
 materials=dict(wood=mat('Mansion walnut','#493025','wood',.42),trim=mat('Carved walnut moulding','#704b32','wood',.45),
  metal=mat('Antique brass hardware','#b29455','metal',.32,.72),iron=mat('Cast iron fittings','#343b3b','iron',.58,.65),
  stone=mat('Warm limestone worktop','#b8ad96','stone',.87),ceramic=mat('Ivory glazed ceramic','#ddd5bd','ceramic',.29),
  glass=mat('Pale display glass','#8eaaa8','glass',.24,.25))
 materials['glass'].node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.25
 materials['glass'].surface_render_method='DITHERED'
 return materials

def box(name,c,s,m='wood',r=.003):
 return kit.box(name,[c[i]-s[i]/2 for i in range(3)],[c[i]+s[i]/2 for i in range(3)],P[m],min(r,min(s)/3),1)

def normals(ob):
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();return ob

def shell(name,rings,m='wood'):
 return normals(kit.shell(name,rings,[P[m]],[0]*(len(rings)-1)))

def slab(name,w,d,z0,z1,m='stone',cx=0,cy=0,r=.024):
 e=min(.004,(z1-z0)/4,r/3)
 return shell(name,[rounded_rect(cx,cy,w-2*e,d-2*e,r-e,z0,2),rounded_rect(cx,cy,w,d,r,z0+e,2),
  rounded_rect(cx,cy,w,d,r,z1-e,2),rounded_rect(cx,cy,w-2*e,d-2*e,r-e,z1,2)],m)

def rod(name,a,b,r=.01,m='metal',sides=12):
 a,b=Vector(a),Vector(b);ob=kit.cylinder(name,(0,0,0),r,(b-a).length,P[m],'Z',sides)
 ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();ob.location=(a+b)/2
 return ob

def sweep(name,points,r=.018,m='metal',sides=10):
 # A welded closed curved tube, with real end caps and no duplicate poles.
 pts=[Vector(p) for p in points];rings=[]
 for i,p in enumerate(pts):
  t=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();u=t.cross(Vector((1,0,0)))
  if u.length<.01:u=t.cross(Vector((0,1,0)))
  u.normalize();v=t.cross(u).normalized()
  rings.append([tuple(p+r*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides))) for j in range(sides)])
 return shell(name,rings,m)

def frame(name,x,cy,z,w,h):
 # A full ring with real inner reveal, no paper-thin decorative decal.
 outer=[(x-w/2,z-h/2),(x+w/2,z-h/2),(x+w/2,z+h/2),(x-w/2,z+h/2)]
 inner=[(x-w/2+.027,z-h/2+.027),(x+w/2-.027,z-h/2+.027),(x+w/2-.027,z+h/2-.027),(x-w/2+.027,z+h/2-.027)]
 verts=[(a,y,b) for y in [cy-.010,cy+.010] for outline in [outer,inner] for a,b in outline]
 faces=[]
 for i in range(4):
  j=(i+1)%4;faces += [(i,j,4+j,4+i),(8+i,12+i,12+j,8+j),(i,8+i,8+j,j),(4+i,4+j,12+j,12+i)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(P['trim'])
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);normals(ob);kit.bevel(ob,.003,1);return ob

def handle(x,cy,z,wide=.12):
 for dx in [-wide/2,wide/2]:
  rod('Brass handle mount',(x+dx,cy+.020,z),(x+dx,cy,z),.008)
 sweep('Curved brass drawer pull',[(x-wide/2,cy,z),(x-wide/2+.02,cy-.018,z+.012),
  (x+wide/2-.02,cy-.018,z+.012),(x+wide/2,cy,z)],.007,sides=8)

def panel(name,x,cy,z,w,h,pulls=True):
 box(name,(x,cy,z),(w,.025,h),'wood',.005)
 # A shallow laminated rear shoulder seats the front against its cabinet rails.
 box(name+' rear joinery shoulder',(x,cy+.024,z),(w+.010,.030,h),'wood',.001)
 frame(name+' raised frame',x,cy-.018,z,w-.008,h-.008)
 if pulls:handle(x,cy-.027,z,min(.14,w*.40))

def base_body(w,d=.65,h=.85,top=True):
 slab('Recessed toe plinth',w-.07,d-.095,0,.118,'trim',cy=.016,r=.015)
 box('Carcass back',(0,d/2-.045,(h+.12)/2), (w-.058,.028,h-.14))
 for x in [-w/2+.035,w/2-.035]:box('Cabinet side',(x,.024,(h+.10)/2),(.036,d-.095,h-.12))
 for z in ([.127,h-.047] if top else [.127]):box('Cabinet support deck',(0,.025,z),(w-.07,d-.10,.028))
 for x in [-w/2+.034,w/2-.034]:
  box('Fluted front pilaster',(x,-d/2+.062,(h+.12)/2),(.044,.040,h-.15),'trim',.005)
  for z in [.164,h-.083]:box('Brass pilaster collar',(x,-d/2+.039,z),(.048,.006,.013),'metal',.001)
 if top:slab('Rounded continuous worktop',w,d,h-.031,h)

def drawer_base(w=.75,tiers=4):
 base_body(w)
 heights={3:[.20,.255,.255],4:[.14,.19,.19,.19]}[tiers]
 z=.814
 for i,h in enumerate(heights):
  z-=h;panel('Graduated drawer '+str(i+1),0,-.269,z+h/2,w-.110,h-.010);z-=.007

def door_base(w=.9,doors=2,drawer=False):
 base_body(w);z=.443 if drawer else .466;dh=.515 if drawer else .655
 for i in range(doors):
  x=(i+.5)*((w-.10)/doors)-(w-.10)/2;panel('Cupboard framed door '+str(i+1),x,-.269,z,(w-.10)/doors-.012,dh)
 if drawer:panel('Top cutlery drawer',0,-.269,.742,w-.11,.127)

def basin(w=.65,d=.4,z=.82,cx=0,cy=-.025):
 e=.018
 rings=[rounded_rect(cx,cy,w-.065,d-.065,.070,z-.19,3),
  rounded_rect(cx,cy,w-.015,d-.015,.086,z-.13,3),rounded_rect(cx,cy,w,d,.093,z+.028,3),
  rounded_rect(cx,cy,w-e*2,d-e*2,.075,z+.033,3),rounded_rect(cx,cy,w-e*2,d-e*2,.075,z+.015,3),
  rounded_rect(cx,cy,w-.09,d-.09,.055,z-.14,3),rounded_rect(cx,cy,w-.13,d-.13,.040,z-.151,3)]
 ob=shell('Continuous glazed bowl with rolled rim',rings,'ceramic')
 lathe('Brass basin drain',[(.012,z-.154),(.025,z-.149),(.025,z-.145),(.017,z-.141)],P['metal'],cx,cy,16)
 return ob

def tap(cx=0,y=.232,top=1.16267):
 # Exact top envelope; arch tube attached to pedestal and cross handles.
 lathe('Tap mounting flange',[(.030,.842),(.035,.845),(.035,.855),(.025,.858)],P['metal'],cx,y,16)
 bottom=.852;rod('Tap pedestal',(cx,y,bottom),(cx,y,.925),.025)
 pts=[(cx,y,.902),(cx,y,1.02),(cx,y,1.09),(cx,y-.016,top-.028),
  (cx,y-.050,top-.018),(cx,y-.092,top-.040),(cx,y-.136,1.083),(cx,y-.150,1.060)]
 sweep('Swept swan-neck scullery tap',pts,.018,sides=12)
 rod('Tap outlet collar',(cx,y-.150,1.058),(cx,y-.15,1.027),.022)
 rod('Valve manifold',(cx-.102,y,.893),(cx+.102,y,.893),.014)
 for dx in [-.102,.102]:
  rod('Valve stem',(cx+dx,y,.88),(cx+dx,y,.936),.014)
  rod('Cross tap handle',(cx+dx-.032,y,.936),(cx+dx+.032,y,.936),.007)
  rod('Cross tap handle',(cx+dx,y-.025,.936),(cx+dx,y+.025,.936),.007)

def sink_base(w=.9,d=.65,two=False):
 base_body(w,d,top=False)
 box('Sink cabinet top face rail',(0,-d/2+.055,.802),(w-.08,.034,.034),'trim')
 box('Sink cabinet centre stile',(0,-d/2+.055,.468),(.030,.034,.655),'trim')
 panel('Scullery left cabinet door',-w*.223,-d/2+.056,.466,w*.435-.03,.655)
 panel('Scullery right cabinet door',w*.223,-d/2+.056,.466,w*.435-.03,.655)
 if two:
  hole_w=w-.24;cw=(hole_w-.04)/2
  centers=[(-(cw+.04)/2,cw),((cw+.04)/2,cw)]
 else:centers=[(0,min(.65,w-.22))]
 counter=slab('Continuous stone counter with real sink cutouts',w,d,.819,.850,r=.024)
 # Cutouts follow the rolled bowl profile and sit 15mm under its rim.
 for cx,bw in centers:
  cutter=kit.profile('Temporary rounded sink hole cutter',[(bw-.03,.37,.078,.58),(bw-.03,.37,.078,1.0)],P['stone'],cy=-.025,n=3)
  for v in cutter.data.vertices:v.co.x+=cx
  cutter.data.update();kit.activate(counter)
  mod=counter.modifiers.new('Authored rounded basin opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
  bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
  basin(bw,.40,cx=cx)
 normals(counter)
 tap()

def open_bottle_base():
 w=.3;base_body(w)
 for z in [.155,.370,.585]:box('Bottle rack horizontal shelf',(0,-.007,z),(.217,.503,.025),'trim')
 for x in [-.057,.057]:box('Bottle rack divider',(x,-.007,.478),(.016,.502,.644),'trim')

def wall_storage(w=.9,open_type='glass'):
 d=.35;h=.70
 box('Wall cabinet back',(0,.155,.35),(w-.055,.032,.640))
 for x in [-w/2+.031,w/2-.031]:box('Wall cabinet side',(x,.017,.350),(.037,.30,.64))
 for z in ([.042,.247,.452,.649] if open_type=='spice' else [.042,.33,.649]):box('Wall cabinet shelf',(0,.015,z),(w-.06,.286,.030),'trim')
 slab('Wall cabinet lower moulding',w-.025,.33,0,.042,'trim',r=.014)
 slab('Wall cabinet crown',w,d,.651,.70,'trim',r=.018)
 for x in [-w*.37,w*.37]:box('Rear wall mounting plate',(x,.171,.573),(.044,.008,.07),'metal',.001)
 if open_type=='glass':
  for x in [-w*.236,w*.236]:
   dw=w/2-.070;frame('Display glazed door surround',x,-.119,.348,dw,.58)
   box('Glass door pane',(x,-.117,.348),(dw-.055,.007,.515),'glass',0)
   handle(x,-.143,.35,.075)
 elif open_type=='spice':
  for z in [.057,.262,.467]:
   for k in range(4):
    x=(k-1.5)*(w-.115)/4
    lathe('Spice jar',[(.028,z),(.035,z+.012),(.035,z+.114),(.025,z+.129)],P['ceramic'],x,-.036,12)
    lathe('Spice jar brass lid',[(.029,z+.129),(.032,z+.135),(.032,z+.149),(.028,z+.154)],P['metal'],x,-.036,12)
 elif open_type=='plates':
  for x in [-w/2+.08+i*(w-.16)/8 for i in range(9)]:
   rod('Supported plate divider',(x,-.10,.09),(x,-.10,.435),.007,'wood',8)
  for z in [.104,.308]:
   rod('Plate retaining rail',(-w/2+.060,-.146,z),(w/2-.06,-.146,z),.008,'metal',8)
   for x in [-w/2+.08,w/2-.08]:rod('Plate rail support bracket',(x,-.10,z),(x,-.146,z),.006,'metal',8)

def tall_storage(w=.9,h=2.1,mode='larder'):
 d=.65;base_body(w,d,.85,top=False)
 # Grounded high storage with deep upper cabinet and continuous pilasters.
 for x in [-w/2+.035,w/2-.035]:box('Tall pantry upright',(x,.017,(h+.10)/2),(.036,d-.08,h-.12))
 box('Pantry full rear panel',(0,.285,(h+.10)/2),(w-.06,.028,h-.12))
 slab('Pantry moulded cornice',w,d,h-.045,h,'trim',r=.023)
 for z in [.83,1.27,1.67,h-.07]:box('Supported pantry shelf',(0,.014,z),(w-.075,d-.10,.027),'trim')
 if mode=='larder':
  for i in range(2):
   x=(i-.5)*(w-.105)/2
   panel('Long ventilated pantry door',x,-.269,(h+.12)/2,(w-.105)/2-.012,h-.20)
   for k in range(6):box('Upper pantry ventilation slat',(x,-.286,h-.16-k*.035),((w-.105)/2-.065,.012,.012),'trim',.001)
 else:
  for z,dh in [(.456,.64),(1.41,1.155)]:panel('Pull-out pantry front',0,-.269,z,w-.11,dh)

def island(w=2.1,d=.9):
 base_body(w,d,.85)
 for x in [-.73,-.22,.28,.76]:panel('Island service drawer',x,-d/2+.056,.725,.425,.13)
 for x in [-.7,0,.7]:panel('Island cupboard door',x,-d/2+.056,.414,.615,.45)
 # Finished reverse includes inset fielding, not an unfinished flat carcass.
 for x in [-.68,0,.68]:frame('Finished island rear panel',x,d/2-.023,.48,.59,.53)
 box('Central island partition',(0,.015,.45),(.028,d-.12,.67))

def baking_hutch():
 w=1.2;d=.65;h=1.90;door_base(w,2,True)
 # Marble kneading height remains 850mm while the upper cabinet is separate.
 box('Baking dresser full back',(0,.279,1.34),(1.1,.034,1.05))
 for x in [-.535,.535]:box('Baking dresser upright',(x,.18,1.34),(.041,.26,1.04))
 for z in [1.19,1.50,1.844]:box('Baking dresser shelf',(0,.173,z),(1.09,.277,.032),'trim')
 slab('Baking dresser cornice',1.17,.39,1.85,h,'trim',cy=.126,r=.021)
 for x in [-.27,0,.27]:lathe('Glazed flour jar',[(.07,1.206),(.08,1.22),(.08,1.38),(.065,1.41)],P['ceramic'],x,.17,12)
 # The pale stone rolling slab is the base worktop, no floating accessory.

def diagonal_corner():
 # Diagonal cabinet closes a real truncated-corner footprint.
 w=.9;poly=[(-.45,-.03),(-.03,-.45),(.45,-.45),(.45,.45),(-.45,.45)]
 def prism(name,outline,z0,z1,m):
  n=len(outline);v=[(x,y,z) for z in [z0,z1] for x,y in outline];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(v,[],f);mesh.update();mesh.materials.append(P[m]);ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);normals(ob);kit.bevel(ob,.003,1);return ob
 prism('Diagonal corner toe plinth',[(x*.93,y*.93) for x,y in poly],0,.12,'trim')
 prism('Truncated corner cabinet carcass',[(x*.95,y*.95) for x,y in poly],.10,.823,'wood')
 prism('Continuous diagonally cut stone top',poly,.82,.85,'stone')
 before=set(bpy.context.scene.objects);panel('Diagonal framed corner door',0,0,.466,.51,.655)
 angle=-math.pi/4;rot=__import__('mathutils').Matrix.Rotation(angle,4,'Z')
 bpy.context.view_layer.update()
 for ob in set(bpy.context.scene.objects)-before:
  matrix=ob.matrix_world.copy()
  for v in ob.data.vertices:v.co=rot@(matrix@v.co)+Vector((-.233,-.233,0))
  ob.matrix_world=__import__('mathutils').Matrix.Identity(4);ob.data.update()

def right_l_corner():
 poly=[(-.45,-.45),(.20,-.45),(.20,-.20),(.45,-.20),(.45,.45),(-.45,.45)]
 def prism(name,poly,z0,z1,m):
  n=len(poly);mesh=bpy.data.meshes.new(name);mesh.from_pydata([(x,y,z) for z in [z0,z1] for x,y in poly],[],[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]);mesh.update();mesh.materials.append(P[m]);ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);normals(ob);kit.bevel(ob,.003,1)
 prism('Right L corner toe plinth',[(x*.93,y*.93) for x,y in poly],0,.12,'trim')
 # Separate recessed fronts leave real clearance for framed joinery.
 body=[(-.429,-.365),(.112,-.365),(.112,-.112),(.429,-.112),(.429,.429),(-.429,.429)]
 prism('Right L corner shaped carcass',body,.10,.823,'wood')
 prism('Right return L shaped stone top',poly,.82,.85,'stone')
 panel('Right L primary door',-.13,-.369,.465,.546,.668)
 panel('Right L short frontal door',.325,-.122,.465,.194,.668)
 before=set(bpy.context.scene.objects);panel('Right L inner return door',0,0,.465,.194,.668)
 rot=__import__('mathutils').Matrix.Rotation(math.pi/2,4,'Z')
 bpy.context.view_layer.update()
 for ob in set(bpy.context.scene.objects)-before:
  matrix=ob.matrix_world.copy()
  for v in ob.data.vertices:v.co=rot@(matrix@v.co)+Vector((.122,-.26,0))
  ob.matrix_world=__import__('mathutils').Matrix.Identity(4);ob.data.update()
 box('L corner return upright',(.112,-.120,.465),(.024,.024,.692),'trim')
 for x,y in [(-.403,-.382),(.403,-.137)]:box('L corner outer pilaster',(x,y,.465),(.034,.036,.692),'trim')


def bread_safe():
 w=.6;d=.45;h=1.5
 slab('Bread safe toe plinth',w-.04,d-.04,0,.115,'trim',r=.023)
 for x in [-.264,.264]:box('Bread safe side',(x,.006,.777),(.042,.378,1.352))
 box('Bread safe rear',(0,.180,.785),(.545,.03,1.32))
 for z in [.143,.550,.980,1.425]:box('Ventilated safe shelf',(0,.012,z),(.528,.355,.03),'trim')
 slab('Bread safe top cornice',w,d,1.45,h,'trim',r=.026)
 frame('Ventilated bread safe door',0,-.183,.783,.53,1.25)
 for z in [.22+i*.068 for i in range(17)]:box('Angled door ventilation louvre',(0,-.182,z),(.478,.020,.033),'trim',.003)
 handle(.18,-.199,.785,.08)

def hob_range():
 w=.75;d=.65;h=.8635
 slab('Range continuous foot',w-.07,d-.09,0,.09,'iron',r=.023)
 box('Cast iron stove body',(0,.015,.445),(w-.055,d-.075,.750),'iron',.012)
 panel('Cast iron oven door',-.122,-.267,.444,.372,.393)
 # Oven panel is iron; walnut-only frame intentionally reassigned.
 for ob in list(bpy.context.scene.objects):
  if ob.type=='MESH' and ob.name.startswith('Cast iron oven door'):
   for i in range(len(ob.data.materials)):ob.data.materials[i]=P['iron']
 box('Narrow ash door',(.242,-.269,.434),(.16,.03,.37),'iron',.007);handle(.24,-.29,.46,.07)
 slab('Enamelled range hob',w,d,h-.055,h,'iron',r=.028)
 for x,y,r in [(-.185,-.12,.102),(.185,-.12,.084),(0,.14,.130)]:
  loop('Distinct cast iron hob ring',(x,y,h-.008),r,r,.006,P['metal'],steps=20)
 for x in [-.25,0,.25]:kit.cylinder('Oven dial',(x,-.280,.733),.027,.02,P['metal'],'Y',16)

def draining_stand():
 w=.9;d=.65
 for x in [-.38,.38]:
  for y in [-.25,.25]:lathe('Scullery trestle leg',[(.024,0),(.026,.05),(.019,.55),(.035,.80)],P['wood'],x,y,12)
 box('Draining stand low shelf',(0,0,.20),(.82,.56,.035),'trim')
 # Slatted upper board: visible drainage gaps rather than closed solid slab.
 for k in range(13):
  x=-.417+k*.0695;box('Slatted draining board',(x,0,.87),(.066,d,.06),'stone',.008)
 for y in [-.275,.275]:box('Drainer supporting rail',(0,y,.811),(.86,.034,.06),'trim')
 # Top boundary 900 mm; outside width900 set by supported end mouldings.
 for x in [-.443,.443]:box('Draining board end cap',(x,0,.87),(.014,d,.06),'stone',.003)


PROTOTYPES=[
 dict(slug='scullery-sink-900',name='白陶器ボウルのスカラリー流し台 900',size=(900,650,1162.67),fn=lambda:sink_base(.9),kind='kitchen-sink',channels=['wood','metal','stone','ceramic'],note='900mm single-bowl scullery sink with a 850mm worktop and connected 1162.67mm swan-neck tap. Static basin and tap, no water simulation. Intended footprint matches the standard 900mm sink module; source geometry unavailable here.'),
 dict(slug='kitchen-four-drawer-750',name='四段引出しの石天板キッチン台 750',size=(750,650,850),fn=lambda:drawer_base(.75,4),kind='kitchen-storage',channels=['wood','metal','stone'],note='Four graduated drawers, 850mm worktop, 750x650mm floor module. Drawers are fixed geometry. A genuinely different four-tier arrangement from the existing 450mm three-drawer cabinet.'),
 dict(slug='kitchen-bottle-rack-300',name='九区画のボトル収納キッチン台 300',size=(300,650,850),fn=open_bottle_base,kind='kitchen-storage',channels=['wood','metal','stone'],note='Narrow open nine-cell bottle storage base with supported shelves and 850mm stone worktop. Fixed storage, no animation.'),
]

ADDITIONS=[
 dict(slug='kitchen-l-corner-right-900',name='右返しL字天板のコーナーキッチン戸棚 900',size=(900,900,850),fn=right_l_corner,kind='kitchen-storage',channels=['wood','metal','stone'],note='True right-return L-shaped 900x900mm corner footprint with a 250mm open notch and three cabinet fronts on two orientations. 850mm worktop. Fixed geometry; no opening-door mechanism. Paired orientation alternative to existing left-return corner.'),
 dict(slug='kitchen-three-drawer-600',name='三段引出しの石天板キッチン台 600',size=(600, 650, 850),fn=lambda:drawer_base(.6,3),kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-three-drawer-900',name='幅広三段引出しのキッチン台 900',size=(900, 650, 850),fn=lambda:drawer_base(.9,3),kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-single-door-300',name='片開きの細幅キッチン戸棚 300',size=(300, 650, 850),fn=lambda:door_base(.3,1),kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-cutlery-cupboard-750',name='カトラリー引出し付き戸棚 750',size=(750, 650, 850),fn=lambda:door_base(.75,2,True),kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-double-door-900',name='両開きの石天板キッチン戸棚 900',size=(900, 650, 850),fn=lambda:door_base(.9,2),kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='scullery-double-sink-1200',name='双ボウルのスカラリー流し台 1200',size=(1200, 650, 1162.67),fn=lambda:sink_base(1.2,two=True),kind='kitchen-sink',channels=['wood', 'metal', 'stone', 'ceramic'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='scullery-double-sink-1800',name='大幅双ボウルの使用人室流し台 1800',size=(1800, 650, 1162.67),fn=lambda:sink_base(1.8,two=True),kind='kitchen-sink',channels=['wood', 'metal', 'stone', 'ceramic'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-glazed-wall-900',name='ガラス扉の壁付食器戸棚 900',size=(900, 350, 700),fn=lambda:wall_storage(.9,'glass'),kind='kitchen-storage',channels=['wood', 'metal', 'glass'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed. Wall installation required; bottom default 1400mm, rear mounting plates must be aligned manually.'),
 dict(slug='kitchen-spice-wall-450',name='四列スパイス瓶の壁付戸棚 450',size=(450, 350, 700),fn=lambda:wall_storage(.45,'spice'),kind='kitchen-storage',channels=['wood', 'metal', 'ceramic'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed. Wall installation required; bottom default 1400mm, rear mounting plates must be aligned manually.'),
 dict(slug='kitchen-plate-rack-900',name='九仕切りの壁付皿立て 900',size=(900, 350, 700),fn=lambda:wall_storage(.9,'plates'),kind='kitchen-storage',channels=['wood', 'metal'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed. Wall installation required; bottom default 1400mm, rear mounting plates must be aligned manually.'),
 dict(slug='kitchen-tall-larder-900',name='通気扉の高い食料庫 900',size=(900, 650, 2100),fn=lambda:tall_storage(.9),kind='kitchen-storage',channels=['wood', 'metal'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-pull-pantry-450',name='細幅上下収納のパントリー 450',size=(450, 650, 2100),fn=lambda:tall_storage(.45,mode='pull'),kind='kitchen-storage',channels=['wood', 'metal'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-service-island-2100',name='両面化粧の使用人室アイランド 2100',size=(2100, 900, 850),fn=island,kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-baking-dresser-1200',name='粉壺棚付きの製パン作業台 1200',size=(1200, 650, 1900),fn=baking_hutch,kind='kitchen-storage',channels=['wood', 'metal', 'stone', 'ceramic'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-diagonal-corner-900',name='斜め扉のコーナーキッチン戸棚 900',size=(900, 900, 850),fn=diagonal_corner,kind='kitchen-storage',channels=['wood', 'metal', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-bread-safe-600',name='ルーバー扉のパン保管棚 600',size=(600, 450, 1500),fn=bread_safe,kind='kitchen-storage',channels=['wood', 'metal'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-cast-iron-range-750',name='三口の鋳鉄キッチンレンジ 750',size=(750, 650, 863.5),fn=hob_range,kind='cooktop',channels=['metal','iron'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
 dict(slug='kitchen-draining-stand-900',name='すのこ天板の食器水切り台 900',size=(900, 650, 900),fn=draining_stand,kind='kitchen-storage',channels=['wood', 'stone'],note='Original fixed period-adapted furniture; intended dimensions authored directly. Cabinet fronts, drawer fronts, appliances and fixtures are static geometry. No mechanical or water simulation is claimed.'),
]

def clear_authoring():
 for sc in list(bpy.data.scenes):
  if sc.name.startswith('Native authoring parts'):
   for ob in list(sc.objects):bpy.data.objects.remove(ob,do_unlink=True)
   bpy.data.scenes.remove(sc)

def build(spec):
 global P
 clear_authoring();kit.clear_scene();P=palette();spec['fn']();bpy.context.view_layer.update()
 objects=[ob for ob in bpy.context.scene.objects if ob.type=='MESH']
 # Put pivots on the whole final footprint centre without stretching geometry.
 pts=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices];lo=[min(v[i] for v in pts) for i in range(3)];hi=[max(v[i] for v in pts) for i in range(3)]
 shift=Vector((-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]))
 for ob in objects:
  matrix=ob.matrix_world.copy()
  for v in ob.data.vertices:v.co=matrix@v.co+shift
  ob.matrix_world.identity();ob.data.update()
 author=bpy.data.scenes.new('Native authoring parts');author.unit_settings.system='METRIC';author.unit_settings.scale_length=1
 author['provenance']='Original measured procedural geometry; no imported assets';author['builder']='tools/blender/rpg_mansion/scaled_kitchen/build.py'
 comps=[]
 for ob in objects:
  copy=ob.copy();copy.data=ob.data.copy();author.collection.objects.link(copy)
  points=[copy.matrix_world@v.co for v in copy.data.vertices]
  comps.append(dict(name=copy.name,triangles=kit.tri_count(copy),bounds_m=[[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]))
 export_scene=bpy.context.scene
 bpy.context.window.scene=author
 from native_uv import planar_face_atlas
 for part in [o for o in author.objects if o.type=='MESH']:planar_face_atlas(part)
 bpy.context.window.scene=export_scene
 for part in author.objects:part.select_set(False,view_layer=author.view_layers[0])
 WORK.mkdir(parents=True,exist_ok=True);(WORK/(spec['slug']+'-components.json')).write_text(json.dumps(comps,indent=2)+'\n')
 obj=kit.combine(objects);obj['authorship']='Original measured native Blender kitchen furniture';obj['builder']=author['builder'];
 if spec['kind']=='kitchen-sink' or spec['size'][2]==850 or spec['slug']=='kitchen-baking-dresser-1200':obj['counterTopMm']=850
 bpy.context.scene.name='Validated export';bpy.context.scene.render.filepath='//renders/preview.png';author.render.filepath='//renders/authoring.png';return obj

def annotate(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);j['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original native procedural Blender geometry; no imported geometry, imagery or paid generation',source='tools/blender/rpg_mansion/scaled_kitchen/build.py')
 raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)

def studio(obj,path,rear=False):
 import exterior_build
 scene=exterior_build._icon_scene(obj,768);scene.cycles.samples=48;scene.cycles.use_denoising=False
 target=Vector((0,0,obj.dimensions.z*.48));w,d,h=obj.dimensions
 for name,loc,power in [('Front softbox',(-2,-3,4),600),('Fill',(3,-1,3),350),('Rear rim',(0,3,4),500)]:
  bpy.ops.object.light_add(type='AREA',location=loc);ob=bpy.context.object;ob.name=name;ob.data.energy=power;ob.data.size=3;ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
 side=-1 if rear else 1;bpy.ops.object.camera_add(location=(.18*w*side,-max(w,d,h)*3*side,h*.82));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=max(w,h)*1.28;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam;scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path)

def main():
 from render_config import configure
 configure();WORK.mkdir(parents=True,exist_ok=True);EVIDENCE.mkdir(parents=True,exist_ok=True)
 for p in [kit.GLB_DIR,kit.PREVIEW_DIR]:p.mkdir(parents=True,exist_ok=True)
 only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None;items={}
 descriptor_path=HERE/'descriptors.json'
 if descriptor_path.exists():items={it['id']:it for it in json.loads(descriptor_path.read_text())['items']}
 for spec in PROTOTYPES+ADDITIONS:
  if only and spec['slug'] not in only:continue
  stem='rpg-mansion-'+spec['slug']+'-01';obj=kit.run([(stem,spec['size'],lambda:build(spec),set(spec['channels']),6000)],do_icons='--no-icons' not in sys.argv)[0]
  path=kit.GLB_DIR/(stem+'.glb');annotate(path)
  if '--no-icons' not in sys.argv:
   for im in [kit.PREVIEW_DIR/(stem+'-thumb.png'),kit.PREVIEW_DIR/(stem+'-top.png'),WORK/(stem+'-rear.png')]:strip_metadata(im)
   obj.rotation_euler.z=0;studio(obj,EVIDENCE/(stem+'-front.png'));studio(obj,EVIDENCE/(stem+'-rear.png'),True)
  rel=lambda p:str(p.relative_to(ROOT));desc=dict(id=stem,name=spec['name'],group='住設',category='キッチン',kind=spec['kind'],model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),w=spec['size'][0],d=spec['size'][1],h=spec['size'][2],provenance='original',assetSet='rpg-mansion',previewVersion=1,finishChannels=[dict(key=k,label={'wood':'木部','metal':'金属','stone':'石材','ceramic':'陶器','glass':'ガラス','iron':'鋳鉄'}[k],default={'wood':'#493025','metal':'#b29455','stone':'#b8ad96','ceramic':'#ddd5bd','glass':'#8eaaa8','iron':'#343b3b'}[k]) for k in spec['channels']],sourceBlend=rel(WORK/(stem+'.blend')),validation=rel(WORK/(stem+'-validation.json')),builder=rel(HERE/'build.py'),front=rel(EVIDENCE/(stem+'-front.png')),rear=rel(EVIDENCE/(stem+'-rear.png')),placementNotes=spec['note'])
  
  if 'wall' in spec['slug'] or 'plate-rack' in spec['slug']:desc['defaultElevation']=1400
  items[stem]=desc;(HERE/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',name='RPGアセット',items=list(items.values())),ensure_ascii=False,indent=1)+'\n')
  print('SCALED_KITCHEN_COMPLETE '+stem,flush=True)
if __name__=='__main__':main()
