"""Four useful washbasin constructions, explicitly distinct from pedestal baseline."""
import math

def add_specs(B):
 def materials():
  for key,name,col,rough,metal,channel in [('stone','Honed limestone vanity top','#d9d1ba',.43,0,'stone'),('glass','Silver-backed mirror glass','#cbdad9',.06,1,'glass')]:
   m=B.kit.matp(name,col,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;B.M[key]=m
 def rect(w,d,z,cx=0,cy=0,n=40):
  out=[]
  for i in range(n):
   a=math.tau*i/n;c,s=math.cos(a),math.sin(a);r=min(w/2/max(abs(c),1e-12),d/2/max(abs(s),1e-12));out.append((cx+r*c,cy+r*s,z))
  return out
 def cutout_top(name,cx,w,d,z,holew,holed,cy=-.04):
  return B.loft(name,[rect(w,d,z,cx=cx),rect(w,d,z+.026,cx=cx),B.ellipse(holew,holed,z+.026,cx,cy,40),B.ellipse(holew,holed,z,cx,cy,40)],'stone',False,False)
 def basin(name,cx,cy,z,w=.60,d=.46):
  rings=[B.ellipse(w*.60,d*.50,z-.14,cx,cy,40),B.ellipse(w*.80,d*.74,z-.06,cx,cy,40),B.ellipse(w,d,z-.017,cx,cy,40),B.ellipse(w*.988,d*.988,z,cx,cy,40),B.ellipse(w-.09,d-.09,z,cx,cy,40),B.ellipse(w-.115,d-.115,z-.025,cx,cy,40),B.ellipse(w*.50,d*.35,z-.118,cx,cy,40)]
  ob=B.loft(name,rings);ob['functionalRole']='hollow-basin';B.drain(name+' inset drain',cx,cy,z-.117,.020);return ob
 def mixer(name,x,y,z):
  for sx in [-1,1]:
   xx=x+sx*.074;B.lathe(name+' deck valve '+str(sx),xx,y,[(.022,z-.009),(.022,z+.01),(.011,z+.031),(.011,z+.053)],'metal',12);B.sweep(name+' cross handle '+str(sx),[(xx-.025,y,z+.053),(xx+.025,y,z+.053)],.005,'metal',8)
  B.sweep(name+' mixer bridge',[(x-.074,y,z+.025),(x+.074,y,z+.025)],.01,'metal',10)
  B.sweep(name+' arched spout',[(x,y,z-.008),(x,y,z+.145),(x,y-.012,z+.178),(x,y-.041,z+.194),(x,y-.077,z+.187),(x,y-.135,z+.146)],.013,'metal',12)
 def floor_datums(**v):
  d=dict(installation={'mount':'floor','floorPlaneY':0},capacityNote='Static handwashing furniture; no working plumbing or ergonomic certification.');d.update(v);B.DATUM.update(d)
 def cabinet():
  materials()
  for sx in [-1,1]:
   for sy in [-1,1]:B.lathe('Single vanity turned foot %d %d'%(sx,sy),sx*.33,sy*.215,[(.032,0),(.037,.022),(.025,.075),(.035,.14)],'wood',12)
  B.box('Vanity cabinet bottom load-bearing shelf',(0,0,.135),(.72,.50,.048),'wood',.004)
  for sx in [-1,1]:B.box('Vanity cabinet side '+str(sx),(sx*.35,0,.465),(.038,.52,.69),'wood',.004)
  B.box('Vanity cabinet rear panel',(0,.247,.468),(.70,.024,.684),'wood',.003)
  for z in [.16,.777]:B.box('Vanity front carcass rail '+str(z),(0,-.247,z),(.71,.044,.053),'wood',.004)
  for sx in [-1,1]:
   x=sx*.172;B.box('Raised-panel vanity door '+str(sx),(x,-.275,.466),(.327,.033,.554),'wood',.012)
   B.box('Door applied inset central field '+str(sx),(x,-.294,.466),(.255,.013,.468),'wood',.008)
   B.sweep('Vanity door handle mount '+str(sx),[(sx*.057,-.291,.512),(sx*.057,-.316,.512)],.009,'metal',8)
   B.lathe('Vanity door knob '+str(sx),sx*.057,-.321,[(.010,.504),(.014,.512),(.009,.520)],'metal',10)
  for sx in [-1,1]:
   for z in [.32,.62]:
    B.box('Mounted vanity door hinge leaf %d %.2f'%(sx,z),(sx*.329,-.257,z),(.055,.038,.060),'metal',.003)
    B.sweep('Vanity door hinge pin %d %.2f'%(sx,z),[(sx*.341,-.280,z-.032),(sx*.341,-.280,z+.032)],.007,'metal',10)
  cutout_top('Limestone vanity top with actual basin aperture',0,.80,.60,.81,.523,.383)
  basin('Single cabinet basin continuous hollow shell',0,-.04,.859)
  mixer('Single vanity mixer',0,.148,.853)
  for sx in [-1,1]:B.box('Mirror load-bearing upright '+str(sx),(sx*.342,.269,1.21),(.048,.037,.83),'wood',.005)
  B.box('Mirror structural back board',(0,.272,1.362),(.70,.027,.665),'wood',.004)
  B.box('Silver-backed rectangular mirror glass',(0,.251,1.362),(.609,.010,.574),'glass',.002)
  for sx in [-1,1]:B.box('Mirror carved side frame '+str(sx),(sx*.33,.238,1.362),(.045,.038,.653),'wood',.006)
  for z in [1.055,1.67]:B.box('Mirror horizontal frame '+str(z),(0,.237,z),(.70,.04,.057),'wood',.006)
  floor_datums(rimHeightMm=859,faucetHeightMm=1060,clearBowlMm={'rimWidth':510,'rimDepth':370,'depth':118,'floorWidth':300,'floorDepth':161},basinCount=1,storageNote='Two closed static panel doors and a real top aperture; no animated doors or plumbing.')
 def console():
  materials()
  for sx in [-1,1]:
   for sy in [-1,1]:
    x=sx*.643;y=sy*.225;B.lathe('Console metal load-bearing leg %d %d'%(sx,sy),x,y,[(.027,0),(.035,.017),(.022,.05),(.021,.76),(.033,.795)],'iron',12)
  for sy in [-1,1]:B.sweep('Console upper long bearer '+str(sy),[(-.665,sy*.235,.779),(.665,sy*.235,.779)],.022,'iron',10)
  for sx in [-1,1]:B.sweep('Console upper end bearer '+str(sx),[(sx*.643,-.235,.779),(sx*.643,.235,.779)],.022,'iron',10)
  B.box('Console lower walnut towel shelf',(0,0,.179),(1.345,.49,.043),'wood',.005)
  for sx in [-1,1]:
   x=sx*.36;cutout_top('Separate cut-stone basin slab '+str(sx),x,.72,.60,.793,.471,.347)
   basin('Console hollow basin '+str(sx),x,-.045,.839,.55,.43);mixer('Console mixer '+str(sx),x,.148,.833)
   B.sweep('Exposed console P-trap '+str(sx),[(x,-.045,.712),(x,-.045,.50),(x,-.031,.463),(x,.02,.451),(x,.075,.47),(x,.09,.51),(x,.21,.51)],.017,'metal',10)
  floor_datums(rimHeightMm=839,faucetHeightMm=1040,clearBowlMm={'perBasinRimWidth':460,'perBasinRimDepth':340,'depth':118},basinCount=2,capacityGroup='double-basin layout; counted for open-console construction and two actual separate basins, not a recolour',plumbingNote='Static paired exposed traps. Rear outlets require a separate service connection.')
 def portable():
  for sx in [-1,1]:
   for sy in [-1,1]:B.lathe('Portable washstand turned leg %d %d'%(sx,sy),sx*.235,sy*.175,[(.026,0),(.030,.02),(.018,.28),(.025,.69),(.026,.73)],'wood',12)
  B.box('Portable washstand top',(0,0,.733),(.58,.48,.036),'wood',.005)
  B.box('Portable washstand lower shelf',(0,0,.215),(.52,.40,.031),'wood',.004)
  for sy in [-1,1]:B.box('Portable washstand long apron '+str(sy),(0,sy*.186,.682),(.50,.029,.085),'wood',.004)
  for sx in [-1,1]:B.box('Portable washstand short apron '+str(sx),(sx*.247,0,.682),(.025,.385,.085),'wood',.004)
  rings=[B.ellipse(.225,.17,.751,-.063,-.025,40),B.ellipse(.31,.24,.79,-.063,-.025,40),B.ellipse(.398,.318,.875,-.063,-.025,40),B.ellipse(.40,.32,.894,-.063,-.025,40),B.ellipse(.361,.281,.894,-.063,-.025,40),B.ellipse(.335,.254,.873,-.063,-.025,40),B.ellipse(.207,.144,.774,-.063,-.025,40)]
  ob=B.loft('Portable washstand loose hollow washing bowl',rings);ob['functionalRole']='hollow-basin'
  x=.198;y=.128
  rings=[B.ellipse(2*r,2*r,z,x,y,24)for r,z in [(.051,.751),(.074,.783),(.086,.864),(.074,.947),(.044,1.014),(.059,1.047),(.051,1.047),(.036,1.014),(.065,.947),(.076,.864),(.064,.787),(.043,.768)]]
  B.loft('Portable ceramic water jug hollow body',rings)
  B.sweep('Water jug attached loop handle',[(x+.070+.055*math.cos(math.tau*i/20),y,.913+.102*math.sin(math.tau*i/20))for i in range(20)],.011,'ceramic',8,True)
  # Lower shelf towel rail: functional geometry and actual mounting stubs.
  B.sweep('Portable washstand front towel rail',[(-.21,-.269,.651),(.21,-.269,.651)],.009,'metal',10)
  for x in [-.21,.21]:B.sweep('Towel rail supported mount '+str(x),[(x,-.183,.651),(x,-.269,.651)],.010,'metal',10)
  floor_datums(rimHeightMm=894,faucetHeightMm=None,clearBowlMm={'rimWidth':361,'rimDepth':281,'depth':120},basinCount=1,fixtureNote='Portable washing bowl and hollow water jug; no fixed faucet, drain or working plumbing.')
 def corner():
  outline=[(.27,.27)]+[(.27+.54*math.cos(math.pi+math.pi/2*i/20),.27+.54*math.sin(math.pi+math.pi/2*i/20))for i in range(21)]
  def ring(scale,z):return [(.057+(x-.057)*scale,.057+(y-.057)*scale,z)for x,y in outline]
  ob=B.loft('Corner basin quarter-front hollow shell',[ring(.62,.17),ring(.94,.275),ring(1,.302),ring(.989,.32),ring(.73,.32),ring(.70,.292),ring(.45,.204)]);ob['functionalRole']='hollow-basin'
  p=B.box('Corner basin rear wall bearing plate',(-.105,.271,.135),(.05,.018,.27),'iron',.002);p['functionalRole']='wall-anchor'
  p=B.box('Corner basin side wall bearing plate',(.271,-.105,.135),(.018,.05,.27),'iron',.002);p['functionalRole']='wall-anchor'
  B.box('Corner basin rear bearing arm',(-.105,.102,.169),(.029,.335,.029),'iron',.003)
  B.box('Corner basin side bearing arm',(.102,-.105,.169),(.335,.029,.029),'iron',.003)
  B.sweep('Corner basin rear triangulated brace',[(-.105,.270,.042),(-.105,-.043,.165)],.013,'iron',8)
  B.sweep('Corner basin side triangulated brace',[(.270,-.105,.042),(-.043,-.105,.165)],.013,'iron',8)
  for z in [.04,.23]:
   B.fixings('Rear corner anchor '+str(z),-.105,.262,z)
   B.sweep('Side corner anchor '+str(z),[(.262,-.105,z),(.251,-.105,z)],.007,'metal',8)
  B.drain('Corner basin drain',.043,.043,.205,.020)
  B.sweep('Corner basin waste tail',[(.043,.043,.206),(.043,.043,.091),(.072,.073,.065),(.121,.121,.082),(.14,.27,.082)],.016,'metal',10)
  B.sweep('Corner basin rear service escutcheon',[(.14,.263,.082),(.14,.280,.082)],.029,'metal',16)
  # Rear corner tap stem has a diagonal reach over the actual cavity.
  B.lathe('Corner mixer tap deck foot',.206,.206,[(.027,.311),(.025,.333),(.018,.35)],'metal',12)
  B.sweep('Corner mixer curved spout',[(.206,.206,.324),(.206,.206,.477),(.19,.19,.507),(.155,.155,.514),(.104,.104,.492),(.066,.066,.463)],.014,'metal',12)
  B.sweep('Corner mixer lever',[(.21,.211,.358),(.257,.233,.393)],.006,'metal',8)
  B.DATUM.update(rimHeightMm=920,defaultElevationMm=600,faucetHeightMm=1128,clearBowlMm={'maximumOpeningWidth':394.2,'maximumOpeningDepth':394.2,'depth':116},basinCount=1,capacityNote='One static corner hand basin.',installation={'mount':'two-perpendicular-wall-brackets','defaultElevationMm':600,'wallContactPlaneBlenderY':.280,'secondWallContactPlaneBlenderX':.280,'note':'Two perpendicular wall bearing plates and separate triangulated arms. Waste pipe is not structural.'})
 return [dict(slug=slug,name=name,kind='vanity',fn=fn,channels=channels,size=None,elevation=elev,signature=sig,meaning=meaning)for slug,name,fn,channels,elev,sig,meaning in [
 ('single-basin-mirrored-cabinet','鏡付・一槽洗面キャビネット',cabinet,['ceramic','metal','wood','stone','glass'],0,'closed-two-door-cabinet-mirror-real-cutout-top','Single-basin walnut cabinet, two panel doors, actual cutout stone top and supported mirror; a different storage construction from a pedestal or bracket basin.'),
 ('double-basin-open-console','二槽・金属脚洗面コンソール',console,['ceramic','metal','wood','stone'],0,'two-real-basins-open-metal-console','Two separately hollow basins in two cut-stone slabs on an exposed metal console with lower towel shelf and two independent traps.'),
 ('portable-bowl-jug-washstand','洗面鉢と水差し・可搬ウォッシュスタンド',portable,['ceramic','metal','wood'],0,'portable-bowl-hollow-jug-timber-washstand','Portable ceramic bowl and actually hollow water jug on turned timber table; no fixed plumbing.'),
 ('two-wall-corner-basin','二面壁支持・コーナー洗面器',corner,['ceramic','metal'],600,'quarter-front-two-wall-bracket-basin','A real quadrant-front corner bowl on perpendicular wall brackets, with diagonal corner tap and exposed waste tail.')]]
