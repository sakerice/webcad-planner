"""Static timber mansion stair forms. No imported geometry or textures."""
from common import *
R=3/18;G=.28;W=1.0;T=.04;LAND=1.16;H=1.5

def prism_yz(name,x,w,outline,mat):
    # Explicit double-precision ear clipping prevents near-zero triangles along the repeated stair pitch line.
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    area=sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1]for i in range(len(outline)))
    if area<0:outline=list(reversed(outline))
    n=len(outline);remaining=list(range(n));tri=[]
    while len(remaining)>3:
        found=False
        for k,b in enumerate(remaining):
            a=remaining[k-1];c=remaining[(k+1)%len(remaining)]
            if cross(outline[a],outline[b],outline[c])<=1e-10:continue
            if any(all(v>=-1e-10 for v in [cross(outline[a],outline[b],outline[j]),cross(outline[b],outline[c],outline[j]),cross(outline[c],outline[a],outline[j])])for j in remaining if j not in (a,b,c)):continue
            tri.append((a,b,c));remaining.pop(k);found=True;break
        assert found,(name,remaining)
    tri.append(tuple(remaining))
    v=[(xx,y,z)for xx in (x-w/2,x+w/2)for y,z in outline]
    return mesh(name,v,[tuple(reversed(t))for t in tri]+[tuple(i+n for i in t)for t in tri]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)],mat)

def flight(n=9):
    L=(n-1)*G;rise=n*R
    # Closed sawtooth carriage: flat bearing ledges under each tread and a clipped lower chord.
    top=[(0,R-T)]
    for i in range(n-1):
        top.extend([((i+1)*G,(i+1)*R-T),((i+1)*G,(i+2)*R-T)])
    top.append((L+.06,rise-T))
    outline=[(0,.008),(min(.48,L),.008),(L+.01,max(.008,rise-T-.40)),(L+.01,rise-.18),(L+.06,rise-.18)]+list(reversed(top))
    strings=[]
    for side in (-1,1):
        st=prism_yz(('Left'if side<0 else'Right')+' continuous housed stringer',side*.54,.08,outline,'paint');strings.append(st)
        beam('Applied walnut outer stringer bead',(side*.584,.40,.065),(side*.584,L-.020,rise-.36),.016,.028,'walnut')
    for i in range(n-1):
        y=i*G;z=(i+1)*R
        tread=box('Oak tread %02d'%(i+1),(0,y+(G-.02)/2,z-T/2),(1.16,G+.02,T),'oak',.004)
        riser=box('Ivory closed riser %02d'%(i+1),(0,y+.012,z-(R+T)/2),(1.,.024,R-T),'paint',.001)
        for st in strings:contact(tread,st,(.54 if 'Right'in st.name else-.54,y+.14,z-T),'tread-on-housed-stringer')
        box('Applied bullnose %02d'%(i+1),(0,y-.028,z-.014),(1.16,.016,.028),'walnut',.006)
        # Small dark underside joist immediately beneath the walking tread.
        joist=box('Transverse tread bearer %02d'%(i+1),(0,y+.18,z-.071),(1.,.065,.062),'walnut',.001)
        contact(joist,tread,(0,y+.18,z-T),'underside-bearer')
    box('Top closed riser',(0,L-.012,rise-(R+T)/2),(1.,.024,R-T),'paint')
    box('Top landing transition tongue',(0,L+.03,rise-T/2),(1.16,.06,T),'oak',.001)
    # Rear end steel shoes and foot shoes are physical bearing interfaces, not a load rating.
    for x in (-.54,.54):
        box('Foot bearing plate',(x,.21,.004),(.08,.54,.008),'iron',.001)
        box('Head bearing plate',(x,L+.035,rise-.185),(.10,.04,.01),'iron',.001)
    DATUM.update(role='Closed-riser housed timber flight',riserCount=n,treadCount=n-1,riserM=R,goingM=G,riseM=rise,runM=L,clearWidthM=1.,bottomFinishedFloorM=0,topFinishedFloorM=rise,footPlaneM=0,headBearingUndersideM=rise-.19,headBearingPlaneM=rise-.18,notchedStringerBearingPlaneM=rise-.18,footPlateTopM=.008,footPlateRearExtensionM=.06,assemblyStartM=[0,0,0],assemblyEndM=[0,L,rise],upperTransitionTongueM=.06,headBearingNote='Place landing front edge60 mm beyond the last riser: the tongue meets it without deck overlap. Head shoe undersides at rise minus190 mm bear on the projecting ledge. Foot plates extend60 mm behind the first riser and bear on the preceding landing; under-stair passage is not claimed.')

