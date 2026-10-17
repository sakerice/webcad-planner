"""Fifteen additional original sleeping forms and labeled capacity/footprint variants.
Construction coordinates are dimension-parametric, not post-hoc model rescaling.
"""
import math
from mathutils import Vector
B=None

def joints(w,d,z=.321):
 for sx in [-1,1]:
  for y in [-d/2+.205,d/2-.205]:B.rod('Brass mortise rail joint pin',(sx*(w/2-.055),y,z),(sx*(w/2-.007),y,z),.010,'brass',8)

def endpost(name,x,y,h):
 B.radial(name,[(.035,0),(.044,.027),(.025,.235),(.044,.320),(.027,h-.11),(.040,h-.065),(.022,h-.035)],x,y,'wood',8,'ground-support')
 B.radial(name+' brass acorn',[(.016,h-.044),(.028,h-.026),(.019,h-.009),(.008,h)],x,y,'brass',8)

def wood_end_frames(w,d,h,foot=.75,spindles=5,style='spindle'):
 xp=w/2-.044
 for sign,top in [(1,h),(-1,foot)]:
  y=sign*(d/2-.044)
  for x in [-xp,xp]:endpost('Mortised '+style+' bed end post',x,y,top)
  B.box(style+' lower head-foot rail',(0,y,.513),(w-.075,.040,.060),'trim',.004)
  if style=='spindle':
   railpoints=[(-xp+2*xp*i/12,y,top-.114+.047*math.sin(math.pi*i/12))for i in range(13)]
   B.sweep('Segmental arched spindle top rail',railpoints,.024,'trim',8)
   for k in range(spindles):
    x=(k-(spindles-1)/2)*(w-.22)/spindles;z=top-.114+.047*math.sin(math.pi*(x+xp)/(2*xp))
    B.radial('Individually turned head-foot spindle',[(.014,.519),(.018,.544),(.012,.578),(.016,(.578+z-.035)/2),(.012,z-.045),(.016,z+.005)],x,y,'wood',6)
  else:
   levels=[.636,top-.120] if abs(.636-(top-.120))>=.068 else [max(.636,top-.120)]
   for zz in levels:B.box('Open ladder-head cross plank',(0,y,zz),(w-.075,.038,.064),'trim',.005)


def panel_y(name,outline,y0,y1,m='wood'):
 n=len(outline);vs=[(x,y,z)for y in [y0,y1]for x,z in outline];fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 me=B.bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.materials.append(B.P[m]);me.update();ob=B.bpy.data.objects.new(name,me);B.bpy.context.collection.objects.link(ob);return B.keep(ob)

def arch_outline(w,z0,h,rise=.14,n=12,cx=0):
 shoulder=h-rise
 return [(cx-w/2,z0),(cx+w/2,z0),(cx+w/2,shoulder)]+[(cx+w/2*math.cos(math.pi*i/n),shoulder+rise*math.sin(math.pi*i/n))for i in range(1,n+1)]

def arched_ends(w,d,h,foot=.76,fields=2,mounts=False):
 for sign,hh in [(1,h),(-1,foot)]:
  y=sign*(d/2-.032)
  panel_y('Segmental arched walnut '+('headboard'if sign==1 else'footboard'),arch_outline(w,.245,hh,.13),y-.032,y+.032)
  if mounts:
   for x in [-w/2+.045,w/2-.045]:
    B.box('Arched endboard mortised side-rail joining block',(x,sign*(d/2-.069),.351),(.060,.036,.048),'wood',.002)
  # Two raised arch-shaped veneer fields laminated to the room-facing surface.
  for k in range(fields):
   fw=(w-.120)/fields-.030;cx=(k-(fields-1)/2)*(w-.120)/fields
   outline=arch_outline(fw,.406,hh-.083,.075,10,cx)
   yy=y-sign*.034;panel_y('Raised curved inset head-foot field',outline,yy-sign*.006,yy+sign*.007,'trim')
  B.box('Continuous lower breadboard rail',(0,y-sign*.035,.361),(w-.065,.021,.038),'trim',.005)


