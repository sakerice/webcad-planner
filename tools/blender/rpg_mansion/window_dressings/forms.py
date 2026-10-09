"""Five original static window-dressing constructions. No imported geometry."""
from common import *
import common

def setup():
    reset()
    for key,label,color,rough,channel,metal in [('cloth','Wine woven curtain','#783e49',.83,'fabric',0),('drape','Deep teal drape','#45645d',.8,'fabric',0),('linen','Oatmeal woven linen','#c0ae88',.9,'fabric',0),('trim','Sewn warm trim','#a78b5c',.75,'trim',0),('oak','Oiled blind timber','#896344',.55,'wood',0),('cord','Cotton support tape','#e0d3b2',.88,'cord',0),('hardware','Antique brass hardware','#ab874c',.32,'metal',.75)]:
        mat=kit.matp(label,color,rough,metal);mat['finishChannel']=channel;mat.use_backface_culling=True;M[key]=mat

def cylinder(name,a,b,r,mat='hardware',n=16):return sweep(name,[a,b],r,mat,n)

def torus_x(name,x,y,z,major=.021,minor=.003):
    rings=[]
    for i in range(20):
        a=math.tau*i/20
        rings.append([(x+minor*math.sin(math.tau*j/6),y+(major+minor*math.cos(math.tau*j/6))*math.cos(a),z+(major+minor*math.cos(math.tau*j/6))*math.sin(a))for j in range(6)])
    vs=[p for row in rings for p in row];fs=[(i*6+j,i*6+(j+1)%6,((i+1)%20)*6+(j+1)%6,((i+1)%20)*6+j)for i in range(20)for j in range(6)]
    return mesh(name,vs,fs,'hardware',True)

def plate(name,x,z):
    box(name+' physical wall plate',(x,-.004,z),(.038,.008,.072),'hardware',.003)
    for dz in [-.023,.023]:cylinder(name+' screw head '+str(dz),(x,-.006,z+dz),(x,-.015,z+dz),.004,'hardware',10)

def bracket(name,x,z,depth=.14):
    plate(name,x,z)
    cylinder(name+' projecting arm',(x,-.004,z),(x,-depth,z),.009)
    cylinder(name+' upturned seat',(x,-depth,z),(x,-depth,z+.024),.009)

def cloth(name,x0,x1,bottom,top,mat,folds=8,depth=.025,ny=6,bulge=0,yoffset=0):
    nx=folds*8;vs=[];ys=[]
    for k in range(ny+1):
        t=k/ny;z=bottom+(top-bottom)*t
        row=[]
        for j in range(nx+1):
            u=j/nx;x=x0+(x1-x0)*u
            y=-.145+yoffset+depth*math.cos(math.tau*folds*u)*(1+.1*math.sin(math.pi*t))-bulge*math.sin(math.pi*t)
            row.append((x,y,z+.0025*math.sin(math.tau*folds*u)*(1-t)))
        ys.append(row)
    # A true 2mm thick folded fabric volume, with sewn closed perimeter.
    vs=[(x,y+offset,z)for offset in [-.001,.001]for row in ys for x,y,z in row]
    stride=nx+1;layer=stride*(ny+1);fs=[]
    for k in range(ny):
        for j in range(nx):
            a=k*stride+j;b=a+1;c=b+stride;d=a+stride
            fs.extend([(a,b,c,d),(layer+d,layer+c,layer+b,layer+a)])
    perimeter=list(range(stride))+[k*stride+nx for k in range(1,ny+1)]+list(range(ny*stride+nx-1,ny*stride-1,-1))+[k*stride for k in range(ny-1,0,-1)]
    fs.extend([(a,layer+a,layer+b,b)for a,b in zip(perimeter,perimeter[1:]+perimeter[:1])])
    ob=mesh(name,vs,fs,mat,False)
    ob['construction']='closed 2mm fabric shell with modeled pleats';ob['foldCount']=folds
    # Sewn hems follow the same actual pleated profile.
    for k,label in [(0,'weighted hem'),(ny,'reinforced heading')]:
        path=[(x,y-.0018,z)for x,y,z in ys[k]]
        sweep(name+' '+label,path,.003,'trim',6)
    return ys

def basic_datums(family,host,width,coverage,bottom,top,attach,detail):
    DATUM.update(constructionFamily=family,countingClass='new-construction',coreConstructionCount=1,variantOf=None,staticDisplayState='closed/deployed',host=host,installation=dict(mount='interior-wall',wallContactPlaneBlenderY=0.,attachmentAboveApertureMm=attach,defaultBottomElevationMm=bottom,originalFloorDatumM=0,proofRotationBlenderZDegrees=180,proofWallPlaneY=.12),fit=dict(apertureWidthMm=width,coverWidthMm=coverage,coverageHeightRangeMm=[bottom,top],sourceRule='curtain: within300, width+100..400'if'curtain'in family or'drape'in family else'screen: within200, width+0..100',widthSurplusMm=coverage-width,interpretation='Existing project object-knowledge placement test, not a building or safety standard'),constructionDetails=detail)

