"""Twelve distinct construction designs for the walnut storage batch.

Catalogue targets are declared standard-catalogue dimensions, not verified
measurements of missing legacy model geometry. Construction is authored at
those dimensions; there is no post-hoc anisotropic rescaling.
"""
import math
from mathutils import Vector
B=None

def case(w,d,h,foot=.12,top=True):
    B.turned_feet([-w/2+.065,w/2-.065],[-d/2+.063,d/2-.063],foot)
    B.centerbox('Continuous moulded lower plinth',(0,0,foot+.018),(w-.012,d-.012,.045),'trim')
    for x in [-w/2+.034,w/2-.034]:B.centerbox('Carcass side board',(x,.008,(foot+h-.042)/2),(.026,d-.076,h-.042-foot))
    B.centerbox('Carcass back board',(0,d/2-.026,(foot+h-.042)/2),(w-.043,.025,h-.042-foot))
    if top:B.centerbox('Moulded crown cap',(0,0,h-.019),(w,d,.038),'trim',.004)
    return -d/2+.038

def shelf(w,d,z,mat='wood'):
    B.centerbox('Interior supporting shelf',(0,.004,z),(w-.061,d-.084,.021),mat)

def framed_door(name,x,y,z,w,h,pull=True):
    B.framed_panel(name,x,y,z,w,h)
    if pull:B.ring_pull(name+' latch',x+w*.30,y-.012,z)
    for zz in [z-h*.32,z+h*.32]:B.centerbox(name+' mounted hinge',(x-w/2+.005,y-.010,zz),(.026,.018,.032),'brass',.001)

def drawer(name,x,y,z,w,h,dual=False):
    B.centerbox(name+' walnut front',(x,y,z),(w,.031,h),'inset')
    for xx in ([x-w*.26,x+w*.26] if dual else [x]):B.ring_pull(name+' ring',xx,y-.010,z)
    B.centerbox(name+' upper bead',(x,y-.018,z+h/2-.009),(w-.018,.008,.006),'trim',.001)

def linen_press():
    w,d,h=1.003,.591,1.950;y=case(w,d,h,.14)
    for z in [.192,.456,.711,.930,1.398,1.851]:shelf(w,d,z)
    for z in [.321,.586]:drawer('Linen lower broad drawer',0,y,z,w-.083,.229,True)
    for x in [-w*.232,w*.232]:framed_door('Linen press upper panel door',x,y,1.322,w*.447,1.128)
    B.centerbox('Upper-and-lower case joining moulding',(0,0,.726),(w-.020,d-.016,.040),'trim')
    # Full-width press occupies a low drawers + tall door arrangement.
    for x in [-w/2+.047,w/2-.047]:B.centerbox('Press front pilaster',(x,y+.012,1.300),(.034,.032,1.156),'trim',.005)

def hall_cupboard():
    w,d,h=.830,.400,1.140;y=case(w,d,h,.10)
    for z in [.166,.490,.830,1.072]:shelf(w,d,z)
    # Two open louvered ventilating doors have real individual pitched slats.
    for x in [-.195,.195]:
        for xx in [x-.175,x+.175]:B.centerbox('Louver door stile',(xx,y,.621),(.030,.026,.878),'trim')
        for z in [.191,1.055]:B.centerbox('Louver door rail',(x,y,z),(.320,.031,.029),'trim')
        for i in range(13):
            obj=B.centerbox('Pitched ventilating louver',(x,y+.005,.241+i*.059),(.320,.035,.023),'inset',.001)
            angle=math.radians(22);cy=y+.005;cz=.241+i*.059
            for v in obj.data.vertices:
                yy,zz=v.co.y-cy,v.co.z-cz
                v.co.y=cy+yy*math.cos(angle)-zz*math.sin(angle)
                v.co.z=cz+yy*math.sin(angle)+zz*math.cos(angle)
            obj.data.update()
        B.ring_pull('Louver cupboard latch',x+.115,y-.015,.615)

def etagere():
    w,d,h=.800,.320,1.740
    # Entirely open turned-post étagère: five suspended edged shelves and
    # small rear guard rails, visibly unlike the enclosed cabinet carcasses.
    for x in [-.356,.356]:
        for y in [-.118,.118]:
            B.radial('Full-height turned etagere post',[(.023,0),(.029,.028),(.021,.100),(.017,1.580),(.023,1.640),(.018,1.688)],x,y,n=10)
    for z in [.155,.490,.835,1.181,1.575]:
        B.centerbox('Etagered edged open shelf',(0,0,z),(w,d,.031),'trim',.003)
        B.centerbox('Open shelf inset surface',(0,0,z+.018),(w-.061,d-.051,.005),'inset',.001)
        B.centerbox('Rear shelf guard',(0,.128,z+.057),(w-.102,.025,.055),'wood')
    for x in [-.356,.356]:
        for y in [-.118,.118]:B.radial('Turned brass top finial',[(.013,1.677),(.026,1.702),(.017,1.731),(.010,h)],x,y,'brass',12)