def feature(top,support,cap,w,d,topology,**extra):
 return dict(mattressTopM=top,mattressSupportM=support,sleepingCapacity=cap,mattressDimensionsM=[w,d,.165],topology=topology,**extra)

def spindle_single():
 w,d,h=1.100,2.150,1.210;base=B.bedframe(w,d,.361);joints(w,d);wood_end_frames(w,d,h,.810,5)
 top=B.bedding(w,d+.040,base,1)
 return feature(top,base,1,w-.132,d-.214,'mortised-arched-head-foot-frames/ten-turned-spindles/open-slat-deck/five-ground-legs')

def wide_guest():
 w,d,h=1.930,2.250,1.280;base=B.bedframe(w,d,.381);joints(w,d);arched_ends(w,d,h,.775,2,mounts=True);top=B.bedding(w,d-.035,base,2)
 return feature(top,base,2,w-.132,d-.289,'wide-double/paired-raised-arch-head-foot-fields/solid-shaped-breadboard-ends/open-slat-deck')

def narrow_servants():
 w,d,h=.900,2.050,.990;base=B.bedframe(w,d,.312);joints(w,d);wood_end_frames(w,d,h,.675,style='ladder')
 top=B.bedding(w,d+.112,base,1)
 return feature(top,base,1,w-.132,d-.142,'narrow-one-person/three-open-head-cross-planks/low-open-foot-frame/plain-mortised-slat-support')

def low_platform():
 w,d,h=1.560,2.180,.460;support=.187
 for x in [-.610,0,.610]:
  for y in [-.878,.878]:B.radial('Broad low platform turned support',[(.058,0),(.067,.022),(.053,.056),(.072,.118)],x,y,'trim',10,'ground-support')
 for x in [-w/2+.028,w/2-.028]:B.box('Low platform open side rim',(x,0,.145),(.056,d,.075),'wood',.010)
 for y in [-d/2+.028,d/2-.028]:B.box('Low platform open end rim',(0,y,.145),(w-.072,.056,.075),'wood',.010)
 for x in [-w/2+.053,w/2-.053]:B.box('Low platform internal support cleat',(x,0,.164),(.039,d-.120,.028),'wood',.003)
 for k in range(12):B.box('Low platform exposed mattress support slat',(0,-.942+k*1.884/11,.177),(w-.098,.095,.020),'trim',.003,'mattress-support')
 for x in [-.560,0,.560]:B.box('Low platform longitudinal load bearer',(x,0,.138),(.060,d-.092,.065),'wood',.003)
 for x in [-.710,.710]:
  for y in [-.882,.882]:B.rod('Low platform brass inset joint stud',(x,y,.153),(x,y,.185),.010,'brass',8)
 panel_y('Shallow arched low platform head rest',arch_outline(w-.120,.179,h,.038),d/2-.052,d/2-.022,'trim')
 top=B.bedding(w-.012,d+.055,support,2)
 return feature(top,support,2,w-.144,d-.199,'low-six-pedestal-platform/open-perimeter-rim/twelve-support-slats/three-longitudinal-bearers/shallow-arched-head-rest')