def short_pair():
    setup();bottom=.650;top=2.646;rod=2.690
    for x in [-.548,.548]:bracket('Curtain rod bracket '+str(x),x,rod-.024,.14)
    cylinder('Continuous curtain rod',(-.602,-.14,rod),(.602,-.14,rod),.012)
    for x in [-.602,.602]:
        cylinder('Turned rod finial '+str(x),(x-.008,-.14,rod),(x+.008,-.14,rod),.020)
    for idx,(a,b) in enumerate([(-.572,.008),(-.008,.572)]):
        rows=cloth('Closed short curtain panel '+str(idx),a,b,bottom,top,'cloth',6,.026,yoffset=-.022*idx)
        for n in range(7):
            x=a+(b-a)*n/6;y=rows[-1][n*8][1]
            torus_x('Curtain suspension ring %s %s'%(idx,n),x,-.14,rod-.0063)
            cylinder('Ring to heading hook %s %s'%(idx,n),(x,-.14,rod-.0273),(x,y,top),.003)
    basic_datums('short-paired-rod-curtain','raised-sill',920,1220,650,2710,90,'Two closed pleated panels, fourteen rod rings, sewn hems, continuous rod, finials and two screwed wall brackets. Cloth span1144mm; overlapped centre. No drawn-open asset counted.')
    DATUM['fit'].update(fabricCoverageWidthMm=1144,fabricCoverageRangeMm=[647.5,2646],bottomBelowApertureMm=150,topAboveApertureMm=46)

def tall_drape():
    setup();bottom=.080;top=2.795
    box('Traverse rail body',(0,-.113,2.826),(1.24,.032,.038),'hardware',.005)
    box('Traverse rail lower running channel',(0,-.130,2.808),(1.22,.014,.009),'hardware',.002)
    for x in [-.55,0,.55]:
        plate('Rail wall bracket '+str(x),x,2.818)
        box('Rail projecting support '+str(x),(x,-.061,2.818),(.028,.116,.015),'hardware',.003)
    rows=cloth('Single full-height traverse drape',-.605,.605,bottom,top,'drape',11,.027,8,.009)
    for n in range(12):
        x=-.605+1.21*n/11
        box('Track carrier '+str(n),(x,-.130,2.805),(.018,.015,.019),'hardware',.002)
        cylinder('Carrier fabric hook '+str(n),(x,-.13,2.805),(x,rows[-1][n*8][1],top),.003)
    cylinder('Draw wand attachment hook',(.583,-.130,2.809),(.583,-.145,2.798),.0035,'hardware',10)
    cylinder('Attached rigid draw wand',(.583,-.145,2.798),(.583,-.175,1.87),.004,'oak',10)
    basic_datums('full-height-traverse-drape','french',1040,1240,80,2845,76,'Single full-height11-fold track-hung cloth panel, twelve captive carriers, three screwed wall arms and attached rigid draw wand. Different support construction from paired ring curtain; no automatic opening.')
    DATUM['fit'].update(fabricCoverageWidthMm=1210,fabricCoverageRangeMm=[77.5,2795],floorGapMm=77.5,topAboveApertureMm=45)

def shade_support(name,w,top):
    box(name+' solid headrail',(0,-.088,top-.018),(w,.066,.045),'oak',.004)
    for x in [-w*.39,w*.39]:
        plate(name+' wall bracket '+str(x),x,top-.018)
        box(name+' stand-off '+str(x),(x,-.032,top-.018),(.025,.056,.020),'hardware',.002)

def roman():
    setup();w=1.0;bottom=.765;top=2.66;shade_support('Roman shade',w,top)
    # Continuous linen sheet with shallow pocketed folds, each supported by a real rear batten.
    ys=[bottom+(top-.07-bottom)*i/8 for i in range(9)];path=[]
    for i in range(8):
        z0,z1=ys[i:i+2]
        for k in range(5):
            t=k/5;path.append((-.128-.022*math.sin(math.pi*t),z0+(z1-z0)*t))
    path.append((-.128,ys[-1]));n=len(path);vs=[]
    for offset in [-.001,.001]:
        for x in [-.485,.485]:vs.extend((x,y+offset,z)for y,z in path)
    fs=[]
    for i in range(n-1):fs.extend([(i,i+1,n+i+1,n+i),(2*n+i,3*n+i,3*n+i+1,2*n+i+1)])
    for side in [0,n]:
        for i in range(n-1):fs.append((side+i,side+2*n+i,side+2*n+i+1,side+i+1))
    fs.extend([(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)])
    mesh('Continuous pocketed Roman linen',vs,fs,'linen')
    for k,z in enumerate(ys):
        cylinder('Rear sewn-in horizontal batten '+str(k),(-.478,-.1245,z),(.478,-.1245,z),.004,'oak',10)
    for x in [-.30,.30]:
        box('Rear lift support tape '+str(x),(x,-.122,(bottom+top-.07)/2),(.019,.002,top-.07-bottom),'cord',0)
        cylinder('Rear lift cord '+str(x),(x,-.111,bottom),(x,-.111,top-.02),.002,'cord',6)
    box('Roman weighted bottom rail',(0,-.127,bottom),(.988,.025,.030),'oak',.004)
    box('Fabric head attachment strip',(0,-.121,top-.052),(.97,.010,.041),'linen',.002)
    basic_datums('roman-batten-shade','raised-sill',920,1000,750,2664.5,42,'Continuous linen folded over nine physical battens, two rear lift tapes/cords, fabric head attachment, weighted hem and screwed headrail brackets. Fully lowered static state.')
    DATUM['fit'].update(fabricCoverageWidthMm=970,fabricCoverageRangeMm=[765,2610],bottomBelowApertureMm=35,topAboveApertureMm=10)

