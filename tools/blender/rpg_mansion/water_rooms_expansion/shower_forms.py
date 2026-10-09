"""Original static supply fixtures, shower forms and flushometer WC."""
import math

def add_specs(B):
 def extra(key,label,col,rough,metal,channel):
  m=B.kit.matp(label,col,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;B.M[key]=m;return m
 def floor(**v):
  d=dict(installation={'mount':'floor-and-wall'if v.pop('wall',False)else'floor','floorPlaneY':0},capacityNote='Static representation only; not working plumbing or engineering certification.');d.update(v);B.DATUM.update(d)
 def escutcheon(name,x,y,z,r=.04):return B.sweep(name,[(x,y-.018,z),(x,y,z)],r,'metal',16)
 def filler():
  for sx in [-1,1]:
   x=sx*.115
   B.lathe('Filler grounded floor mounting foot '+str(sx),x,0,[(.059,0),(.059,.009),(.049,.018),(.024,.042),(.022,.805)],'metal',16)
   B.lathe('Filler valve body '+str(sx),x,0,[(.030,.795),(.037,.825),(.033,.862),(.019,.879),(.017,.914)],'metal',14)
   B.sweep('Filler cross handle bar '+str(sx),[(x-.038,0,.914),(x+.038,0,.914)],.006,'metal',8)
   B.sweep('Filler cross handle spindle '+str(sx),[(x,-.030,.914),(x,.030,.914)],.006,'metal',8)
   for dx in [-.038,.038]:B.lathe('Filler porcelain handle tip %d %.3f'%(sx,dx),x+dx,0,[(.009,.906),(.010,.914),(.007,.922)],'ceramic',8)
  B.sweep('Filler bridge mixer',[(-.115,0,.834),(.115,0,.834)],.021,'metal',14)
  path=[(0,0,.832),(0,0,.95),(0,-.028,.993),(0,-.083,1.020),(0,-.17,1.02),(0,-.27,.978),(0,-.345,.901),(0,-.36,.863)]
  B.sweep('Long-reach bath filler gooseneck',path,.018,'metal',14)
  B.sweep('Bath filler downward outlet lip',[(0,-.36,.872),(0,-.36,.850)],.024,'metal',16)
  floor(faucetHeightMm=1038,spoutOutletOriginalBlenderM=[0,-.36,.85],supplyMountCentersOriginalBlenderM=[[-.115,0,0],[.115,0,0]],pairingNote='Separate floor filler; place with the approved slipper bath using measured supply-base datum, not visual envelope center. Paired installation evidence is supplied separately.')
 def hand_shower():
  extra('rubber','Dark flexible shower hose','#393c36',.53,0,'rubber')
  B.sweep('Hand-shower sliding rail',[(0,0,.345),(0,0,1.205)],.013,'metal',12)
  for z in [.375,1.17]:
   p=escutcheon('Rail wall mounting plate '+str(z),0,.075,z,.042);p['functionalRole']='wall-anchor'
   B.sweep('Rail wall support arm '+str(z),[(0,.064,z),(0,0,z)],.014,'metal',10)
  B.box('Hand-shower sliding support clamp',(.060,-.012,.851),(.145,.058,.053),'metal',.006)
  B.sweep('Handset ergonomic handle',[(.10,-.024,.817),(.10,-.040,.892),(.10,-.073,1.044)],.018,'ceramic',12)
  B.sweep('Handset upper brass neck',[(.10,-.070,1.03),(.10,-.098,1.101),(.10,-.143,1.130)],.017,'metal',12)
  B.sweep('Handset rounded shower rose body',[(.10,-.126,1.122),(.10,-.163,1.135)],.052,'metal',24)
  B.sweep('Handset inset spray face',[(.10,-.159,1.134),(.10,-.172,1.139)],.044,'ceramic',24)
  # One continuous flex hose with actual contacts at both closed static fittings.
  points=[(.10,-.024,.817),(.137,-.061,.67),(.17,-.09,.48),(.176,-.125,.26),(.151,-.150,.105),(.10,-.159,.05),(.026,-.155,.045),(-.061,-.131,.085),(-.121,-.092,.196),(-.15,-.055,.35),(-.15,.048,.515)]
  B.sweep('Flexible hand-shower hose',points,.010,'rubber',10)
  p=escutcheon('Hand-shower water outlet wall plate',-.15,.075,.515,.042);p['functionalRole']='wall-anchor'
  B.sweep('Hand-shower outlet elbow',[(-.15,.062,.515),(-.15,.015,.515),(-.15,-.009,.480)],.018,'metal',12)
  for x,y,z in [(.10,-.024,.817),(-.15,.048,.515)]:B.lathe('Hose union %.2f'%x,x,y,[(.015,z-.02),(.018,z-.01),(.018,z+.01),(.015,z+.02)],'metal',12)
  B.DATUM.update(defaultElevationMm=850,capacityNote='One static rail-mounted handset with real continuous hose and sliding holder. No water simulation.',installation={'mount':'wall-plates','wallContactPlaneBlenderY':.075,'defaultElevationMm':850,'originalLocalAnchorHeightsM':[.375,1.17,.515]},faucetHeightMm=None,showerHeadOriginalBlenderM=[.10,-.172,1.139])
 def standpipe():
  B.lathe('Shower standpipe grounded floor flange',0,0,[(.067,0),(.067,.013),(.042,.025),(.023,.055)],'metal',20)
  path=[(0,0,.022),(0,0,2.12),(0,-.018,2.191),(0,-.057,2.224),(0,-.12,2.24),(0,-.278,2.24),(0,-.36,2.213),(0,-.40,2.173)]
  B.sweep('Continuous overhead shower brass standpipe',path,.021,'metal',16)
  for z in [.81,1.69]:
   p=escutcheon('Standpipe wall bearing plate '+str(z),0,.085,z,.043);p['functionalRole']='wall-anchor'
   B.sweep('Standpipe attached wall brace '+str(z),[(0,0,z),(0,.079,z)],.014,'metal',12)
  B.sweep('Overhead shower cross mixer bar',[(-.17,0,1.04),(.17,0,1.04)],.024,'metal',14)
  for sx in [-1,1]:
   x=sx*.143;B.lathe('Overhead shower mixer valve '+str(sx),x,0,[(.029,1.026),(.031,1.070),(.012,1.097)],'metal',12)
   B.sweep('Overhead shower ceramic lever '+str(sx),[(x,0,1.091),(x,-.075,1.111)],.009,'ceramic',10)
  B.lathe('Overhead domed brass shower rose',0,-.40,[(.155,2.14),(.16,2.15),(.137,2.176),(.070,2.202),(.022,2.214)],'metal',32)
  B.lathe('Overhead inset porcelain spray plate',0,-.40,[(.139,2.132),(.147,2.14),(.142,2.145)],'ceramic',32)
  floor(wall=True,faucetHeightMm=1119,showerHeadHeightMm=2132,installation={'mount':'floor-flange-and-wall-braces','floorPlaneY':0,'wallContactPlaneBlenderY':.085,'originalLocalAnchorHeightsM':[.81,1.69]},showerHeadOriginalBlenderM=[0,-.40,2.132])
 def enclosure():
  m=extra('glass','Clear pale shower safety-glass representation','#cbdad9',.07,0,'glass');n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Transmission Weight'].default_value=.92;n.inputs['IOR'].default_value=1.45;n.inputs['Alpha'].default_value=.12;m.diffuse_color=(.60,.71,.70,.12);m.surface_render_method='DITHERED'
  rings=[B.rounded_rect(0,0,w,d,r,z,n=5)for w,d,r,z in [(1,1,.035,0),(1,1,.035,.11),(.99,.99,.035,.124),(.903,.903,.045,.124),(.897,.897,.044,.092),(.878,.878,.042,.041),(.86,.86,.039,.035)]]
  ob=B.loft('Enclosure genuinely hollow shower tray',rings);ob['functionalRole']='hollow-shower-tray'
  B.drain('Enclosure inset shower drain',.31,.30,.036,.034)
  for sx in [-1,1]:
   for sy in [-1,1]:B.box('Shower enclosure vertical frame %d %d'%(sx,sy),(sx*.462,sy*.462,1.063),(.03,.03,1.902),'iron',.003)
  for z in [.14,2.0]:
   def square(r,zz):return [(-r,-r,zz),(r,-r,zz),(r,r,zz),(-r,r,zz)]
   B.loft('Enclosure continuous joined frame ring '+str(z),[square(.479,z-.0145),square(.479,z+.0145),square(.444,z+.0145),square(.444,z-.0145)],'iron',False,False)
  for sx in [-1,1]:B.box('Enclosure fixed side glass '+str(sx),(sx*.462,0,1.073),(.006,.902,1.835),'glass',.001)
  B.box('Enclosure fixed rear glass',(0,.462,1.073),(.900,.006,1.835),'glass',.001)
  B.box('Enclosure closed front glass door',(0,-.463,1.072),(.873,.007,1.819),'glass',.001)
  for z in [.39,1.68]:
   B.box('Shower door brass hinge leaf '+str(z),(-.434,-.469,z),(.054,.024,.058),'metal',.003)
   B.sweep('Shower door vertical hinge barrel '+str(z),[(-.459,-.472,z-.035),(-.459,-.472,z+.035)],.014,'metal',12)
  B.sweep('Shower door mounted pull handle',[(.317,-.510,1.015),(.317,-.510,1.195)],.012,'metal',12)
  for z in [1.025,1.185]:B.sweep('Shower door pull stand-off '+str(z),[(.317,-.461,z),(.317,-.510,z)],.012,'metal',12)
  floor(rimHeightMm=124,internalFloorHeightMm=35,clearBowlMm={'trayOpeningWidth':903,'trayOpeningDepth':903,'trayDepth':89},fixtureNote='Framed static transparent enclosure with closed glass door and hollow tray. Water supply fixture is a separate asset; the door is not animated.',glassNominalThicknessMm={'fixed':6,'door':7})
 def flushometer():
  rows=[(.285,.39,0,-.072),(.30,.405,.025,-.072),(.215,.31,.105,-.068),(.18,.27,.24,-.045),(.325,.48,.32,-.062),(.41,.60,.390,-.06),(.405,.595,.41,-.06),(.297,.442,.41,-.06),(.28,.421,.378,-.06),(.185,.238,.278,-.08),(.155,.203,.26,-.08)]
  ob=B.loft('Flushometer WC continuous hollow bowl and broad foot',[B.ellipse(w,d,z,cy=y,n=40)for w,d,z,y in rows]);ob['functionalRole']='hollow-wc-bowl'
  B.loft('Flushometer WC open dark seat ring',[B.ellipse(.421,.614,.418,cy=-.06,n=40),B.ellipse(.432,.625,.432,cy=-.06,n=40),B.ellipse(.423,.616,.451,cy=-.06,n=40),B.ellipse(.303,.446,.451,cy=-.06,n=40),B.ellipse(.296,.439,.430,cy=-.06,n=40),B.ellipse(.304,.447,.418,cy=-.06,n=40)],'wood',True,False)
  for sx in [-1,1]:B.box('Flushometer WC seat load pad '+str(sx),(sx*.158,-.075,.415),(.032,.063,.020),'wood',.002)
  B.sweep('Flushometer vertical bowl feed',[(0,.205,.39),(0,.253,.448),(0,.279,.51),(0,.279,.906)],.023,'metal',14)
  B.lathe('Flushometer pressure valve body',0,.279,[(.038,.848),(.055,.877),(.055,.935),(.046,.96),(.035,.982)],'metal',20)
  B.sweep('Flushometer wall inlet',[(0,.279,.895),(0,.410,.895)],.029,'metal',14)
  p=escutcheon('Flushometer wall service escutcheon',0,.424,.895,.065);p['functionalRole']='wall-anchor'
  B.sweep('Flushometer actual operating lever representation',[(.045,.279,.913),(.10,.269,.914),(.16,.241,.935)],.009,'metal',10)
  B.lathe('Flushometer decorative ceramic lever tip',.16,.241,[(.013,.923),(.017,.936),(.011,.948)],'ceramic',12)
  for z in [.51,.78]:B.lathe('Flushometer union nut '+str(z),0,.279,[(.031,z-.014),(.034,z-.009),(.034,z+.009),(.031,z+.014)],'metal',8)
  floor(seatHeightMm=451,bowlRimHeightMm=410,clearBowlMm={'rimWidth':297,'rimDepth':442,'depth':150},faucetHeightMm=None,installation={'mount':'floor-with-wall-service-inlet','floorPlaneY':0,'wallContactPlaneBlenderY':.424,'serviceInletOriginalBlenderM':[0,.424,.895]},mechanismNote='No storage tank. Static exposed flushometer valve and direct bowl feed; no working flushing mechanism.')
 return [dict(slug=slug,name=name,kind=kind,fn=fn,channels=channels,size=None,elevation=elev,signature=sig,meaning=meaning)for slug,name,kind,fn,channels,elev,sig,meaning in [
 ('freestanding-bath-bridge-filler','床立て・ブリッジ型浴槽用水栓','bath-fixture',filler,['metal','ceramic'],0,'dual-floor-columns-long-reach-arched-bath-filler','Independent twin-column floor filler with actual grounded mounting feet, cross valves and long-reach spout; paired installation with slipper bath is proved separately.'),
 ('rail-hand-shower-hose','昇降レール・ハンドシャワー','shower-system',hand_shower,['metal','ceramic','rubber'],850,'wall-mounted-slide-rail-handset-continuous-flex-hose','Wall-supported hand shower with actual handset holder, two rail plates, service outlet and one continuous flexible hose.'),
 ('overhead-brass-standpipe','真鍮スタンドパイプ・オーバーヘッドシャワー','shower-system',standpipe,['metal','ceramic'],0,'floor-flange-wall-braced-overhead-domed-rose','Tall overhead exposed brass shower with floor flange, two wall braces, mixer valves and domed downward-facing rose.'),
 ('framed-glass-shower-enclosure','ガラス框・中空トレー付シャワーブース','shower-system',enclosure,['ceramic','metal','glass'],0,'hollow-tray-four-sided-frame-glass-door-enclosure','Real hollow shower tray and drain with four-sided metal frame, separate closed transparent glass door, hinges and mounted pull; fixtures remain static.'),
 ('tankless-flushometer-wc','露出洗浄弁・タンクレス便器','toilet',flushometer,['ceramic','metal','wood'],0,'tankless-direct-wall-flushometer-bowl','Different tankless installation: broad-foot hollow WC, open dark seat, exposed pressure-valve body, direct wall inlet and bowl-feed pipe.')]]
