"""36 original functional additions; leaves the reviewed 14 geometry files untouched.
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/expansion/build.py -- --no-icons
"""
import sys,math,json,struct,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent; FAMILY=HERE.parent; ROOT=FAMILY.parents[2]
sys.path.insert(0,str(FAMILY));sys.path.insert(0,str(FAMILY.parent))
import build as old
from model_kit import bpy
from build_decor import lathe,loop,mesh_part
from shape_kit import rounded_rect
kit=old.kit
kit.WORK_DIR=HERE/'work'
P={}
def box(name,p,s,m='wood',b=.003): return old.block(name,p,s,m,b)
def radial(name,rows,m='brass',x=0,y=0,n=16): return lathe(name,rows,P[m],x,y,n)
def rod(name,a,b,r=.012,m='brass'):
 a,b=old.Vector(a),old.Vector(b);obj=kit.cylinder(name,(0,0,0),r,(b-a).length,P[m],'Z',12);obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();obj.location=(a+b)/2;return obj
def feet(w,d,z=.2):
 for x in [-w/2+.07,w/2-.07]:
  for y in [-d/2+.07,d/2-.07]:old.leg(x,y,z)
def panel(name,x,y,z,w,h,m='wood'):
 box(name,(x,y,z),(w,.024,h),m)
 # One closed frame rather than intersecting bevelled rails: no coplanar corner faces.
 verts=[]
 for depth in [y-.0265,y-.0095]:
  for rw,rh in [(w-.024,h-.024),(w-.076,h-.076)]:
   verts.extend([(x-rw/2,depth,z-rh/2),(x+rw/2,depth,z-rh/2),(x+rw/2,depth,z+rh/2),(x-rw/2,depth,z+rh/2)])
 faces=[]
 for i in range(4):
  j=(i+1)%4
  faces.extend([(i,j,4+j,4+i),(8+i,12+i,12+j,8+j),(i,8+i,8+j,j),(4+i,4+j,12+j,12+i)])
 obj=mesh_part('Raised moulding',verts,faces,P['trim'])
 import bmesh
 bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
 kit.bevel(obj,.003,1)
def knob(x,y,z):
 kit.cylinder('Brass knob',(x,y,z),.016,.035,P['brass'],'Y',12)
 # Head front stays fixed. The narrow neck bridges the panel/cistern setback.
 kit.cylinder('Knob mounting stem',(x,y+.0275,z),.008,.040,P['brass'],'Y',12)
def cabinet(w=1,d=.45,h=1,doors=2,drawers=0):
 feet(w,d,.16);box('Carcass',(0,.015,(h-.05+.16)/2),(w-.07,d-.05,h-.05-.16))
 box('Moulded cap',(0,0,h-.025),(w,d,.05),'trim');box('Plinth',(0,0,.17),(w,d,.065),'trim')
 if drawers:
  for i in range(drawers):
   z=.24+(h-.30)*(i+.5)/drawers;panel('Drawer front',0,-d/2-.003,z,w-.10,(h-.30)/drawers-.012)
   for x in [-w*.23,w*.23]:knob(x,-d/2-.05,z)
 else:
  for i in range(doors):
   x=w*((i+.5)/doors-.5);panel('Framed door',x,-d/2-.003,(h+.19)/2,w/doors-.038,h-.26);knob(x+w/doors*.29,-d/2-.05,(h+.19)/2)