def venetian():
    setup();w=1.;top=2.676;bottom=.775;shade_support('Venetian blind',w,top)
    count=45;pitch=.0415;angle=math.radians(57)
    for k in range(count):
        z=top-.073-k*pitch
        ob=box('Tilted timber slat %02d'%k,(0,0,0),(.977,.051,.0038),'oak',.001)
        # Tilt about X, then bake. Repeated slats overlap in frontal projection.
        for v in ob.data.vertices:
            yy,zz=v.co.y,v.co.z;v.co.y=-.117+yy*math.cos(angle)-zz*math.sin(angle);v.co.z=z+yy*math.sin(angle)+zz*math.cos(angle)
        positive_winding(ob)
    last=top-.073-(count-1)*pitch
    for x in [-.315,.315]:
        for y in [-.133,-.101]:
            box('Continuous ladder tape %.3f %.3f'%(x,y),(x,y,(top-.030+last-.028)/2),(.014,.002,top-.030-(last-.028)),'cord',0)
        for k in range(count):
            z=top-.073-k*pitch
            cylinder('Ladder rung %.3f %s'%(x,k),(x,-.133,z-.009),(x,-.101,z-.009),.0015,'cord',6)
    box('Blind bottom weight bar',(0,-.117,last-.032),(.99,.048,.031),'oak',.003)
    cylinder('Tilt wand headrail pivot',(.463,-.103,top-.020),(.463,-.159,top-.045),.0045,'hardware',10)
    cylinder('Tilt wand',(.463,-.159,top-.04),(.463,-.159,1.86),.004,'oak',10)
    basic_datums('slatted-venetian-blind','raised-sill',920,1000,(last-.0475)*1000,2680.5,58,'Forty-five overlapping tilted timber slats, two front/back ladder tapes with rungs, bottom weight bar, tilt wand and two physical screwed headrail supports. Fixed privacy tilt only.')
    DATUM['fit'].update(slatCount=count,slatPitchMm=41.5,slatProjectionHeightMm=51*math.sin(angle)+3.8*math.cos(angle),slatCoverageWidthMm=977,slatCoverageRangeMm=[(last-.024)*1000,(top-.05)*1000])

def roller():
    setup();w=.70;top=2.285;bottom=1.070
    for x in [-.329,.329]:
        plate('Roller screen bracket '+str(x),x,top-.034)
        box('Roller end cheek '+str(x),(x,-.069,top-.025),(.014,.130,.064),'hardware',.003)
    cylinder('Cloth-wrapped roller',(-.32,-.103,top-.025),(.32,-.103,top-.025),.025,'linen',24)
    cylinder('Continuous supported roller axle',(-.346,-.103,top-.025),(.346,-.103,top-.025),.008,'hardware',16)
    for x in [-.342,.342]:cylinder('Roller axle end '+str(x),(x-.008,-.103,top-.025),(x+.008,-.103,top-.025),.012,'hardware',14)
    box('Deployed roller linen sheet',(0,-.127,(bottom+top-.025)/2),(.662,.002,top-.025-bottom),'linen',.0004)
    cylinder('Weighted hem rod',(-.336,-.127,bottom),(.336,-.127,bottom),.008,'oak',16)
    # Finite static pull, anchored to weighted hem; no dangling mechanism claim.
    cylinder('Central stitched pull tab',(0,-.132,bottom),(0,-.142,bottom-.035),.005,'cord',8)
    basic_datums('roller-fabric-screen','narrow-qa-fixture',640,700,1027,2293,60,'Cloth-wrapped roller and continuous tangent drop, axle ends, two wall-supported cheeks, weighted hem and sewn pull tab. Narrow utility-window QA fixture is excluded from products.')
    DATUM['fit'].update(fabricCoverageWidthMm=662,fabricCoverageRangeMm=[1070,2260],fixtureApertureMm=dict(width=640,bottom=1100,top=2200),topAboveApertureMm=60)

SPECS=[('short-paired-curtain',short_pair,'Short paired rod curtain','curtain'),('full-height-traverse-drape',tall_drape,'Full-height single traverse drape','curtain'),('roman-batten-shade',roman,'Roman batten linen shade','roller-screen'),('timber-venetian-blind',venetian,'Timber slatted Venetian blind','roller-screen'),('narrow-roller-screen',roller,'Narrow linen roller screen','roller-screen')]