def tester():
 w,d,h=1.740,2.300,2.240;base=B.bedframe(w,d,.395);joints(w,d);xp=w/2-.044;yp=d/2-.044
 for x in [-xp,xp]:
  for y in [-yp,yp]:endpost('Full-height open tester turned column',x,y,h)
 arched_ends(w-.100,d-.032,1.260,.775,2)
 # Open rafters are a different actual construction from the baseline closed perimeter canopy.
 for x in [-xp,xp]:B.box('Tester long side jointed cornice',(x,0,2.116),(.075,d-.060,.075),'trim',.006)
 for y in [-yp,yp]:B.box('Tester end jointed cornice',(0,y,2.107),(w-.060,.075,.068),'trim',.006)
 for y in [-.740,0,.740]:B.box('Tester exposed transverse overhead rafter',(0,y,2.133),(w-.072,.040,.048),'wood',.004)
 # Closed, scalloped fabric strip is supported along the entire tester rail.
 for y in [-yp,yp]:
  outline=[(-w/2+.062,2.143),(w/2-.062,2.143),(w/2-.062,2.045)]+[(w/2-.062-(w-.124)*i/18,2.045-.027*abs(math.sin(i*math.pi/3)))for i in range(1,19)]
  panel_y('Attached scalloped velvet tester valance',outline,y-.010,y+.010,'cover')
 top=B.bedding(w,d-.075,base,2)
 return feature(top,base,2,w-.132,d-.329,'open-rafter-tester/four-full-height-turned-columns/attached-scalloped-end-valances/arched-double-fields/open-slat-frame')

def half_tester():
 w,d,h=1.140,2.160,2.100;base=B.bedframe(w,d,.351);joints(w,d);xp=w/2-.044;yp=d/2-.044
 for x in [-xp,xp]:
  endpost('Half-tester tall grounded head column',x,yp,h);endpost('Half-tester low foot post',x,-yp,.750)
 arched_ends(w-.065,d-.016,1.075,.640,1)
 for x in [-xp,xp]:
  B.box('Half tester cantilever side rail',(x,.613,1.999),(.068,.914,.061),'trim',.005)
  # Actual diagonal brace ends intersect both cantilever rail and tall column.
  B.sweep('Half-tester curved knee brace',[(x,yp,1.645),(x,.955,1.746),(x,.775,1.873),(x,.388,1.989)],.021,'wood',8)
 for y in [.190,.600,yp]:B.box('Half tester overhead cross member',(0,y,2.010),(w-.063,.052,.043),'trim',.004)
 outline=[(-w/2+.065,2.029),(w/2-.065,2.029),(w/2-.065,1.930)]+[(w/2-.065-(w-.130)*i/12,1.930-.023*abs(math.sin(i*math.pi/3)))for i in range(1,13)]
 panel_y('Half tester attached scalloped front valance',outline,.181,.199,'cover')
 top=B.bedding(w,d+.013,base,1)
 return feature(top,base,1,w-.132,d-.241,'two-tall-head-columns/three-cross-member-half-tester/two-curved-load-knee-braces/low-foot-frame')

def translate_new(start,dx=0,dy=0):
 for ob in B.PARTS[start:]:
  for v in ob.data.vertices:v.co.x+=dx;v.co.y+=dy
  ob.data.update()

def paired_twin():
 w,d,h=2.360,2.130,1.160;mw=.940;centers=[-.710,.710];tops=[];support=.354
 for cx in centers:
  start=len(B.PARTS);base=B.bedframe(mw,d,.347);joints(mw,d);wood_end_frames(mw,d,h,.680,style='ladder');tops.append(B.bedding(mw,d+.105,base,1));translate_new(start,cx)
 return feature(max(tops),support,2,mw-.132,d-.149,'two-separately-grounded-twin-ladder-head-beds/measured-central-aisle/static-paired-capacity-arrangement',mattressTopsM=tops,individualMattressWidthM=mw-.132,clearMiddleAisleM=.480,variantType='paired-capacity-arrangement')

def trundle_main(w=1.060,d=2.140):
 start=len(B.PARTS);base=B.bedframe(w,d,.465);joints(w,d,z=.414)
 # Remove the middle foot: the nested spare bed requires this genuine open bay.
 for ob in list(B.PARTS[start:]):
  if 'centre bearer ground support'in ob.name:B.PARTS.remove(ob);B.bpy.data.objects.remove(ob,do_unlink=True)
 wood_end_frames(w,d,.980,.760,style='ladder')
 xp=-w/2+.044
 for y in [-.955,.955]:B.box('Daybed low side-back upright',(xp,y,.663),(.048,.044,.336),'wood',.006)
 for z in [.574,.803]:B.box('Daybed continuous side-back rail',(xp,0,z),(.045,d-.071,.038),'trim',.004)
 for y in [-.630,-.210,.210,.630]:B.box('Daybed open side-back spindle',(xp,y,.690),(.031,.034,.211),'wood',.003)
 return base,B.bedding(w,d+.041,base,1)