def seat(kind):
 w={'wing-chair':.85,'sofa':2.05,'chaise':1.8,'bench':1.3,'stool':.45}[kind];d=.85 if kind not in ['bench','stool'] else .45
 feet(w,d,.30);box('Seat rail',(0,0,.33),(w-.07,d-.08,.12),'trim',.012)
 box('Upholstered cushion',(0,-.015,.46),(w-.11,d-.06,.16),'cloth',.025)
 if kind not in ['bench','stool']:
  box('Upholstered back',(0,d/2-.08,.78 if kind!='chaise' else .61),(w-.12,.19,.68 if kind!='chaise' else .34),'cloth',.04)
  for x in [-w/2+.055,w/2-.055]:
   box('Rolled arm',(x,-.01,.66),(.15,d-.08,.23),'cloth',.04)
   box('Arm carved support',(x,.0,.5),(.06,d-.09,.13),'trim')
  for x in [-w*.3,0,w*.3]:knob(x,d/2-.187,.65 if kind=='chaise' else .79)
 if kind=='wing-chair':
  for x in [-.34,.34]:box('High wing',(x,.14,.93),(.13,.29,.49),'cloth',.035)
 if kind=='chaise':box('Raised chaise head',(-.76,-.01,.81),(.18,.72,.34),'cloth',.05)
 if kind=='bench':
  for x in [-.60,.60]:box('Bench end scroll',(x,0,.59),(.11,.44,.24),'trim',.025)
def table(kind):
 if kind=='round-table':
  radial('Pedestal',[(.35,0),(.38,.04),(.23,.08),(.11,.16),(.10,.60),(.22,.705)],'wood',n=24)
  radial('Circular top',[(.61,.70),(.65,.725),(.65,.77),(.61,.78)],'trim',n=32)
  radial('Top inset',[(.56,.78),(.56,.784)],'wood',n=32);return
 w,d,h={'dining-table':(2,.95,.78),'coffee-table':(1.1,.6,.45),'console':(1.2,.36,.86),'worktable':(1.5,.70,.86)}[kind]
 feet(w,d,h-.08);box('Apron',(0,0,h-.15),(w-.13,d-.13,.18))
 box('Top edge',(0,0,h-.026),(w,d,.052),'trim',.008);box('Inset top',(0,0,h+.003),(w-.08,d-.08,.006),'wood')
 if kind=='worktable':box('Lower working shelf',(0,0,.2),(w-.13,d-.13,.045),'trim')
 if kind=='console':
  panel('Single drawer',0,-d/2-.005,h-.14,w-.19,.14);knob(0,-d/2-.044,h-.14)
def secretary():
 cabinet(.95,.50,.92,drawers=3)
 box('Writing board',(0,-.16,.945),(1,.70,.055),'trim');box('Writing leather',(0,-.18,.978),(.84,.54,.01),'teal')
 box('Pigeonhole back',(0,.21,1.17),(.92,.03,.43));box('Pigeonhole top',(0,.06,1.39),(.96,.35,.04),'trim')
 for x in [-.45,-.15,.15,.45]:box('Letter divider',(x,.08,1.17),(.025,.30,.40))
 box('Letter shelf',(0,.08,1.13),(.92,.30,.025),'trim')
def bed(canopy=False):
 w=1.6 if canopy else 1.0;d=2.12
 feet(w,d,.30);box('Bed frame',(0,0,.35),(w,d,.20),'wood',.012)
 box('Mattress',(0,-.02,.52),(w-.07,d-.14,.22),'paper',.025)
 box('Folded cover',(0,-.31,.65),(w-.055,1.36,.06),'cloth',.014)
 for x in ([-.37,.37] if canopy else [0]):box('Pillow',(x,.70,.68),(.65,.40,.14),'paper',.035)
 panel('Headboard',0,.99,.92,w-.06,.95)
 panel('Footboard',0,-1.02,.50,w-.06,.50)
 if canopy:
  for x in [-w/2,w/2]:
   for y in [-1.04,1.04]:radial('Canopy post',[(.045,0),(.055,.08),(.035,.4),(.04,1.7),(.065,2.02),(.035,2.2)],'wood',x,y)
  for x in [-w/2,w/2]:box('Canopy side rail',(x,0,2.08),(.09,2.18,.14),'trim')
  for y in [-1.04,1.04]:box('Canopy end rail',(0,y,2.08),(w,.09,.14),'trim')
