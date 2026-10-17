"""Four original period-service constructions. Static shapes, no simulated mechanisms."""
from common import *
from mathutils import Matrix

def setup():
    PARTS.clear();M.clear();DATUM.clear();CONTACTS.clear()
    for key,label,col,rough,metal,channel in [
      ('iron','Blackened period iron','#35403e',.49,.72,'metal'),('brass','Aged brass fasteners','#b29455',.37,.76,'hardware'),
      ('zinc','Soft pewter galvanized wash tub','#9aa7a6',.42,.58,'metal'),('oak','Oiled honey oak','#896443',.58,0,'wood'),
      ('soapwood','Pale scrubbed washboard timber','#bfaa7c',.72,0,'wood'),('rub','Fluted zinc rubbing surface','#b0bbba',.48,.45,'washsurface'),
      ('rug','Claret woven runner ground','#632f3a',.92,0,'fabric'),('border','Warm ivory runner border','#cab78b',.89,0,'border'),
      ('pattern','Sage geometric woven medallions','#617464',.93,0,'pattern')]:
        m=kit.matp(label,col,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;M[key]=m

def rect(x0,x1,y0,y1,z):return[(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)]
def rect_shell(name,outer0,outer1,inner1,inner0,mat):return loft(name,[outer0,outer1,inner1,inner0],mat,caps=False)

def canopy():
    setup()
    rect_shell('Open tapered canopy shell',rect(-.46,.46,-.40,.34,1.630),rect(-.20,.20,.015,.34,2.14),rect(-.190,.190,.025,.330,2.14),rect(-.448,.448,-.388,.330,1.630),'iron')
    rect_shell('Rolled lower canopy rim',rect(-.47,.47,-.410,.35,1.610),rect(-.47,.47,-.410,.35,1.648),rect(-.447,.447,-.387,.328,1.648),rect(-.447,.447,-.387,.328,1.610),'brass')
    rect_shell('Hollow upright flue',rect(-.20,.20,.015,.34,2.140),rect(-.20,.20,.015,.34,2.82),rect(-.19,.19,.025,.330,2.82),rect(-.19,.19,.025,.330,2.140),'iron')
    for z in [2.20,2.76]:
        rect_shell('Flue seam collar',rect(-.208,.208,.007,.348,z),rect(-.208,.208,.007,.348,z+.026),rect(-.198,.198,.017,.338,z+.026),rect(-.198,.198,.017,.338,z),'brass')
    for x in [-.34,.34]:
        box('Lower wall-bearing plate',(x,.35,1.73),(.10,.02,.23),'iron',.003)
        beam('Diagonal canopy bearing bracket',(x,.34,1.64),(math.copysign(.328,x),.22,1.84),.026,.026,'iron')
        for z in [1.65,1.81]:keep(kit.cylinder('Wall plate brass bolt',(x,.331,z),.012,.025,M['brass'],'Y',12))
    box('Upper flue wall bracket',(0,.35,2.63),(.45,.02,.075),'iron',.003)
    for x in [-.215,.215]:keep(kit.cylinder('Upper support bolt',(x,.332,2.63),.009,.024,M['brass'],'Y',10))
    for x in [-.39,-.26,-.13,0,.13,.26,.39]:keep(kit.cylinder('Rim rivet',(x,-.414,1.628),.006,.008,M['brass'],'Y',10))
    DATUM.update(role='period-range-canopy',defaultElevationMm=1610,hostId='rpg-mansion-kitchen-cast-iron-range-750-01',hobTopMm=863.5,canopyUndersideMm=1610,minimumHobClearanceMm=746.5,wallPlaneBlenderY=.36,openThroatMm=[380,305],staticLimit='Open hollow canopy/flue and wall-bearing brackets. No heat, exhaust, ventilation or engineering capacity claim.')

def washing():
    setup()
    for x in [-.275,.275]:
      for y in [-.18,.18]:
        box('Stand timber upright',(x,y,.2325),(.06,.06,.465),'oak',.005)
    box('Stand bottom stretcher',(0,0,.145),(.59,.045,.048),'oak',.004)
    for x in [-.275,.275]:box('Stand lower side rail',(x,0,.15),(.052,.40,.060),'oak',.004)
    for y in [-.18,.18]:box('Tub underfloor bearer',(0,y,.479),(.64,.052,.050),'oak',.004)
    for x in [-.275,.275]:box('Stand side brace',(x,0,.43),(.05,.43,.065),'oak',.003)
    rings=[ellipse(.66,.44,.504,n=48),ellipse(.745,.535,.845,n=48),ellipse(.764,.554,.854,n=48),ellipse(.756,.546,.870,n=48),ellipse(.714,.504,.870,n=48),ellipse(.708,.498,.848,n=48),ellipse(.617,.397,.525,n=48)]
    ob=loft('Hollow rolled-rim wash tub',rings,'zinc',True);ob['functionalRole']='open-wash-cavity'
    # Board lower back corner touches the .525m actual basin floor. Its two attached cleats rest on the rear rim.
    theta=math.radians(20);v=Vector((0,math.sin(theta),math.cos(theta)));normal=Vector((0,math.cos(theta),-math.sin(theta)));A=Vector((0,.056,.525+.02*math.sin(theta)))
    def boardbox(name,xc,vc,tc,size,material,r=.002):
        o=box(name,(0,0,0),size,material,r)
        for p in o.data.vertices:p.co=A+Vector((xc+p.co.x,0,0))+v*(vc+p.co.z)+normal*(tc+p.co.y)
        return o
    for x in [-.162,.162]:boardbox('Washboard side stile',x,.340,0,(.036,.04,.68),'soapwood',.004)
    for z in [.033,.635]:boardbox('Washboard cross rail',0,z,0,(.30,.04,.055),'soapwood',.004)
    boardbox('Washboard zinc panel backing',0,.30,0,(.30,.012,.48),'rub',.001)
    # Corrugations sit against the outward-facing zinc backing, all spanning both side stiles.
    for j in range(17):
        z=.080+j*.025
        o=keep(kit.cylinder('Washboard horizontal rubbing rib',(0,0,0),.009,.304,M['rub'],'X',12))
        for p in o.data.vertices:p.co=A+Vector((p.co.x,0,0))+v*(z+p.co.z)+normal*(-.012+p.co.y)
    board_parts=[o for o in PARTS if o.name.startswith('Washboard')]
    board_min=min(v.co.z for o in board_parts for v in o.data.vertices)
    board_shift=.525-board_min
    for o in board_parts:
        for p in o.data.vertices:p.co.z+=board_shift
    A.z+=board_shift
    for x in [-.162,.162]:box('Washboard rim-bearing cleat',(x,.225,.880),(.030,.070,.020),'soapwood',.001)
    for side in [-1,1]:
        path=[(side*(.342+.1046*math.cos(-math.pi/2+math.pi*j/24)),.070*math.sin(-math.pi/2+math.pi*j/24),.780)for j in range(25)]
        ob=sweep('Tub side lifting loop',path,.008,'iron',12);ob['functionalRole']='wall-seated-lifting-loop'
    DATUM.update(role='manual-wash-tub-and-board',defaultElevationMm=0,tubCavityFloorMm=525,tubRimTopMm=870,tubClearOpeningMm=[708,498],boardTiltFromVerticalDegrees=20,boardLowestCornerMm=525,boardRimCleatUndersideMm=870,boardLowerOriginM=list(A),boardAxisM=list(v),boardNormalM=list(normal),standBearerTopMm=504,tubUndersideMm=504,staticLimit='Open empty basin, tilted zinc-ribbed timber washboard, timber stand and lifting loops. No water, washing motion or cloth simulation.')

def drying():
    setup()
    # Two pairs of independently editable timber legs, offset in X at the pivots.
    legs=[];pivots=[]
    for side in [-1,1]:
      cx=side*.405
      for forward in [-1,1]:
        x=cx+forward*.023;A=Vector((x,forward*.395,.0064));B=Vector((x,0,1.18));u=(B-A).normalized();cross=Vector((0,u.z,-u.y));rings=[]
        for p in [A,B]:rings.append([p+Vector((sx*.037/2,0,0))+cross*sy*.04/2 for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]])
        ground=min(p.z for p in rings[0])
        for p in rings[0]:p.z=ground
        ob=loft('Drying frame hinged timber leg',rings,'oak');ob['functionalRole']='grounded-hinged-leg';legs.append(dict(x=x,fromM=list(A),toM=list(B)))
      keep(kit.cylinder('Drying frame pivot pin',(cx,0,1.18),.018,.114,M['brass'],'X',12))
      pivots.append([cx,0,1.18])
      for dx in [-.057,.057]:keep(kit.cylinder('Drying frame pivot washer',(cx+dx,0,1.18),.025,.006,M['brass'],'X',12))
    rods=[]
    for forward in [-1,1]:
      for z in [.265,.495,.725,.955]:
        y=forward*.395*(1-(z-.0064)/(1.18-.0064));x0=-.405+forward*.023;x1=.405+forward*.023
        ob=sweep('Round timber drying rod',[(x0,y,z),(x1,y,z)],.014,'oak',12);ob['functionalRole']='supported-drying-rod';rods.append(dict(fromM=[x0,y,z],toM=[x1,y,z],radiusMm=14))
    # Spread-limit folding links are pinned to the leg positions at this displayed pose.
    for side in [-1,1]:
      x=side*.467;z=.555;y=.395*(1-(z-.0064)/(1.18-.0064))
      beam('Pinned spread-limit brace front',(x,-y,z),(x,0,z-.012),.018,.012,'iron')
      beam('Pinned spread-limit brace rear',(x,0,z-.012),(x,y,z),.018,.012,'iron')
      for yy,zz in [(-y,z),(0,z-.012),(y,z)]:keep(kit.cylinder('Spread brace pin',(x,yy,zz),.010,.03,M['brass'],'X',12))
      # Endpoint pins reach the timber centre, not a floating end cap.
      for forward in [-1,1]:sweep('Brace endpoint bearing pin',[(side*.405+forward*.023,forward*y,z),(x,forward*y,z)],.006,'brass',10)
    DATUM.update(role='manual-laundry-drying-frame',defaultElevationMm=0,legs=legs,pivotsM=pivots,rodEndpoints=rods,displayedState='deployed A-frame',staticLimit='Visible pins, washers and spread-limit links depict the deployed frame. No folding animation, hinge solver or cloth simulation. No load-bearing certification.')