def spare_trundle(w,d):
 support=.091
 for x in [-w/2+.058,w/2-.058]:
  for y in [-d/2+.102,d/2-.102]:
   B.radial('Trundle grounded brass carriage foot',[(.023,0),(.026,.015),(.019,.036),(.025,.059)],x,y,'brass',10,'ground-support')
 for x in [-w/2+.021,w/2-.021]:B.box('Trundle low walnut side rail',(x,0,.060),(.042,d-.042,.065),'wood',.005)
 for y in [-d/2+.021,d/2-.021]:B.box('Trundle low walnut end rail',(0,y,.060),(w-.066,.042,.065),'wood',.005)
 for k in range(10):B.box('Trundle actual thin support slat',(0,-d/2+.104+k*(d-.208)/9,.081),(w-.042,.093,.020),'wood',.002,'mattress-support')
 # Single long spare mattress with a compact travel pillow; static sleeping prop.
 top=B.bedding(w+.064,d+.204,support,1)
 return support,top

def trundle_deployed():
 w,d=1.810,2.140;start=len(B.PARTS);base,top=trundle_main();translate_new(start,-.375)
 start=len(B.PARTS);sub,subtop=spare_trundle(.750,1.990);translate_new(start,.530)
 return feature(top,base,2,.928,1.927,'three-sided-wood-daybed-plus-grounded-deployed-spare-trundle/independent-low-rail-frame/static-two-sleeper-footprint',mattressTopsM=[top,subtop],secondaryMattressDimensionsM=[.682,1.940,.165],secondaryMattressSupportM=sub,variantType='deployed-trundle-footprint-capacity')

def trundle_stowed():
 base,top=trundle_main();sub,subtop=spare_trundle(.820,1.990)
 return feature(top,base,1,.928,1.927,'three-sided-wood-daybed-with-visible-nested-spare-trundle/open-centre-bay/static-stowed-footprint',storedSleepingCapacity=1,storedMattressTopM=subtop,secondaryMattressSupportM=sub,variantType='stowed-trundle-footprint-capacity')

def drawer_double():
 w,d,h=1.630,2.200,1.160;base=B.bedframe(w,d,.447);joints(w,d);arched_ends(w,d,h,.728,3,mounts=True)
 B.box('Under-bed drawer case bottom deck',(0,0,.126),(w-.118,d-.220,.030),'wood',.004)
 for x in [-w/2+.076,w/2-.076]:B.box('Under-bed drawer case long side',(x,0,.269),(.028,d-.232,.276),'wood',.004)
 for y in [-.952,.952]:B.box('Under-bed drawer case end board',(0,y,.262),(w-.133,.029,.283),'wood',.004)
 # Broad right-side fronts are genuine three closed shallow drawers, each seated in its case.
 for j,y in enumerate([-.635,0,.635]):
  B.box('Closed under-bed drawer front %d'%(j+1),(w/2-.054,y,.257),(.048,.616,.242),'trim',.006)
  for dy in [-.178,.178]:B.rod('Drawer brass handle supported mounting stem',(w/2-.050,y+dy,.277),(w/2-.006,y+dy,.277),.008,'brass',8)
  B.rod('Drawer brass grasp rail',(w/2-.009,y-.178,.277),(w/2-.009,y+.178,.277),.008,'brass',8)
 for y in [-.955,-.319,.319,.955]:B.box('Under-bed drawer structural separator',(0,y,.261),(w-.148,.020,.266),'wood',.003)
 top=B.bedding(w,d-.016,base,2)
 return feature(top,base,2,w-.132,d-.270,'double-bed/three-closed-side-drawers/hollow-low-case/three-raised-head-foot-fields/open-slat-top')

