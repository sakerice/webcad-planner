"""Original two-core terrace/gate constructions, compatible with frozen garden inputs."""
from common import *

def support(a,b,p):
    CONTACTS.append(dict(kind='paired-surface-contact',parts=[a.name,b.name],pointM=list(p),contactToleranceM=.00015))

def terrace():
    pads={};beams={};joists={}
    for y in [-.60,.60]:
        for x in [-1.05,0,1.05]:
            pads[x,y]=box('Grounded limestone pad '+str((x,y)),(x,y,.052),(.24,.24,.104),'stone',.004)
        beams[y]=box('Continuous bearing beam '+str(y),(0,y,.149),(2.336,.10,.09),'wood',0)
        for x in [-1.05,0,1.05]:support(pads[x,y],beams[y],(x,y,.104))
    for x in [-1.05,-.60,0,.60,1.05]:
        joists[x]=box('Supported terrace joist '+str(x),(x,-.024 if x==0 else 0,.244),(.075,1.688 if x==0 else 1.736,.10),'wood',0)
        for y in [-.6,.6]:support(beams[y],joists[x],(x,y,.194))
    edge=box('Front end fascia',(0,-.884,.239),(2.4,.032,.110),'wood',0)
    for x in joists:support(edge,joists[x],(x,-.868,.24))
    for sign in [-1,1]:
        edge=box('Rear threshold clearance fascia '+str(sign),(sign*.865,.884,.239),(.67,.032,.110),'wood',0)
        for x in [sign*.60,sign*1.05]:support(edge,joists[x],(x,.868,.24))
    for x in [-1.184,1.184]:
        edge=box('Side fascia '+str(x),(x,0,.239),(.032,1.736,.110),'wood',0)
        for y in beams:support(edge,beams[y],(1.168 if x>0 else -1.168,y,.189))
    for j in range(12):
        y=-.825+j*.15
        board=box('Terrace walking board %02d'%j,(0,y,.307),(2.4,.146,.026),'wood',.001)
        for x in joists:
            support(board,joists[x],(x,min(y,.800)if x==0 else y,.294))
            for offset in ([-.043,-.017]if x==0 and j==11 else[-.043,.043]):
                lathe('Inset deck screw '+str((j,x,offset)),x,y+offset,[(.0034,.318),(.0038,.3206)],'iron',6)
    DATUM.update(defaultElevationMm=0,installation={'mount':'ground','boardTopMm':320,'screwCrownMm':320.6,'overallWidthMm':2400,'overallDepthMm':1800,'boardJointGapMm':4,'rearThresholdUndersideReceiverMm':{'clearWidth':1060,'centreJoistRearEndY':820,'boardUndersideZ':294,'acceptedWeatherNoseTopZ':290,'verticalClearance':4,'bayBottomElevation':230,'timberSillTop':320,'boardToSillJointGap':12},'stepTimberTopMm':320,'stepTotalHeightMm':320.6,'stepPlacementBlenderM':[0,-1.2325,0],'stepRearToTerraceFrontTimberGapMm':8,'supportedGroundPadCentresBlenderM':[[x,y,0]for y in [-.6,.6]for x in [-1.05,0,1.05]],'note':'Independent grounded platform, two beams, five joists and twelve walking boards. Match the accepted timber top and screw-crown datums separately. Static manual assembly; no native deck generation, load or code certification.'})