def landing(w=1.16):
    # Plank surface, perimeter apron, cross joists and all-grounded braced legs.
    for i in range(8):box('Landing oak plank %02d'%i,(0,(i+.5)*LAND/8,H-.02),(w,LAND/8-.002,.04),'oak',.002)
    for x in (-w/2+.06,w/2-.06):box('Landing longitudinal apron',(x,LAND/2,H-.125),(.12,LAND,.17),'paint',.002)
    for y in (.06,LAND-.06):box('Landing transverse header',(0,y,H-.125),(w-.24,.12,.17),'paint',.002)
    for x in (-w/2+.09,w/2-.09):
        for y in (.09,LAND-.09):
            leg=box('Grounded square timber leg',(x,y,.655),(.12,.12,1.15),'paint',.003)
            box('Leg cap block',(x,y,H-.24),(.15,.15,.06),'walnut',.002)
            box('Leg plinth shoe',(x,y,.04),(.15,.15,.08),'walnut',.002)
    for x in (-w*.25,0,w*.25):box('Landing interior joist',(x,LAND/2,H-.125),(.06,LAND-.24,.17),'walnut',.001)
    for x in (-w/2+.09,w/2-.09):
        beam('Knee brace rear',(x,LAND-.09,.89),(x,LAND-.45,1.30),.065,.065,'walnut')
        beam('Knee brace front',(x,.09,.89),(x,.45,1.30),.065,.065,'walnut')
    # Accessed front/side header ledge: stair head shoes meet its top at 1310 mm.
    for y in (-.0025,LAND+.0025):box('Header receiver ledge',(0,y,1.295),(w+.02,.125,.03),'iron',.001)
    for x in (-w/2-.005,w/2+.005):box('Side receiver ledge',(x,LAND/2,1.295),(.07,LAND-.12,.03),'iron',.001)
    if w>2: # Additional center ground support avoids calling a stretched beam a distinct core.
        for y in (.09,LAND-.09):box('Wide span center ground leg',(0,y,.645),(.10,.10,1.29),'paint',.003)
    DATUM.update(role='Ground-supported framed timber landing',walkingSurfaceM=H,undersideDeckM=1.46,headerBottomM=1.29,receivingBearingTopM=1.31,walkingWidthM=w,walkingDepthM=LAND,assemblyStartM=[0,0,0],receivingFlightY=0,exitFlightY=LAND,groundPlaneM=0,clearGuardInsideWidthM=w-.16)

def newel_at(x,y,base,name='Turned square newel'):
    box(name+' foot',(x,y,base+.035),(.10,.10,.07),'walnut',.004)
    box(name+' brass collar',(x,y,base+.080),(.091,.091,.02),'brass',.002)
    box(name+' chamfered shaft',(x,y,base+.505),(.076,.076,.83),'walnut',.006)
    box(name+' upper collar',(x,y,base+.910),(.094,.094,.04),'walnut',.003)
    box(name+' cap',(x,y,base+.985),(.12,.12,.11),'walnut',.008)
    box(name+' finial foot',(x,y,base+1.043),(.056,.056,.014),'brass',.002)

def rake(n=9):
    L=(n-1)*G;slope=R/G
    # Rail module is authored on the right stringer center; normalisation is recorded.
    for y in (0,L):newel_at(.54,y,(y/G+1)*R)
    rail=sweep('Continuous raked walnut handrail',[(.54,0,R+.95),(.54,L,n*R+.95)],.035)
    base=sweep('Continuous rake lower rail',[(.54,0,R+.08),(.54,L,n*R+.08)],.018,'walnut',8)
    for j in range((n-1)*3):
        y=(j+.5)*G/3;z=(y/G+1)*R
        sp=lathe('Turned stair spindle %02d'%j,.54,y,z+.08,.87)
        contact(sp,rail,(.54,y,z+.95),'spindle-top-to-handrail')
        contact(sp,base,(.54,y,z+.08),'spindle-foot-to-rake-rail')
    # Foot supports follow the actual tread elevations and unite with lower rail.
    for i in range(n-1):
        y=i*G+.10;z=(i+1)*R
        shoe=box('Guard tread shoe %02d'%i,(.54,y,z+.010),(.085,.070,.020),'brass',.002)
        sweep('Guard supporting stub %02d'%i,[(.54,y,z+.01),(.54,y,(y/G+1)*R+.09)],.013,'walnut',8)
    DATUM.update(role='Raked turned spindle handrail with integral end newels',flightRisers=n,runM=L,riseM=(n-1)*R,handrailAbovePitchLineM=.95,handrailRadiusM=.035,railAxisX=.54,pairedFlightNominalClearWidthM=1.,minimumClearBetweenNewelCapsM=.96,maxNominalBalusterPitchM=G/3,lowerNewelBaseM=R,upperNewelBaseM=n*R,shoeOffsetFromRiserM=.10,upperHandrailCenterM=n*R+.95,lowerHandrailCenterM=R+.95,assemblyStartM=[0,0,0],mountNote='Right module uses authored x=540 mm. Left uses x translation -1080 mm, without mesh mirroring. Newel feet and shoes intentionally bear/seat into tread or transition tongue.')