def hutch():
 cabinet(1.35,.50,.86,doors=3)
 box('Hutch back',(0,.2,1.40),(1.29,.04,1.08))
 for x in [-.64,.64]:box('Hutch upright',(x,.06,1.42),(.055,.32,1.15))
 for z in [.96,1.35,1.78,1.99]:box('Hutch shelf',(0,.06,z),(1.36,.36,.045),'trim')
 for x in [-.4,0,.4]:radial('Plate stack',[(.11,1.3725),(.11,1.3875),(.10,1.4025),(.11,1.4175),(.11,1.4325)],'ceramic',x,.035)
 for x in [-.43,.43]:radial('Pantry jar',[(.085,1.8025),(.085,1.9325),(.062,1.9725)],'ceramic',x,.06)
def vessel(name,w,d,h,z=0,m='ceramic'):
 rings=[rounded_rect(0,0,w*.8,d*.8,min(w,d)*.26,z,4),rounded_rect(0,0,w,d,min(w,d)*.30,z+h,4),rounded_rect(0,0,w-.06,d-.06,min(w,d)*.28,z+h+.002,4),rounded_rect(0,0,w*.68,d*.66,min(w,d)*.22,z+.06,4)]
 from model_kit import shell
 return shell(name,rings,[P[m]],[0,0,0])
def faucet(x=0,y=.21,z=.8):
 rod('Tap upright',(x,y,z),(x,y,z+.28),.022)
 rod('Tap spout',(x,y,z+.28),(x,y-.16,z+.28),.022)
 rod('Tap outlet',(x,y-.16,z+.28),(x,y-.16,z+.24),.022)
 # A continuous manifold and valve stems physically support both cross handles.
 rod('Tap manifold',(x-.105,y,z+.025),(x+.105,y,z+.025),.016)
 for dx in [-.105,.105]:
  rod('Tap valve stem',(x+dx,y,z+.015),(x+dx,y,z+.06),.013)
  rod('Cross tap',(x+dx-.035,y,z+.06),(x+dx+.035,y,z+.06),.008)
def wet(kind):
 if kind=='bathtub':
  for x in [-.57,.57]:
   for y in [-.24,.24]:radial('Claw foot',[(.065,0),(.045,.06),(.075,.17)],'brass',x,y)
  vessel('Roll rim bath',1.72,.77,.49,.12);faucet(.51,.29,.57)
 elif kind=='toilet':
  radial('Pedestal foot',[(.17,0),(.14,.10),(.115,.26)],'ceramic',y=-.07)
  v=vessel('Porcelain bowl',.39,.55,.20,.25);v.location.y=-.08
  v=vessel('Dark open seat rim',.40,.56,.038,.445,'wood');v.location.y=-.08
  box('Cistern',(0,.24,.66),(.43,.23,.40),'ceramic',.018);box('Cistern lid',(0,.24,.87),(.46,.26,.04),'ceramic',.01);knob(.16,.10,.74)
 else:
  if kind=='butler-sink':cabinet(1.1,.62,.72,doors=2)
  else:
   radial('Washstand pedestal',[(.22,0),(.23,.045),(.10,.12),(.085,.61),(.23,.68)],'ceramic');
  vessel('Open wash basin',.88 if kind=='butler-sink' else .68,.55,.18,.68);faucet(0,.24,.86)
def range_cooker():
 feet(1,.62,.10);box('Enamel range body',(0,0,.45),(1,.62,.73),'iron',.015)
 panel('Oven door',-.18,-.325,.44,.52,.39,'iron');panel('Fuel door',.31,-.325,.46,.29,.31,'iron')
 for x in [-.19,.31]:
  rod('Oven handle',(x-.08,-.365,.58),(x+.08,-.365,.58),.012)
  for dx in [-.08,.08]:rod('Oven handle mount',(x+dx,-.365,.58),(x+dx,-.33,.58),.008)
 box('Hob slab',(0,0,.84),(1.05,.68,.05),'iron')
 for x in [-.28,.28]:
  for y in [-.16,.16]:loop('Hob ring',(x,y,.872),.11,.11,.013,P['brass'],steps=16)
 box('Splashback',(0,.31,1.02),(1.04,.035,.35),'iron');box('Brass splash trim',(0,.29,1.20),(1.07,.04,.035),'brass')