def runner():
    setup()
    box('Thick woven runner body',(0,0,.0035),(.760,3.000,.007),'rug',.001)
    # Modeled low-relief borders and motifs remain below an 8mm walking plane.
    for x in [-.343,.343]:box('Outer woven border',(x,0,.0073),(.018,2.888,.0006),'border',0)
    for y in [-1.453,1.453]:box('End woven border',(0,y,.0073),(.704,.018,.0006),'border',0)
    for x in [-.308,.308]:box('Inner sage border',(x,0,.0073),(.009,2.807,.0006),'pattern',0)
    for y in [-1.408,1.408]:box('Inner sage end border',(0,y,.0073),(.625,.009,.0006),'pattern',0)
    def diamond(name,cy,w,d,thick,mat):
        def ring(ww,dd,z):return[(-ww/2,cy,z),(0,cy-dd/2,z),(ww/2,cy,z),(0,cy+dd/2,z)]
        loft(name,[ring(w,d,.007),ring(w,d,.0076),ring(w-2*thick,d-2*thick,.0076),ring(w-2*thick,d-2*thick,.007)],mat,caps=False)
    for y in [-.88,0,.88]:
        diamond('Ivory geometric woven medallion',y,.43,.65,.016,'border');diamond('Sage inner medallion',y,.30,.47,.018,'pattern')
        box('Medallion small centre',(0,y,.0073),(.025,.05,.0006),'border',0)
    for y in [-1.28,-.44,.44,1.28]:diamond('Small spacer medallion',y,.10,.15,.010,'border')
    DATUM.update(role='narrow-hall-runner',defaultElevationMm=0,maximumWalkingPlaneMm=7.6,demonstratedHallWidthMm=1250,existingRugFootprintMm=[1400,2000],runnerFootprintMm=[760,3000],sideFloorMarginMm=245,staticLimit='Fixed low-relief woven surface. No cloth deformation, foot collision or slip resistance claim. Existing rectangular rug cannot fit this1250mm hall in either rotation.')

SPECS=[('period-range-canopy',canopy,'鋳鉄レンジ用の煙除けフード','range-hood'),('manual-wash-tub-board',washing,'木台と洗濯板付き手洗い桶','laundry'),('hinged-timber-drying-frame',drying,'折り畳み式木製物干しの展開状態','laundry'),('narrow-hall-runner',runner,'細い廊下用の幾何文様ランナー','rug')]