def gate():
    # Construction-space ground is z=0; gate starts 100 mm above ground.
    left=box('Gate hinge-side stile',(.09,0,.725),(.08,.060,1.25),'wood',.001)
    right=box('Gate latch-side stile',(1.11,0,.725),(.08,.060,1.25),'wood',.001)
    lower=box('Gate bottom rail',(.60,0,.175),(.94,.060,.15),'wood',.001)
    upper=box('Gate top rail',(.60,0,1.275),(.94,.060,.15),'wood',.001)
    for rail,z in [(lower,.175),(upper,1.275)]:
        support(left,rail,(.13,0,z));support(right,rail,(1.07,0,z))
    for j in range(9):
        x=.18+j*.105
        slat=box('Gate framed oak slat %02d'%j,(x,0,.725),(.070,.040,.950),'wood',.001)
        support(slat,lower,(x,0,.25));support(slat,upper,(x,0,1.20))
    # Back brace has cut, flat ends; its front face seats against the frame rear.
    brace=loft('Back diagonal compression brace',[[Vector((x,y,z))for x,z in [(.13,.10),(.205,.10),(1.07,1.35),(.995,1.35)]]for y in [.030,.054]],'wood')
    support(brace,lower,(.185,.030,.16));support(brace,upper,(1.03,.030,1.30))
    for z in [.35,1.15]:
        # These are newly authored delivered collars, not the old proof fixtures.
        collar=loft('Integral hollow female gate collar '+str(z),[ellipse(.042,.042,z+.012,0,0,24),ellipse(.042,.042,z+.055,0,0,24),ellipse(.024,.024,z+.055,0,0,24),ellipse(.024,.024,z+.012,0,0,24)],'brass',True,False)
        arm=box('Collar welded connecting arm '+str(z),(.0355,0,z+.030),(.029,.022,.027),'iron',0)
        # The arm end meets the collar at its true tangent and the wood stile side.
        support(arm,left,(.050,0,z+.030));support(arm,collar,(.021,0,z+.030))
        strap=box('Front forged hinge strap '+str(z),(.25,-.032,z+.030),(.40,.004,.045),'iron',.001)
        support(strap,left,(.09,-.030,z+.030))
        for x in [.075,.105,.18,.285,.39]:
            sweep('Recessed strap rivet '+str((x,z)),[(x,-.035,z+.030),(x,-.030 if x<.13 else -.020,z+.030)],.004,'brass',8)
            if x>.13:sweep('Strap spacer '+str((x,z)),[(x,-.030,z+.030),(x,-.020,z+.030)],.006,'iron',8)
    housing=box('Latch bolt mounting block',(1.112,-.045,1.17),(.060,.030,.034),'iron',.001)
    support(housing,right,(1.112,-.030,1.17))
    sweep('Latch sliding bolt',[(1.090,-.045,1.17),(1.184,-.045,1.17)],.006,'brass',12)
    sweep('Latch thumb lever',[(1.110,-.045,1.17),(1.110,-.081,1.17)],.005,'brass',8)
    DATUM.update(defaultElevationMm=100,installation={'mount':'gate-hinges','groundClearanceMm':100,'pinAxisConstructionBlenderXY':[0,0],'collarBottomConstructionMm':[362,1162],'collarTopConstructionMm':[405,1205],'collarInnerRadiusMm':12,'collarOuterRadiusMm':21,'acceptedPinRadiusMm':11,'nominalRadialClearanceMm':1,'acceptedPinArmBearingHeightsMm':[362,1162],'latchAxisConstructionBlenderM':[1.17,-.045,1.17],'note':'Closed static gate. Integral hollow collars bear on the accepted pier pin arms. Ground aperture is measured between supports; no animation, native gate linking or certified swing envelope.'})

def receiver():
    # All dimensions are in the same construction frame as the closed gate.
    # Existing right-pier receiver face lies at x=1.206 and its bolt tips at1.200.
    face=box('Strike receiver front mounting plate',(1.189,0,1.15),(.010,.110,.11),'iron',.001)
    for y in [-.044,.044]:
        stand=box('Receiver stand-off foot '+str(y),(1.200,y,1.15),(.012,.012,.080),'iron',0)
        support(face,stand,(1.194,y,1.15))
    # Square open socket axis X, centre y=-45mm; the12mm bolt has3mm radial gap.
    for y in [-.0585,-.0315]:box('Strike socket side '+str(y),(1.167,y,1.17),(.034,.009,.036),'iron',0)
    for z in [1.1565,1.1835]:box('Strike socket web '+str(z),(1.167,-.045,z),(.034,.018,.009),'iron',0)
    for y in [-.044,.044]:
        sweep('Strike face fastener '+str(y),[(1.181,y,1.15),(1.205,y,1.15)],.003,'brass',8)
    DATUM.update(defaultElevationMm=1095,installation={'mount':'gate-pier-receiver','constructionMountPlaneX':1.206,'constructionPoseUsesBottomCentreShift':True,'socketAxisConstructionBlenderM':[1.167,-.045,1.17],'socketClearOpeningMm':[18,18],'boltDiameterMm':12,'bearingOnAcceptedReceiverPlate':True,'counting':'Zero core. Separate reusable fitted strike accessory; not an extra gate construction.','note':'Two stand-off feet seat on the actual accepted receiver plate. They clear existing through-anchor tips and provide a hollow socket for the delivered leaf bolt.'})