def corner_vitrine():
    w=d=.700;h=1.850
    # A five-sided corner footprint, with diagonal return cheeks and a
    # projecting central glass front. No full rectangular body behind it.
    ring=[(-.350,.350),(.350,.350),(.350,.095),(.210,-.350),(-.210,-.350),(-.350,.095)]
    def prism(name,outline,z0,z1,mat):
        n=len(outline);v=[(x,y,z) for z in [z0,z1] for x,y in outline]
        B.mesh(name,v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat,.002)
    for x in [-.285,.285]:
        for y in [.275]:B.radial('Corner cabinet rear foot',[(.026,0),(.031,.022),(.021,.100),(.030,.142)],x,y)
    B.radial('Corner cabinet front foot',[(.026,0),(.031,.022),(.021,.100),(.030,.142)],0,-.245)
    prism('Hexagonal corner plinth',ring,.125,.178,'trim')
    prism('Hexagonal corner cornice',ring,h-.039,h,'trim')
    B.centerbox('Corner vitrine rear board',(0,.325,1.003),(.659,.031,1.650))
    for sign in [-1,1]:
        B.centerbox('Corner rear return side board',(sign*.333,.2145,.9915),(.028,.233,1.651),'wood')
        B.bar('Angled corner return cheek',(sign*.320,.110,.171),(sign*.211,-.309,.171),.036,1.640,'wood')
        # bar's longitudinal orientation is not suitable for the vertical
        # cheek: construct an actual closed extruded angled plane instead.
        o=B.PARTS.pop();B.bpy.data.objects.remove(o,do_unlink=True)
        a=Vector((sign*.330,.110));c=Vector((sign*.206,-.324));normal=Vector((-(c-a).y,(c-a).x)).normalized()*.016
        outline=[tuple(a-normal),tuple(c-normal),tuple(c+normal),tuple(a+normal)]
        prism('Diagonal corner cabinet side',outline,.166,1.817,'wood')
    inner=[(x*.91,y*.91) for x,y in ring]
    for z in [.246,.650,1.040,1.439,1.779]:prism('Corner-shaped fitted shelf',inner,z-.012,z+.012,'trim')
    B.arch_frame('Corner vitrine central arched glazed door',0,.335,.403,1.425,-.328)
    for z in [.760,1.160,1.550]:B.centerbox('Corner glazing transom',(0,-.328,z),(.345,.028,.015),'trim',.001)
    B.centerbox('Corner glazing central muntin',(0,-.328,1.056),(.014,.028,1.385),'trim',.001)
    B.ring_pull('Corner glazed latch',.132,-.333,1.048)
    for z in [.511,1.493]:B.centerbox('Corner door mounted hinge',(-.196,-.326,z),(.024,.030,.034),'brass',.001)

def map_cabinet():
    w,d,h=1.366,.515,.934;y=case(w,d,h,.13)
    for i in range(7):shelf(w,d,.189+i*.102)
    for i in range(6):drawer('Map flat-file drawer '+str(i+1),0,y,.240+i*.102,w-.093,.084,True)
    B.centerbox('Flat-file top drawer case frieze',(0,y,.847),(w-.073,.030,.102),'wood')
    for x in [-w/2+.045,w/2-.045]:B.centerbox('Flat file outside stile',(x,y+.004,.523),(.032,.034,.672),'trim')

def music_cabinet():
    w,d,h=.750,.300,.800;y=case(w,d,h,.11)
    for z in [.160,.355,.738]:shelf(w,d,z)
    # Open lower slots for sheet music and upper sliding tambour shutter.
    for x in [-.192,0,.192]:B.centerbox('Music folio vertical separator',(x,.004,.256),(.020,d-.086,.191),'trim')
    for x in [-.342,.342]:B.centerbox('Tambour sliding jamb',(x,y+.004,.546),(.029,.038,.382),'trim')
    B.centerbox('Tambour supporting recessed backing',(0,y+.017,.546),(.659,.012,.382),'wood')
    for i in range(19):
        x=-.304+i*.0338
        B.centerbox('Rounded tambour shutter slat',(x,y+.005,.545),(.029,.022,.355),'inset',.005)
    B.centerbox('Tambour horizontal grasp rail',(0,y-.013,.531),(.218,.014,.021),'brass',.003)
    for x in [-.107,.107]:B.centerbox('Tambour pull mounting end',(x,y-.004,.531),(.010,.019,.021),'brass',.001)