def icebox():
 cabinet(.8,.65,1.3,doors=1)
 for z in [.44,1.00]:
  panel('Icebox insulated panel',0,-.365,z,.65,.49)
  for x in [-.27,.27]:box('Icebox hinge',(x,-.389,z),(.08,.025,.045),'brass')
  knob(.19,-.41,z)
def lamp(kind):
 if kind in ['floor-lamp','table-lamp']:
  scale=1 if kind=='floor-lamp' else .39
  radial('Weighted lamp base',[(.21,0),(.23,.026),(.18,.055),(.05,.10),(.029,1.26*scale)],'brass')
  z=1.24*scale;radial('Fabric tapered shade',[(.31,z),(.19,z+.40*scale),(.18,z+.40*scale),(.30,z)],'linen',n=24)
  radial('Shade finial',[(.018,z+.40*scale),(.015,z+.45*scale)],'brass')
 elif kind=='sconce':
  box('Sconce wall plate',(0,.07,.25),(.16,.035,.46),'brass',.02)
  rod('Curved arm base',(0,.055,.17),(0,-.14,.09),.017);rod('Curved arm rise',(0,-.14,.09),(0,-.14,.27),.017)
  radial('Sconce glass',[(.075,.25),(.105,.36),(.065,.49),(.06,.49),(.10,.36),(.07,.25)],'linen',y=-.14)
 else:
  radial('Chandelier central stem',[(.07,0),(.10,.035),(.04,.09),(.027,.55),(.10,.60)],'brass')
  for i in range(6):
   a=i*math.tau/6;x,y=.37*math.cos(a),.37*math.sin(a)
   rod('Chandelier arm',(0,0,.2),(x,y,.08),.018);rod('Chandelier upturn',(x,y,.08),(x,y,.26),.018)
   radial('Candle cup',[(.05,.24),(.075,.27),(.05,.30)],'brass',x,y);radial('Candle',[(.025,.30),(.025,.48)],'wax',x,y)
def mirror():
 box('Mirror backing',(0,0,.75),(.75,.055,1.5),'wood')
 box('Reflective metal glass',(0,-.034,.75),(.65,.007,1.39),'mirror',0)
 for x in [-.35,.35]:box('Moulded gilt sides',(x,-.025,.75),(.065,.075,1.52),'brass',.01)
 for z in [.027,1.47]:box('Moulded gilt ends',(0,-.025,z),(.74,.075,.065),'brass',.01)
def curtains():
 rod('Curtain pole',(-1.05,0,2.34),(1.05,0,2.34),.025)
 for sign in [-1,1]:
  for i in range(8):
   x=sign*(.48+i*.065);box('Deep curtain fold',(x,-.035 if i%2 else .025,1.13),(.082,.105,2.20),'cloth',.022)
  box('Tieback',(sign*.715,-.103,1.1),(.45,.049,.055),'brass',.012)
 box('Pelmet',(0,-.04,2.22),(2.0,.17,.23),'cloth',.018)
def coatstand():
 radial('Coat tree foot',[(.27,0),(.28,.035),(.11,.085),(.04,.16),(.033,1.72),(.07,1.78)],'wood')
 for i in range(6):
  a=i*math.tau/6;x,y=.27*math.cos(a),.27*math.sin(a);rod('Coat hook',(0,0,1.43),(x,y,1.66),.021,'wood');radial('Hook ball',[(.027,1.65),(.035,1.685),(.02,1.72)],'brass',x,y)
def umbrella():
 radial('Umbrella stand',[(.17,0),(.18,.03),(.15,.07),(.15,.46),(.17,.48),(.145,.48),(.13,.08)],'brass')
 for x in [-.05,.06]:
  rod('Umbrella folded',(x,0,.09),(x,.06,.74),.034,'cloth');rod('Umbrella handle',(x,.06,.74),(x,.06,.91),.012,'wood');loop('Handle crook',(x,.06,.91),.036,.036,.01,P['wood'],vertical=True)