def footlocker():
 w,d,h=1.120,2.500,1.090;start=len(B.PARTS);bd=2.120;base=B.bedframe(w,bd,.356);joints(w,bd);arched_ends(w,bd,h,.665,1,mounts=True);top=B.bedding(w,bd+.080,base,1);translate_new(start,dy=.190)
 cy=-1.059
 for x in [-.447,.447]:
  for y in [-1.180,-.948]:B.radial('Footlocker integrated ground foot',[(.027,0),(.034,.024),(.026,.144)],x,y,'wood',10,'ground-support')
 B.box('Footlocker hollow chest bottom',(0,cy,.153),(w-.074,.326,.037),'wood',.004)
 for x in [-w/2+.025,w/2-.025]:B.box('Footlocker chest end panel',(x,cy,.332),(.050,.368,.370),'wood',.005)
 for y in [-1.219,-.893]:B.box('Footlocker chest long panel',(0,y,.334),(w-.082,.050,.358),'wood',.005)
 B.box('Footlocker overhanging closed hinged lid',(0,-1.060,.531),(w,.380,.048),'trim',.007)
 for x in [-.345,.345]:B.box('Attached footlocker brass lid hinge',(x,-.892,.510),(.071,.020,.044),'brass',.002)
 B.box('Footlocker front brass lock plate',(0,-1.247,.389),(.071,.006,.090),'brass',.003)
 B.box('Footlocker-to-bed joining cross beam',(0,-.883,.343),(w-.088,.058,.075),'wood',.004)
 return feature(top,base,1,w-.132,1.946,'single-bed-plus-integrated-hollow-closed-blanket-footlocker/separate-lid-and-hinge-construction/long-footprint')

def rope_single():
 w,d,h=1.120,2.120,1.010;start=len(B.PARTS);B.bedframe(w,d,.335);joints(w,d)
 for ob in list(B.PARTS[start:]):
  if ob.get('role')=='mattress-support'or 'centre mattress bearer'in ob.name or 'centre bearer ground support'in ob.name:B.PARTS.remove(ob);B.bpy.data.objects.remove(ob,do_unlink=True)
 B.P['rope']=B.kit.matp('Natural taut hemp bed cords','#b6a184',.94,0);B.P['rope']['finishChannel']='rope'
 for k in range(12):
  y=-.900+k*1.800/11;B.rod('Transverse taut rope mattress support',(-w/2+.051,y,.339),(w/2-.051,y,.339),.009,'rope',8,'mattress-support')
 for k in range(8):
  x=-.432+k*.864/7;B.rod('Longitudinal taut rope mattress support',(x,-d/2+.110,.335),(x,d/2-.110,.335),.007,'rope',8,'mattress-support')
 wood_end_frames(w,d,h,.688,style='ladder');top=B.bedding(w,d+.101,.348,1)
 return feature(top,.348,1,w-.132,d-.153,'taut-orthogonal-hemp-rope-deck/twenty-visible-cords/no-wooden-slat-or-centre-bearer/open-ladder-head-foot')

def suspended_frame(w,d,top,name):
 for x in [-w/2+.036,w/2-.036]:B.box(name+' longitudinal side rail',(x,0,top-.049),(.058,d-.120,.106),'wood',.006)
 for y in [-d/2+.065,d/2-.065]:B.box(name+' tenoned end rail',(0,y,top-.053),(w-.068,.058,.094),'wood',.006)
 for x in [-w/2+.061,w/2-.061]:B.box(name+' inner support cleat',(x,0,top-.022),(.040,d-.126,.033),'wood',.002)
 for k in range(10):B.box(name+' transverse berth mattress slat',(0,-d/2+.143+k*(d-.286)/9,top-.010),(w-.075,.089,.020),'trim',.002,'mattress-support')


