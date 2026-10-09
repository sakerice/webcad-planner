"""Original garden joinery, masonry and hollow water fixture."""
from common import *

def xz_prism(name,outline,depth,cy=0,mat='wood'):
    n=len(outline);verts=[(x,cy+y,z)for y in [-depth/2,depth/2]for x,z in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
    return mesh(name,verts,faces,mat)

def halfpost(name,lo,hi,apex_right=True):
    return xz_prism(name,[(lo,0),(hi,0),(hi,1.405 if apex_right else 1.352),(lo,1.352 if apex_right else 1.405)],.104)

def fence_common():
    halfpost('Left inward half post',-.910,-.858,False);halfpost('Right inward half post',.858,.910,True)
    DATUM.update(installation={'mount':'ground','modulePitchM':1.820,'joinBoundaryX':[-.910,.910],'postDepthM':.104,'apexHeightM':1.405,'note':'Half-posts pair at straight joints. Outer free ends need terminal half-post accessories; right-angle joints need the 103 mm corner adapter. Static hand assembly, no automatic snapping.'})

def lattice():
    fence_common()
    for z in [.190,1.270]:box('Lattice horizontal structural rail '+str(z),(0,0,z),(1.736,.072,.082),'wood',0)
    for x in [-.821,.821]:box('Lattice side stile '+str(x),(x,0,.730),(.070,.060,1.08),'wood',0)
    for sign in [-1,1]:
        for k in range(-8,9):
            intercept=.730+k*.192;points=[]
            for x in [-.794,.794]:
                z=sign*x+intercept
                if .221<=z<=1.239:points.append((x,z))
            for z in [.221,1.239]:
                x=(z-intercept)/sign
                if -.794<x<.794:points.append((x,z))
            if len(points)<2:continue
            y=-.010 if sign<0 else .010;a,b=points[0],points[1]
            ob=beam('Clipped diagonal lattice %d %d'%(sign,k),(a[0],y,a[1]),(b[0],y,b[1]),.026,.020)
            for p in [a,b]:CONTACTS.append(dict(kind='lattice-endpoint',pointM=[p[0],y,p[1]],requiredBoundary={'x':.794,'z':[.221,1.239]},contactToleranceM=.014))
    DATUM['construction']='Two crossed diagonal strip layers clipped into continuous top/bottom rails and side stiles.'

def terminal():
    halfpost('Terminal matching half post',-.026,.026,True)
    DATUM.update(installation={'mount':'fence-accessory','joinWidthM':.052,'oppositeEndRotationDegrees':180,'note':'Usable mating half post closes a fence free end. Accessory; zero new core constructions.'})

def corner():
    box('Recessed right angle corner adapter',(0,0,.7025),(.103,.104,1.405),'iron',0)
    DATUM.update(installation={'mount':'fence-accessory','widthM':.103,'depthM':.104,'heightM':1.405,'note':'103 mm connector fills a paired right angle joint, with 1 mm outer face recess. Accessory; zero new core constructions.'})

def privacy_fence():
    fence_common()
    for x in [-.76,0,.76]:box('Rear vertical batten '+str(x),(x,.029,.73),(.052,.030,1.11),'wood',0)
    for z in [.22,1.24]:box('Rear horizontal rail '+str(z),(0,.015,z),(1.736,.036,.070),'wood',0)
    for j in range(6):box('Horizontal privacy board '+str(j),(0,-.025,.28+j*.18),(1.736,.050,.162),'wood',.001)
    DATUM['construction']='Six broad solid boards carried on three vertical battens and two rear rails.'

def deck():
    for x in [-.43,0,.43]:
        # Same closed stair profile is extruded along the width.
        outline=[(-.3325,0),(.3325,0),(.3325,.295),(.001,.295),(.001,.135),(-.3325,.135)]
        n=len(outline);verts=[(xx,y,z)for xx in [x-.0375,x+.0375]for y,z in outline]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
        ob=mesh('Grounded closed stepped stringer '+str(x),verts,faces);ob['functionalRole']='grounded-stringer'
    for level in [0,1]:
        z=.147+level*.160
        for j in range(3):
            y=-.278+level*.333+j*.109
            tread=box('Deck tread %d %d'%(level,j),(0,y,z),(1.10,.107,.026),'wood',.001)
            for x in [-.43,0,.43]:
                CONTACTS.append(dict(kind='tread-bearing',pointM=[x,y,z-.013],target='Grounded closed stepped stringer '+str(x),contactToleranceM=.0011))
                for yy in [y-.033,y+.033]:lathe('Inset tread screw '+str((x,yy,z)),x,yy,[(.0034,z+.011),(.0038,z+.0136)],'iron',6)
        box('Deck visible riser '+str(level),(0,-.322+level*.333,.067+level*.16),(1.03,.018,.134),'wood',.001)
    for y,z in [(-.26,.051),(.25,.21)]:box('Deck cross brace '+str(y),(0,y,z),(.94,.030,.065),'wood',0)
    DATUM.update(installation={'mount':'ground','treadTopHeightsMm':[160,320],'treadBearingSeatMm':1,'note':'Three continuous stepped stringers and physical risers/ties. Static design; no building-code, load or slip certification.'})

def pier():
    box('Brick pier foundation plinth',(0,0,.04),(.600,.600,.080),'stone',.004)
    core=box('Continuous structural masonry core',(0,0,.76),(.414,.414,1.36),'stone',0)
    for row in range(16):
        z=.115+row*.079
        # Alternating through corner bonding avoids four coincident cladding faces.
        for side in [-1,1]:
            if row%2:
                for j in range(3):box('Bonded pier front brick '+str((row,side,j)),(-.161+j*.161,side*.230,z),(.153,.060,.070),'brick',0)
                for j in range(2):box('Bonded pier side brick '+str((row,side,j)),(side*.230,-.096+j*.192,z),(.060,.184,.070),'brick',0)
            else:
                for j in range(2):box('Bonded pier front brick '+str((row,side,j)),(-.096+j*.192,side*.230,z),(.184,.060,.070),'brick',0)
                for j in range(3):box('Bonded pier side brick '+str((row,side,j)),(side*.230,-.161+j*.161,z),(.060,.153,.070),'brick',0)
    loft('Pier weathered sloping cap',[rounded_rect(0,0,w,d,r,z,n=1)for w,d,r,z in [(.55,.55,.01,1.365),(.59,.59,.015,1.395),(.59,.59,.015,1.43),(.47,.47,.015,1.48)]],'stone')
    for z in [.35,1.15]:
        box('Gate hinge backing plate '+str(z),(-.266,0,z),(.022,.105,.16),'iron',.002)
        beam('Gate pin bearing arm '+str(z),(-.260,0,z),(-.333,0,z),.024,.032,'iron')
        lathe('Male gate hinge pin '+str(z),-.333,0,[(.011,z-.022),(.011,z+.070)],'iron',10)
        box('Fence receiver stand off '+str(z),(.2665,0,z),(.065,.050,.070),'iron',0)
        box('Fence receiver plate '+str(z),(.300,0,z),(.030,.102,.13),'iron',.001)
        for y in [-.028,.028]:sweep('Through anchor '+str((y,z)),[(.203,y,z),(.321,y,z)],.006,'brass',6)
    DATUM.update(installation={'mount':'ground','gatePinCentersBlenderX':-.333,'gatePinLevelsM':[.35,1.15],'gatePinRadiusM':.011,'receiverOuterFaceX':.321,'foundationHalfWidthM':.300,'note':'Two actual male hinges and standoff receiver plates. Installation proof uses a separate excluded gate collar fixture; a functioning gate is not included.'})

def basin():
    box('Standpipe ground foundation',(0,0,.028),(.640,.720,.056),'stone',.003)
    rings=[rounded_rect(0,-.130,w,d,r,z,n=3)for w,d,r,z in [(.54,.53,.06,.056),(.57,.56,.068,.08),(.60,.59,.075,.248),(.60,.59,.075,.271),(.50,.49,.058,.271),(.47,.455,.052,.112),(.42,.405,.046,.086)]]
    bowl=loft('Continuous hollow standpipe stone basin',rings,'stone');bowl['functionalRole']='hollow-basin'
    box('Standpipe grounded iron pedestal',(0,.239,.106),(.165,.165,.100),'iron',.003)
    post=lathe('Standpipe cast iron upright',0,.239,[(.056,.080),(.047,.15),(.040,.86),(.053,.91),(.054,.955),(.035,.99)],'iron',16)
    for z in [.23,.75,.91]:lathe('Standpipe cast collar '+str(z),0,.239,[(.045,z-.015),(.050,z-.012),(.050,z+.012),(.045,z+.015)],'iron',16)
    tap=sweep('Standpipe brass spout',[(0,.222,.765),(0,.10,.765),(0,.033,.749),(0,-.002,.718)],[.019,.019,.017,.014],'brass',10)
    lathe('Standpipe tap valve',0,.138,[(.020,.752),(.020,.804),(.011,.818)],'brass',10)
    sweep('Standpipe tap cross handle',[(-.045,.138,.818),(.045,.138,.818)],.006,'brass',8)
    sweep('Standpipe tap cross grip',[(0,.104,.818),(0,.172,.818)],.006,'brass',8)
    # Grate occupies the rear shelf, leaving the broad basin cavity visibly open.
    for x in [-.18,-.12,-.06,0,.06,.12,.18]:box('Rear drain grate slat '+str(x),(x,.087,.267),(.012,.086,.012),'iron',0)
    for y in [.050,.126]:box('Rear drain grate cross rim '+str(y),(0,y,.267),(.384,.010,.010),'iron',0)
    lathe('Recessed basin drain',0,-.18,[(.019,.085),(.022,.088)],'brass',12)
    DATUM.update(cavity={'rimHeightM':.271,'internalFloorM':.086,'samplePointsBlenderXY':[[0,-.13],[-.12,-.20],[.12,-.20]],'tapOutletM':[0,-.002,.718],'tapOutletDirection':[0,-.790415,-.612571],'note':'Actual open hollow basin; outlet projects downward into the basin. Static plumbing, no fluid simulation.'},installation={'mount':'ground','note':'Common stone foundation carries hollow basin and separate cast standpipe.'})