def pedestal_cabinet():
    w,d,h=.316,.266,.764
    # Elliptical pedestal has a true curved wall, not a scaled square cabinet.
    def ellipse(rows,mat='wood'):
        rings=[[(rx*math.cos(math.tau*i/24),ry*math.sin(math.tau*i/24),z) for i in range(24)] for rx,ry,z in rows]
        return B.keep(B.kit.shell('Elliptical pedestal cabinet profile',rings,[B.M[mat]],[0]*(len(rings)-1)))
    ellipse([(.140,.117,0),(.154,.129,.025),(.141,.118,.057),(.125,.104,.103)],'trim')
    ellipse([(.126,.105,.091),(.126,.105,.687)],'wood')
    ellipse([(.134,.111,.684),(.158,.133,.719),(.158,.133,h)],'trim')
    # Segment door wraps on the forward ellipse, bounded between +/- 55 deg.
    steps=12;v=[]
    for z in [.132,.659]:
        for outer in [0,1]:
            rx=.127+outer*.004;ry=.106+outer*.004
            v.extend((rx*math.sin(-.95+1.90*i/steps),-ry*math.cos(-.95+1.90*i/steps),z) for i in range(steps+1))
    n=steps+1;f=[]
    for i in range(steps):f.extend([(i,i+1,2*n+i+1,2*n+i),(n+i,3*n+i,3*n+i+1,n+i+1),(i,n+i,n+i+1,i+1),(2*n+i,2*n+i+1,3*n+i+1,3*n+i)])
    f.extend([(0,2*n,3*n,n),(steps,n+steps,3*n+steps,2*n+steps)])
    B.mesh('Curved single pedestal cupboard door',v,f,'inset',.001)
    B.ring_pull('Pedestal mounted knob ring',0,-.110,.409)

def apothecary():
    w,d,h=.874,.469,1.059;y=case(w,d,h,.14)
    for z in [.204,.395,.585,.775,.971]:shelf(w,d,z)
    for row in range(4):
        for col in range(4):
            x=-.2985+col*.199;z=.298+row*.191
            B.centerbox('Apothecary individual drawer %d %d'%(row,col),(x,y,z),(.185,.030,.175),'inset')
            # Broad brass label plate and actual supported brass knob.
            B.centerbox('Drawer identification nameplate',(x,y-.016,z-.039),(.066,.003,.021),'brass',.001)
            B.rod('Apothecary knob mounting stem',(x,y-.015,z+.023),(x,y-.026,z+.023),.005)
            B.rod('Apothecary knob head',(x,y-.025,z+.023),(x,y-.031,z+.023),.010,n=12)
    for x in [-.396,-.199,0,.199,.396]:B.centerbox('Apothecary grid stile',(x,y+.016,.587),(.016,.030,.782),'trim',.001)

def blanket_chest():
    w,d,h=1.100,.600,.600
    # Board-and-batten lift lid blanket coffer, inset feet and visible side
    # dovetail ends distinguish it from a drawer or door-front cabinet.
    for x in [-.441,.441]:
        for y in [-.199,.199]:B.centerbox('Blanket chest block foot',(x,y,.059),(.069,.069,.118),'wood',.004)
    for i in range(5):
        x=-.411+i*.2055
        B.centerbox('Longitudinal lid board',(x,0,h-.021),(.202,d,.042),'inset',.003)
    # End breadboard caps set exact overall width and lid joints.
    for x in [-.531,.531]:B.centerbox('Lid breadboard end',(x,0,h-.022),(.038,d,.044),'trim')
    for y in [-.267,.267]:
        for i in range(3):B.centerbox('Blanket coffer horizontal wall board',(0,y,.216+i*.133),(w-.067,.034,.130),'wood',.002)
    for x in [-.516,.516]:B.centerbox('Blanket chest end board',(x,0,.349),(.034,d-.051,.403),'inset')
    for x in [-.506,.506]:
        for z in [.196,.271,.347,.423,.500]:B.centerbox('Visible dovetail end join',(x,-.286,z),(.032,.005,.040),'trim',.001)
    for x in [-.346,.346]:B.centerbox('Blanket lid rear brass hinge',(x,.284,.551),(.086,.023,.025),'brass',.002)
    B.centerbox('Coffer brass lock plate',(0,-.287,.458),(.070,.009,.081),'brass',.004)
    B.keyplate('Blanket coffer lock',0,-.293,.455)