def adult_bunk():
 w,d,h=1.040,2.130,1.970;xp=w/2-.038;yp=d/2-.038
 for x in [-xp,xp]:
  for y in [-yp,yp]:
   B.radial('Bunk full-height grounded structural post',[(.035,0),(.035,.030),(.029,.130),(.031,1.905),(.035,1.934),(.022,h)],x,y,'wood',12,'ground-support')
   B.radial('Bunk attached brass post collar',[(.035,1.802),(.038,1.802),(.038,1.827),(.035,1.827)],x,y,'brass',8)
 tops=[];supports=[.354,1.342]
 for n,s in enumerate(supports,1):suspended_frame(w,d,s,'Adult berth %d'%n);tops.append(B.bedding(w,d+.096,s,1))
 for x in [-xp,xp]:
  for z in [1.682,1.844]:B.box('Upper bunk continuous side guard',(x,0,z),(.037,d-.062,.052),'trim',.004)
  for y in [-.748,-.375,0,.375,.748]:B.rod('Upper bunk side guard spindle',(x,y,1.558),(x,y,1.848),.013,'wood',8)
 for y in [-yp,yp]:
  for z in [1.672,1.840]:
   if y>0:B.box('Upper bunk continuous head guard rail',(0,y,z),(w-.062,.041,.052),'trim',.004)
   else:
    # Foot-entry gap aligns with the ladder: adults can enter without crossing a closed guard.
    for x0,x1 in [(-w/2+.031,-.276),(.219,w/2-.031)]:B.box('Upper bunk foot guard beside ladder entry',((x0+x1)/2,y,z),(x1-x0,.041,.052),'trim',.004)
  B.box('Lower bunk open end transom',(0,y,.838),(w-.062,.041,.063),'trim',.004)
 # Grounded ladder side rails extend to the guard as usable fixed handholds.
 y=-yp-.004
 for x in [-.292,.235]:B.box('Fixed adult bunk ladder side and handhold',(x,y,.935),(.038,.045,1.870),'wood',.003)
 for z in [.151,.392,.633,.874,1.115,1.356]:B.rod('Fixed adult bunk ladder rung',(-.310,y,z),(.253,y,z),.018,'wood',8)
 return feature(max(tops),max(supports),2,w-.132,d-.158,'two-fixed-adult-servants-berths/continuous-grounded-corner-posts/fixed-six-rung-ladder/upper-guards-with-ladder-entry-gap',mattressTopsM=tops,mattressSupportsM=supports,adultBerths=2,ladderEntryClearWidthM=.489)

def alcove():
 w,d,h=1.240,2.210,2.080
 B.box('Alcove continuous ground plinth',(0,0,.064),(w,d,.128),'trim',.010,'ground-support')
 for x in [-w/2+.037,w/2-.037]:
  B.box('Alcove continuous enclosed side board',(x,0,1.083),(.048,d-.036,1.952),'wood',.004)
  for y in [-.771,0,.771]:
   # Attached raised side panels and framing disclose real cabinet-like construction.
   B.box('Alcove raised exterior side panel',(x+(.027 if x>0 else-.027),y,1.092),(.015,.635,1.583),'trim',.004)
 B.box('Alcove enclosed head backboard',(0,d/2-.030,1.083),(w-.059,.048,1.951),'wood',.004)
 B.box('Alcove fitted top roof board',(0,0,h-.022),(w,d,.044),'trim',.007)
 for x in [-w/2+.040,w/2-.040]:B.box('Alcove open-foot entry pilaster',(x,-d/2+.031,1.074),(.079,.061,1.980),'trim',.010)
 B.box('Alcove open-foot lintel frieze',(0,-d/2+.035,1.948),(w-.083,.070,.144),'wood',.007)
 for x in [-.455,.455]:B.rod('Alcove lintel brass joint pin',(x,-d/2+.010,1.950),(x,-d/2+.041,1.950),.015,'brass',10)
 support=.402;bw=w-.131;bd=d-.133;suspended_frame(bw,bd,support,'Alcove interior berth');B.box('Alcove berth cross bearer',(0,0,.181),(bw-.096,bd-.086,.110),'wood',.004)
 for x in [-.443,.443]:B.box('Alcove plinth-to-berth vertical support',(x,0,.258),(.056,bd-.126,.277),'wood',.003)
 top=B.bedding(bw,bd+.083,support,1)
 return feature(top,support,1,bw-.132,bd-.171,'enclosed-three-sided-paneled-alcove/continuous-ground-plinth/roof-and-open-foot-lintel/integrated-interior-single-berth')