def planter():
 radial('Fluted conservatory urn',[(.19,0),(.20,.045),(.10,.09),(.11,.18),(.24,.35),(.26,.48),(.22,.49),(.19,.25)],'ceramic',n=20)
 radial('Soil',[(.20,.39),(.20,.42)],'soil')
 for i in range(9):
  a=i*math.tau/9;tip=(.38*math.cos(a),.38*math.sin(a),.9+.15*(i%3));rod('Plant stem',(0,0,.4),tip,.008,'leaf')
  # Thick closed diamond leaves, no external alpha textures.
  x,y,z=tip;mesh_part('Laurel leaf',[(x,y,z+.15),(x+.095,y,z),(x,y-.018,z-.06),(x-.095,y,z),(x,y+.018,z-.06)],[(2,1,0),(3,2,0),(4,3,0),(1,4,0),(2,3,4,1)],P['leaf'])
def fireplace():
 for x in [-.58,.58]:
  box('Stone pilaster',(x,0,.56),(.22,.33,1.12),'stone',.01);panel('Pilaster inset',x,-.174,.59,.16,.80,'stone')
 box('Mantel',(0,0,1.15),(1.52,.48,.11),'stone',.016);box('Lintel',(0,0,.99),(1.25,.34,.19),'stone')
 box('Hearth',(0,-.06,.04),(1.55,.60,.08),'stone');box('Dark fireback',(0,.14,.49),(.93,.035,.84),'iron')
 for x in [-.32,-.16,0,.16,.32]:rod('Grate upright',(x,-.18,.12),(x,-.18,.37),.012,'iron')
 rod('Grate crossbar',(-.38,-.18,.2),(.38,-.18,.2),.018,'iron')
 for x in [-.18,.16]:rod('Cold log',(x,-.06,.13),(x+.08,.09,.19),.056,'wood')
def radiator():
 for x in [-.45,.45]:box('Radiator foot',(x,0,.06),(.08,.28,.12),'iron')
 for i in range(10):
  x=-.45+i*.10;box('Cast iron radiator section',(x,0,.38),(.065,.18,.65),'iron',.025)
 for z in [.16,.58]:rod('Radiator manifold',(-.5,0,z),(.5,0,z),.038,'iron')
 rod('Valve',(.51,0,.55),(.59,0,.55),.018);radial('Valve wheel',[(.04,.56),(.04,.59)],'brass',.56,0)
def armour():
 box('Armour display plinth',(0,0,.045),(.72,.60,.09),'wood')
 for x in [-.15,.15]:
  box('Sabatons',(x,-.10,.16),(.21,.38,.14),'steel',.035);rod('Greaves',(x,0,.2),(x,0,.66),.07,'steel');radial('Knee plate',[(.08,.64),(.105,.70),(.07,.77)],'steel',x,0)
  rod('Thigh armour',(x,0,.73),(x*.65,0,1.04),.095,'steel')
 radial('Breastplate',[(.18,1.00),(.24,1.15),(.27,1.38),(.16,1.49)],'steel',n=12)
 for sign in [-1,1]:
  radial('Pauldron',[(.11,1.30),(.15,1.40),(.08,1.48)],'steel',sign*.30,0,n=12)
  rod('Armoured arm',(sign*.31,0,1.32),(sign*.35,-.03,.90),.06,'steel')
 radial('Closed helmet',[(.13,1.49),(.17,1.59),(.15,1.78),(.07,1.87)],'steel',n=16)
 box('Visor slit',(0,-.151,1.69),(.21,.012,.022),'iron',0)
 for x in [-.07,0,.07]:box('Visor vents',(x,-.162,1.62),(.012,.012,.052),'iron',0)
 rod('Display sword',(.39,-.12,.11),(.39,-.12,1.0),.019,'steel');rod('Sword guard',(.30,-.12,.86),(.48,-.12,.86),.018)

