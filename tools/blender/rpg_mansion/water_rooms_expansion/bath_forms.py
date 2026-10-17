"""Original additional bath constructions; no baseline roll-top/pedestal copies."""
import math

def add_specs(B):
 def extra_material(key,label,color,rough=.3,metal=0,channel='metal'):
  m=B.kit.matp(label,color,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;B.M[key]=m
 def floor_datums(**values):
  d=dict(installation={'mount':'floor','floorPlaneY':0},faucetHeightMm=None,fixtureNote='Bath only; a separate supply fixture is required.',capacityNote='One bathing occupant. Static design, not ergonomic or plumbing certification.');d.update(values);B.DATUM.update(d)
 def bateau():
  extra_material('copper','Hand-formed warm copper bath','#a36a45',.32,.86)
  rim=lambda a:.61+.11*math.cos(a)**2
  rings=[B.ellipse(1.28,.38,.12),B.ellipse(1.48,.54,.23),B.ellipse(1.72,.705,lambda a:rim(a)-.07),B.ellipse(1.80,.76,rim),B.ellipse(1.785,.746,lambda a:rim(a)+.006),B.ellipse(1.71,.668,lambda a:rim(a)-.004),B.ellipse(1.67,.63,lambda a:rim(a)-.028),B.ellipse(1.36,.414,.195),B.ellipse(1.29,.375,.166)]
  ob=B.loft('Bateau continuous copper hull and open cavity',rings,'copper');ob['functionalRole']='hollow-bath'
  for sy in [-1,1]:
   B.box('Longitudinal timber cradle skid '+str(sy),(0,sy*.19,.043),(1.56,.09,.086),'wood',.014)
  for sx in [-1,1]:
   B.box('Cradle transverse bath bearer '+str(sx),(sx*.49,0,.112),(.17,.46,.104),'wood',.012)
   for sy in [-1,1]:B.box('Copper cradle retaining band %d %d'%(sx,sy),(sx*.49,sy*.177,.165),(.055,.045,.085),'copper',.005)
  B.drain('Bateau internal brass drain',.35,0,.167,.024)
  floor_datums(rimHeightMm={'lowSideCrest':616,'endCrests':726},internalFloorHeightMm=166,clearBowlMm={'rimLength':1710,'rimWidth':668,'floorLength':1290,'floorWidth':375,'lowSideDepth':450})
 def builtin():
  def rect(w,d,z,n=48):
   out=[]
   for i in range(n):
    a=math.tau*i/n;c,s=math.cos(a),math.sin(a);r=min(w/2/max(abs(c),1e-12),d/2/max(abs(s),1e-12));out.append((r*c,r*s,z))
   return out
  rings=[rect(1.65,.68,.09),rect(1.76,.79,.565),rect(1.80,.82,.59),rect(1.79,.812,.61),B.ellipse(1.60,.61,.61),B.ellipse(1.565,.58,.575),B.ellipse(1.34,.415,.17),B.ellipse(1.285,.38,.145)]
  ob=B.loft('Built-in porcelain bath shell and continuous inset rim',rings);ob['functionalRole']='hollow-bath'
  B.box('Built-in structural base plinth',(0,0,.046),(1.73,.75,.092),'wood',.005)
  # Four panel rails and recessed panels sit in front of the actual bowl shell.
  for sy in [-1,1]:
   y=sy*.401
   for z in [.10,.51]:B.box('Long apron framed rail %d %.2f'%(sy,z),(0,y,z),(1.785,.033,.065),'wood',.004)
   for x in [-.866,-.295,.295,.866]:B.box('Long apron vertical stile %d %.2f'%(sy,x),(x,y,.305),(.043,.037,.41),'wood',.004)
   for x in [-.582,0,.582]:B.box('Recessed long apron panel %d %.2f'%(sy,x),(x,sy*.395,.305),(.522,.022,.35),'wood',.006)
  for sx in [-1,1]:
   for z in [.10,.51]:B.box('End apron rail %d %.2f'%(sx,z),(sx*.889,0,z),(.028,.78,.063),'wood',.004)
   B.box('Recessed end apron panel '+str(sx),(sx*.882,0,.304),(.022,.66,.35),'wood',.006)
  B.drain('Built-in bath drain',.39,0,.146,.024)
  floor_datums(rimHeightMm=610,internalFloorHeightMm=145,clearBowlMm={'rimLength':1600,'rimWidth':610,'floorLength':1285,'floorWidth':380,'depth':465},installationAccessNote='Static paneled freestanding representation of a built-in unit; panels are native parts, not working access doors.')
 def corner():
  outline=[(.65,.65)]+[(.65+1.30*math.cos(math.pi+math.pi/2*i/24),.65+1.30*math.sin(math.pi+math.pi/2*i/24))for i in range(25)]
  cx=cy=.14
  def ring(scale,z):return [(cx+(x-cx)*scale,cy+(y-cy)*scale,z)for x,y in outline]
  rings=[ring(.89,0),ring(.94,.08),ring(.985,.565),ring(1,.59),ring(.994,.61),ring(.845,.61),ring(.825,.579),ring(.67,.175),ring(.64,.14)]
  ob=B.loft('True quadrant corner bath continuous shell and cavity',rings);ob['functionalRole']='hollow-bath'
  B.drain('Corner bath drain',.13,.13,.141,.025)
  for side in ['rear','right']:
   if side=='rear':path=[(-.10,.612,.565),(.12,.612,.565)]
   else:path=[(.612,-.10,.565),(.612,.12,.565)]
   B.sweep('Corner bath attached rim grip '+side,path,.014,'metal',10)
  floor_datums(rimHeightMm=610,internalFloorHeightMm=140,clearBowlMm={'maximumOpeningWidth':1098.5,'maximumOpeningDepth':1098.5,'depth':470},footprintNote='Real quarter-circle front with two perpendicular straight back edges; not a rotated oval.',installationCorner={'originalBlenderWallPlanes':{'x':.65,'y':.65},'cornerAssemblyClearanceMm':0})
 def hip():
  rings=[B.ellipse(.94,.56,0,n=40),B.ellipse(1.02,.63,.055,n=40),B.ellipse(1.14,.74,.79,n=40),B.ellipse(1.18,.78,.84,n=40),B.ellipse(1.166,.766,.86,n=40),B.ellipse(1.04,.64,.86,n=40),B.ellipse(1.01,.61,.827,n=40),B.ellipse(.92,.49,.18,n=40),B.ellipse(.88,.45,.15,n=40)]
  ob=B.loft('Deep hip bath continuous high-sided hollow shell',rings);ob['functionalRole']='hollow-bath'
  def bench_ring(rx,ry,z):
   a=math.acos(-.11/rx);return [(rx*math.cos(a+(math.tau-2*a)*i/24),ry*math.sin(a+(math.tau-2*a)*i/24),z)for i in range(25)]
  B.loft('Hip bath internal raised sitting bench',[bench_ring(.43,.215,.148),bench_ring(.480,.270,.420),bench_ring(.474,.264,.438)],'ceramic')
  B.drain('Hip bath floor drain',.24,0,.151,.022)
  for sy in [-1,1]:
   B.sweep('Hip bath rim supported grab rail '+str(sy),[(-.35,sy*.347,.797),(-.35,sy*.347,.844),(-.15,sy*.347,.844),(-.15,sy*.347,.797)],.012,'metal',10)
  floor_datums(rimHeightMm=860,internalFloorHeightMm=150,internalSeatHeightMm=438,seatAboveInternalFloorMm=288,clearBowlMm={'rimLength':1040,'rimWidth':640,'floorLength':880,'floorWidth':450,'depth':710,'internalBenchFrontClearWidth':514,'internalBenchDepth':364},capacityNote='One seated bathing occupant; static raised seat, not accessibility or ergonomic certification.')
 specs=[]
 for slug,name,fn,signature,meaning,channels in [
 ('copper-bateau-cradle-bath','銅製バトー浴槽・木製クレードル',bateau,'copper-bateau-symmetrical-high-ends-timber-cradle','Long copper bateau with two high ends, an actual hollow hull and load-bearing timber cradle skids.',['metal','wood']),
 ('paneled-built-in-bath','木パネル囲い・埋込型浴槽',builtin,'rectangular-paneled-apron-built-in-hollow-bath','Rectangular built-in bath with continuous inset bowl, plinth, framed recessed apron panels and distinct rectangular installation footprint.',['ceramic','metal','wood']),
 ('quadrant-corner-bath','四分円前縁・コーナー浴槽',corner,'perpendicular-back-walls-quarter-circle-front-cavity','True corner footprint: two perpendicular rear edges, a convex quadrant front and matching non-oval bathing cavity.',['ceramic','metal']),
 ('deep-seated-hip-bath','内部腰掛け付・深型ヒップバス',hip,'deep-hip-bath-internal-raised-seat','Deep compact bath with a substantial internal raised bench, separate low footwell and attached side grab rails.',['ceramic','metal'])]:
  specs.append(dict(slug=slug,name=name,kind='bathtub',fn=fn,channels=channels,size=None,elevation=0,signature=signature,meaning=meaning))
 return specs