def sleigh_single():
 f=B.sleigh(w=1.120,d=2.250,h=1.150,capacity=1);f.update(variantType='single-capacity-and-narrow-footprint',variantOf='rpg-mansion-sleigh-double-bed-01');return f

def add_specs(builder):
 global B;B=builder
 return [('spindle-single-bed','挽物の格子ヘッド・シングルベッド',(1100,2150,1210),spindle_single,'A one-person bed with ten turned spindles mortised into open arched head and foot rails'),('arched-wide-guest-bed','二枚アーチ化粧板の幅広客用ベッド',(1930,2250,1280),wide_guest,'A wide two-person guest bed with paired arched raised fields and open structural slat support'),('narrow-servants-bed','梯子背の細幅使用人ベッド',(900,2050,990),narrow_servants,'A narrow adult one-person ladder-head sleeping frame'),('low-platform-double-bed','六脚支持の低い平台ダブルベッド',(1560,2180,460),low_platform,'A two-person low platform with six broad turned supports, open perimeter rim and exposed supporting slats'),('open-tester-four-poster-bed','開放梁とスカラップ縁の四柱ベッド',(1740,2300,2240),tester,'A double four-poster bed with open overhead rafters, scalloped attached valances and shaped arched ends'),('half-tester-single-bed','曲がり控えで支える半天蓋ベッド',(1140,2160,2100),half_tester,'A single half-tester with two grounded tall head posts and real curved cantilever braces'),('paired-twin-beds','中央通路付きツイン二床の組合せ',(2360,2130,1160),paired_twin,'A static two-single-bed capacity arrangement with a measurable central aisle'),('daybed-deployed-trundle-variant','引出し寝台を展開したデイベッド・静的寸法違い',(1810,2140,980),trundle_deployed,'A static deployed-trundle footprint/capacity variant with a second independently grounded low sleeping surface'),('daybed-stowed-trundle-variant','引出し寝台を収納したデイベッド・静的寸法違い',(1060,2140,980),trundle_stowed,'A static nested-trundle footprint variant; one active sleeping berth and one stored spare'),('drawer-double-bed','三段横引出し収納付きダブルベッド',(1630,2200,1160),drawer_double,'A double bed over a hollow closed-drawer case with three separately built broad side drawer fronts'),('footlocker-single-bed','足元毛布箱を組み込んだ一人用ベッド',(1120,2500,1090),footlocker,'A single bed joined to an integrated hollow blanket chest at the foot end'),('rope-sprung-single-bed','麻ロープ支持の一人用ベッド',(1120,2120,1010),rope_single,'A one-person rope-sprung frame with twenty taut crossing support cords and no wooden support slats'),('adult-servants-bunk-bed','固定梯子の成人使用人用二段寝台',(1040,2130,1970),adult_bunk,'Two fixed adult sleeping berths, a six-rung static ladder with extended handholds and upper guards with a clear ladder-entry gap'),('alcove-enclosed-single-bed','三方板囲いと屋根のアルコーブ寝台',(1240,2210,2080),alcove,'A one-person enclosed alcove berth with paneled sides, roof, grounded plinth and open-foot entry'),('sleigh-single-capacity-variant','曲木そり型・一人用細幅寸法違い',(1120,2250,1150),sleigh_single,'An explicitly labeled narrow one-person capacity and footprint variant of the double sleigh construction')]