def flat_segment(a,b,end_posts=True,name='Landing guard'):
    a,b=Vector(a),Vector(b);length=(b-a).length;u=(b-a).normalized()
    if end_posts:
        for q in (a,b):newel_at(q.x,q.y,0,name+' end newel')
    sweep(name+' continuous handrail',[a+Vector((0,0,.95)),b+Vector((0,0,.95))],.035)
    sweep(name+' bottom rail',[a+Vector((0,0,.11)),b+Vector((0,0,.11))],.02,'walnut',8)
    count=math.ceil(length/.095)
    for i in range(1,count):
        q=a+(b-a)*i/count
        lathe(name+' turned spindle %02d'%i,q.x,q.y,.11,.84)
    for t in (.25,.75):
        q=a+(b-a)*t;box(name+' brass socket',(q.x,q.y,.012),(.07,.07,.024),'brass',.002)
        sweep(name+' lower rail support',[(q.x,q.y,.018),(q.x,q.y,.12)],.014,'walnut',8)

def guard(shape='straight'):
    if shape=='straight':
        flat_segment((0,-.06,0),(0,1.16,0),False)
        newel_at(0,.58,0,'Midspan landing support')
    elif shape=='corner':
        flat_segment((-.54,-.06,0),(-.54,1.12,0),False,'West landing guard')
        newel_at(-.54,1.12,0,'North west corner post')
        flat_segment((-.54,1.12,0),(.58,1.12,0),False,'North landing guard')

    else:
        flat_segment((-1.16,-.06,0),(-1.16,1.12,0),False,'West return guard')
        newel_at(-1.16,1.12,0,'West back corner post')
        flat_segment((-1.16,1.12,0),(1.16,1.12,0),False,'Back return guard')
        flat_segment((1.16,1.12,0),(1.16,0,0),False,'East return guard')
        newel_at(1.16,1.12,0,'East back corner post')
        newel_at(0,1.12,0,'Back span intermediate post')
    DATUM.update(role='Horizontal landing guard '+shape,mountingPlaneM=0,handrailCenterM=.95,handrailRadiusM=.035,nominalGuardTopM=1.05,clearBoundaryOffsetM=.06,shape=shape,runM=1.08,assemblyStartM=[0,0,0],connectionNote='Horizontal rail ends join the integral raked newel shafts. Only intermediate/corner posts are included, avoiding duplicate posts at flight connections. The start of an upper flight has a vertical 166.667 mm transition carried by its solid newel shaft.')

def newel():
    newel_at(0,0,0,'Terminal connector newel')
    # Short square-ended receiver rails allow contact to flat rails after 60 mm setback.
    for x in (-1,1):
        box('Handrail receiving tenon',(x*.07,0,.95),(.08,.056,.056),'walnut',.004)
        box('Lower rail receiving tenon',(x*.07,0,.11),(.08,.036,.036),'walnut',.002)
        box('Cross handrail receiving tenon',(0,x*.07,.95),(.056,.08,.056),'walnut',.004)
        box('Cross lower rail receiving tenon',(0,x*.07,.11),(.036,.08,.036),'walnut',.002)
    DATUM.update(role='Terminal receiver newel accessory',mountingPlaneM=0,handrailCenterM=.95,receiverEndPlanesX=[-.11,.11],receiverEndPlanesY=[-.11,.11],lowerReceiverCenterM=.11,assemblyStartM=[0,0,0])