def armoire():
    w,d,h=1.129,.773,2.213;y=case(w,d,h,.15,False)
    for z in [.210,1.860]:shelf(w,d,z)
    B.rod('Armoire interior hanging rail',(-.490,.092,1.763),(.490,.092,1.763),.012)
    for x in [-.258,.258]:
        B.centerbox('Continuous armoire door backing',(x,y+.017,1.037),(.495,.016,1.588),'wood')
        for z,hh in [(.701,.829),(1.493,.607)]:B.framed_panel('Armoire raised door field',x,y,z,.495,hh)
        B.centerbox('Continuous armoire door central rail',(x,y,1.166),(.495,.031,.038),'trim')
        B.ring_pull('Armoire door brass latch',x+(.166 if x<0 else -.166),y-.012,1.122)
    for x in [-.515,.515]:B.centerbox('Armoire front full-height pilaster',(x,y+.016,1.068),(.043,.045,1.682),'trim',.008)
    # Swept arched crown, on a continuous moulded backing and top board.
    outline=[(-w/2,h-.217),(w/2,h-.217),(w/2,h-.088)]+[(w/2*math.cos(math.pi*i/16),h-.088+.088*math.sin(math.pi*i/16)) for i in range(1,17)]
    B.extruded_outline('Swept armoire arch pediment',outline,-d/2,d/2,'trim',.002)
    B.centerbox('Armoire pediment lower step',(0,0,h-.219),(w-.012,d-.012,.038),'wood')
    B.centerbox('Armoire large back panel seam',(0,d/2-.011,1.153),(.006,.004,1.833),'trim',0)

def pigeonhole():
    w,d,h=1.200,.280,1.390;y=case(w,d,h,.13)
    # 3x4 fully open correspondence pigeonholes over two shallow drawers.
    for z in [.190,.429,.657,.886,1.115,1.339]:shelf(w,d,z,'trim')
    for x in [-.189,.189]:B.centerbox('Letter rack continuous divider',(x,.004,.884),(.020,d-.084,.918),'wood')
    for x in [-.279,.279]:drawer('Lower correspondence drawer',x,y,.300,.538,.181)
    for x in [-.574,.574]:B.centerbox('Letter rack front upright',(x,y+.016,.887),(.032,.030,.916),'trim',.003)

def sideboard():
    w,d,h=1.600,.450,.710;y=case(w,d,h,.12)
    for z in [.178,.395,.649]:shelf(w,d,z)
    for x in [-.363,.363]:B.centerbox('Sideboard interior division',(x,.004,.419),(.023,d-.087,.470))
    # Low credenza has glazed outside cabinets and an open central shelf bay.
    for x in [-.562,.562]:
        B.framed_panel('Sideboard clear glass framed door',x,y,.419,.367,.439,'glass')
        B.centerbox('Sideboard glass muntin',(x,y-.002,.419),(.014,.037,.382),'trim',.001)
        B.ring_pull('Sideboard glass door latch',x+(-.122 if x>0 else .122),y-.012,.430)
    for x in [-.136,.136]:B.centerbox('Central sideboard shelf divider',(x,.004,.278),(.016,d-.090,.186),'trim')
    B.centerbox('Sideboard central drawer',(0,y,.530),(.677,.031,.159),'inset')
    for x in [-.189,.189]:B.ring_pull('Sideboard middle drawer ring',x,y-.010,.530)

def add_specs(module):
    global B
    B=module
    return [
      ('linen-press','引出し台付きリネンプレス',(1003,591,1950),linen_press,'Two-part linen press with lower drawers, upper panel doors and case joining moulding'),
      ('louver-cupboard','通気羽板の玄関戸棚',(830,400,1140),hall_cupboard,'Ventilated hall cupboard with individually pitched louver slats'),
      ('open-etagere','五段のオープン飾り棚',(800,320,1740),etagere,'Open five-tier etagere with full-height turned posts and brass finials'),
      ('corner-vitrine','六角平面のコーナー展示棚',(700,700,1850),corner_vitrine,'True six-sided corner glass cabinet with fitted polygonal shelves'),
      ('map-flatfile','地図用の六段平引出し',(1366,515,934),map_cabinet,'Broad six-drawer map flat-file cabinet with thin full-width trays'),
      ('tambour-music','巻き戸の楽譜収納棚',(750,300,800),music_cabinet,'Tambour-shutter music cupboard over open folio compartments'),
      ('oval-pedestal-cabinet','楕円形の小型台座戸棚',(316,266,764),pedestal_cabinet,'Elliptical pedestal cupboard with a curved single segment door'),
      ('apothecary-chest','十六小引出しの薬種箪笥',(874,469,1059),apothecary,'Four-by-four apothecary drawer grid with attached brass nameplates and knobs'),
      ('blanket-coffer','板組みの毛布用長櫃',(1100,600,600),blanket_chest,'Board-and-batten lift-lid blanket coffer with breadboard lid ends and dovetail joints'),
      ('arched-armoire','曲線破風の衣装箪笥',(1129,773,2213),armoire,'Deep double-door armoire with swept arch pediment and hanging rail'),
      ('letter-pigeonhole','書簡仕分けの十二升棚',(1200,280,1390),pigeonhole,'Twelve open correspondence pigeonholes above two shallow drawers'),
      ('glazed-credenza','ガラス両端戸の低い飾り棚',(1600,450,710),sideboard,'Low glazed credenza with two outer glass cupboards and open central bays'),
    ]