SPECS=[
 ('wing-chair','翼付きアームチェア',(850,850,1220),lambda:seat('wing-chair'),'椅子',0),
 ('sofa','三人掛けサロンソファ',(2050,850,1120),lambda:seat('sofa'),'ソファ',0),
 ('chaise','寝椅子・シェーズロング',(1800,850,980),lambda:seat('chaise'),'ソファ',0),
 ('bench','玄関の長椅子',(1300,450,710),lambda:seat('bench'),'椅子',0),
 ('stool','布張りスツール',(450,450,540),lambda:seat('stool'),'椅子',0),
 ('dining-table','六人用食卓',(2000,950,780),lambda:table('dining-table'),'机',0),
 ('round-table','円形ペデスタル食卓',(1300,1300,780),lambda:table('round-table'),'机',0),
 ('coffee-table','低いサロンテーブル',(1100,600,450),lambda:table('coffee-table'),'机',0),
 ('console','玄関のコンソール',(1200,400,860),lambda:table('console'),'机',0),
 ('secretary','小棚付き書記机',(1000,700,1410),secretary,'机',0),
 ('worktable','調理用作業台',(1500,700,860),lambda:table('worktable'),'キッチン',0),
 ('single-bed','一人用木製ベッド',(1060,2120,1395),lambda:bed(False),'ベッド',0),
 ('canopy-bed','四柱式ダブルベッド',(1730,2210,2200),lambda:bed(True),'ベッド',0),
 ('nightstand','引出し付きベッドサイド台',(480,440,630),lambda:cabinet(.48,.40,.63,drawers=2),'収納',0),
 ('wardrobe','観音開きの洋服箪笥',(1350,670,2100),lambda:cabinet(1.35,.62,2.1),'収納',0),
 ('dresser','四段の整理箪笥',(1100,540,1000),lambda:cabinet(1.1,.49,1.0,drawers=4),'収納',0),
 ('linen-cabinet','リネン収納の細長戸棚',(750,490,1800),lambda:cabinet(.75,.44,1.8),'収納',0),
 ('kitchen-hutch','食器棚・オープンハッチ',(1360,560,2010),hutch,'キッチン',0),
 ('butler-sink','陶器の深型流し台',(1100,650,1140),lambda:wet('butler-sink'),'キッチン',0),
 ('range','鋳鉄のレンジ調理炉',(1070,710,1220),range_cooker,'キッチン',0),
 ('icebox','木製の保冷庫',(800,740,1300),icebox,'キッチン',0),
 ('bathtub','猫脚のロールリム浴槽',(1720,800,1090),lambda:wet('bathtub'),'水回り',0),
 ('toilet','タンク付きクラシック便器',(460,690,890),lambda:wet('toilet'),'水回り',0),
 ('washstand','ペデスタル洗面台',(680,570,1140),lambda:wet('washstand'),'水回り',0),
 ('floor-lamp','布シェードのフロアランプ',(620,620,1690),lambda:lamp('floor-lamp'),'照明',0),
 ('table-lamp','布シェードの卓上ランプ',(620,620,660),lambda:lamp('table-lamp'),'照明',750),
 ('sconce','真鍮の壁付け灯',(210,350,500),lambda:lamp('sconce'),'照明',1500),
 ('chandelier','六灯の燭台シャンデリア',(890,790,610),lambda:lamp('chandelier'),'照明',2100),
 ('mirror','縦長の金縁鏡',(750,100,1520),mirror,'装飾',500),
 ('curtain','タッセル付き両開きカーテン',(2150,270,2370),curtains,'窓まわり',0),
 ('coat-stand','六本フックのコート掛け',(610,610,1780),coatstand,'玄関',0),
 ('umbrella-stand','傘入りの真鍮傘立て',(360,360,955),umbrella,'玄関',0),
 ('planter','温室の月桂樹と陶器鉢',(950,800,1360),planter,'植物',0),
 ('fireplace','石造マントルピース',(1550,600,1210),fireplace,'装飾',0),
 ('radiator','鋳鉄の温水ラジエーター',(1160,280,705),radiator,'設備',0),
 ('armour','展示用の全身甲冑',(780,650,1870),armour,'探索小物',0),
]
def build_model(fn,size):
 global P
 old.P=old.palette();P=old.P
 for k,color,channel,rough,metal in [('ceramic','#e2ded0','ceramic',.26,0),('linen','#d7c69c','fabric',.85,0),('iron','#343b3b','metal',.62,.65),('mirror','#aebfc0',None,.12,.95),('steel','#7f969b','metal',.37,.8),('stone','#b8ad96','stone',.9,0),('soil','#30291f',None,1,0),('leaf','#405849','foliage',.88,0)]:
  P[k]=kit.matp('RPG '+k,color,rough,metal)
  if channel:P[k]['finishChannel']=channel
 fn();obj=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);bpy.context.view_layer.update();matrix=obj.matrix_world.copy()
 for v in obj.data.vertices:v.co=matrix@v.co
 obj.matrix_world.identity();pts=[v.co.copy() for v in obj.data.vertices];lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
 for v in obj.data.vertices:
  for i in range(3):v.co[i]=(v.co[i]-lo[i])/(hi[i]-lo[i])*size[i]/1000-(size[i]/2000 if i<2 else 0)
 obj.data.update();return obj

def main():
 from render_config import configure
 configure();manifest_path=old.PACK/'manifest.json';manifest=json.loads(manifest_path.read_text());items={i['id']:i for i in manifest['items']}
 only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
 for slug,name,size,fn,category,elev in SPECS:
  if only and slug not in only:continue
  stem='rpg-mansion-'+slug+'-01';kit.clear_scene();obj=build_model(fn,size);channels={m.get('finishChannel') for m in obj.data.materials if m.get('finishChannel')}
  obj=kit.run([(stem,size,lambda fn=fn,size=size:build_model(fn,size),channels,6000)])[0]
  from png_metadata import strip_metadata
  for image in [kit.PREVIEW_DIR/(stem+'-thumb.png'),kit.PREVIEW_DIR/(stem+'-top.png'),kit.WORK_DIR/(stem+'-rear.png')]:strip_metadata(image)
  path=kit.GLB_DIR/(stem+'.glb');b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);j['asset']['extras']={'front':'+Z','up':'+Y','units':'metres','origin':'bottom-centre','packId':'rpg-mansion','provenance':'Original procedural Blender geometry; no imported geometry or imagery','source':'tools/blender/rpg_mansion/expansion/build.py'}
  raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
  rel=lambda p:str(p.relative_to(ROOT));desc=[]
  for key in sorted(channels):
   mat=next(m for m in obj.data.materials if m.get('finishChannel')==key);rgb=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value[:3];color='#'+''.join(f'{round((12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055)*255):02x}' for x in rgb)
   desc.append({'key':key,'label':{'wood':'木部','metal':'金属','fabric':'布・革','ceramic':'陶器','stone':'石材','foliage':'葉'}[key],'default':color})
  report=kit.WORK_DIR/(stem+'-validation.json');r=json.loads(report.read_text());r['glb_bytes']=path.stat().st_size;r['glb_sha256']=hashlib.sha256(path.read_bytes()).hexdigest();report.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
  items[stem]=dict(id=stem,name=name,packId='rpg-mansion',group='家具',category=category,sourceFolder='BlenderRpgMansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),rear=rel(kit.WORK_DIR/(stem+'-rear.png')),sourceBlend=rel(kit.WORK_DIR/(stem+'.blend')),validation=rel(report),w=size[0],d=size[1],h=size[2],defaultElevation=elev,provenance='original',builder=rel(HERE/'build.py'),finishChannels=desc,placementHint='wall' if slug in ['sconce','mirror'] else 'ceiling' if slug=='chandelier' else 'surface' if elev else 'floor',previewVersion=1)
  # Resume-safe: only successful outputs become catalogue candidates.
  manifest.update(version='0.2.0',status='integrated-review',items=list(items.values()))
  manifest['provenance']['license']='Original project-authored assets for this repository; no third-party material. No separate public reuse license is granted by this manifest.'
  manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print('EXPANSION_COMPLETE '+stem,flush=True)
if __name__=='__main__':main()
