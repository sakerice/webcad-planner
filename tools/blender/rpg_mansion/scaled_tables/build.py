"""Original measured mansion table family. Blender metres, -Y front, Z up.

No downloaded geometry, image maps, paid generation or global normalization.
Native named parts are saved before joining; release sources are also retained.
Run blender -b -t 4 --factory-startup --python .../build.py -- --only oval,kidney,drum
"""
import sys, math, json, hashlib, shutil, struct
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parents[1]));sys.path.insert(0,str(HERE.parent))
import model_kit as kit
from shape_kit import rounded_rect
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
WORK=HERE/'work'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews';kit.WORK_DIR=WORK
P={}

def palette():
    def mat(name,color,ch,rough=.43,metal=0):
        m=kit.matp(name,color,rough,metal);m['finishChannel']=ch;return m
    return dict(wood=mat('Walnut figured body','#563b2d','wood'),
      edge=mat('Walnut carved moulding','#765237','wood',.4),
      dark=mat('Walnut recessed joinery','#38271f','wood',.5),
      brass=mat('Antique brass fittings','#b69b5d','metal',.32,.75),
      leather=mat('Teal desk leather','#294d4b','leather',.69),
      baize=mat('Teal wool card baize','#274e45','fabric',.91),
      ivory=mat('Pale maple chess squares','#d2bc90','inlay',.48),
      mirror=mat('Polished silver mirror','#b9c8c6','metal',.08,1.0))

def mesh(name,verts,faces,mat,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    data.materials.append(P[mat]);ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
    for poly in data.polygons:poly.use_smooth=smooth and len(poly.vertices)==4
    return ob

def shell(name,rings,mat='wood',smooth=True):
    n=len(rings[0]);v=[p for r in rings for p in r]
    f=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1) for i in range(n)]
    f.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    return mesh(name,v,f,mat,smooth)

def loop_shell(name,rings,mat='wood'):
    n=len(rings[0]);v=[p for r in rings for p in r]
    f=[(k*n+i,k*n+(i+1)%n,((k+1)%len(rings))*n+(i+1)%n,((k+1)%len(rings))*n+i) for k in range(len(rings)) for i in range(n)]
    ob=mesh(name,v,f,mat,True)
    for p in ob.data.polygons:p.use_smooth=p.index//n in [0,2]
    return ob

def ellipse(w,d,z,x=0,y=0,n=48):
    return [(x+w*.5*math.cos(i*math.tau/n),y+d*.5*math.sin(i*math.tau/n),z) for i in range(n)]

def slab(name,w,d,z0,z1,x=0,y=0,mat='wood',n=48):
    c=.003
    return shell(name,[ellipse(w-.006,d-.006,z0,x,y,n),ellipse(w,d,z0+c,x,y,n),ellipse(w,d,z1-c,x,y,n),ellipse(w-.006,d-.006,z1,x,y,n)],mat)

def rect(name,w,d,z0,z1,x=0,y=0,mat='wood',r=.018):
    c=min(.003,(z1-z0)*.22)
    rings=[rounded_rect(x,y,w-.006,d-.006,r,z0,n=3),rounded_rect(x,y,w,d,r,z0+c,n=3),rounded_rect(x,y,w,d,r,z1-c,n=3),rounded_rect(x,y,w-.006,d-.006,r,z1,n=3)]
    return shell(name,rings,mat)

def lathe(name,rows,x=0,y=0,mat='wood',n=20):
    return shell(name,[[(x+r*math.cos(i*math.tau/n),y+r*math.sin(i*math.tau/n),z) for i in range(n)] for r,z in rows],mat)

def sweep(name,path,widths,depths,mat='wood',n=8):
    # Parallel-transport frames prevent twisting at a cabriole inflection.
    # Catmull-Rom centerline samples turn control points into continuous curves.
    original=[Vector(p) for p in path];dense=[];dw=[];dd=[]
    for k in range(len(path)-1):
        a=original[max(0,k-1)];b=original[k];c=original[k+1];d=original[min(len(path)-1,k+2)]
        for j in range(3):
            t=j/3
            dense.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
            dw.append(widths[k]*(1-t)+widths[k+1]*t);dd.append(depths[k]*(1-t)+depths[k+1]*t)
    dense.append(original[-1]);dw.append(widths[-1]);dd.append(depths[-1]);rings=[];previous=None
    for k,p in enumerate(dense):
        tangent=dense[min(k+1,len(dense)-1)]-dense[max(k-1,0)];tangent.normalize()
        if previous is None:
            side=tangent.cross(Vector((0,0,1)))
            if side.length<.01:side=Vector((1,0,0))
        else:side=previous-tangent*previous.dot(tangent)
        if side.length<.01:side=tangent.cross(Vector((0,1,0)))
        side.normalize();previous=side.copy();up=side.cross(tangent).normalized()
        rings.append([tuple(p+side*dw[k]*.5*math.cos(i*math.tau/n)+up*dd[k]*.5*math.sin(i*math.tau/n)) for i in range(n)])
    return shell(name,rings,mat)

def bead(name,ring,z,mat='brass',radius=.0025):
    rings=[]
    count=len(ring)
    for k in range(6):
        a=k*math.tau/6;r=[]
        for i,p in enumerate(ring):
            prev=Vector(ring[(i-1)%count]);nxt=Vector(ring[(i+1)%count]);t=nxt-prev
            normal=Vector((t.y,-t.x,0)).normalized()
            r.append(tuple(Vector((p[0],p[1],z))+normal*radius*math.cos(a)+Vector((0,0,radius*math.sin(a)))))
        rings.append(r)
    return loop_shell(name,rings,mat)

def pull(name,x,y,z,angle=0):
    # Attached 2-sided brass mounting stem and closed drop ring, no suspension.
    out=[]
    stem=kit.cylinder(name+' mounting boss',(x,y,z),.018,.009,P['brass'],axis='Y',sides=12);out.append(stem)
    bpy.ops.mesh.primitive_torus_add(major_radius=.026,minor_radius=.0038,major_segments=16,minor_segments=6,location=(x,y-.006,z-.021),rotation=(math.pi/2,0,0))
    ob=bpy.context.object;ob.name=name+' solid drop ring';ob.data.materials.append(P['brass'])
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for p in ob.data.polygons:p.use_smooth=True
    out.append(ob)
    if angle:
        c,s=math.cos(angle),math.sin(angle)
        for ob in out:
            for v in ob.data.vertices:v.co.x,v.co.y=c*v.co.x-s*v.co.y,s*v.co.x+c*v.co.y
    return out

def pedestal(x,y,top=.665,label='Pedestal',foot_count=3,spread=.42):
    parts=[lathe(label+' turned column',[(.09,.10),(.11,.12),(.11,.145),(.079,.162),(.067,.195),(.066,.25),(.108,.31),(.115,.36),(.093,.4),(.06,.46),(.056,.54),(.069,.59),(.12,.61),(.12,top)],x,y)]
    parts.append(lathe(label+' lower antique brass collar',[(.084,.163),(.084,.172)],x,y,'brass'))
    for k in range(foot_count):
        a=math.tau*k/foot_count+math.pi/2;dx,dy=math.cos(a),math.sin(a)
        path=[(x+dx*.075,y+dy*.075,.175),(x+dx*.16,y+dy*.16,.16),(x+dx*.27,y+dy*.27,.10),(x+dx*(spread-.06),y+dy*(spread-.06),.043),(x+dx*spread,y+dy*spread,.025)]
        parts.append(sweep(label+f' continuous splayed foot {k+1}',path,[.085,.082,.073,.07,.066],[.08,.07,.067,.060,.050]))
        # The swept endpoint reaches exactly z=0; metal cap sits on its surface.
        parts.append(slab(label+f' brass foot pad {k+1}',.068,.062,.0,.017,x+dx*spread,y+dy*spread,'brass',n=16))
    return parts

def oval():
    p=[slab('Oval dining top with rolled edge',2.20,1.12,.714,.760),
       slab('Oval under-top moulding',2.16,1.08,.693,.718,mat='edge'),
       slab('Oval recessed apron',2.02,.94,.648,.701,mat='dark')]
    p.append(bead('Oval brass apron stringing',ellipse(2.14,1.06,.701,n=48),.701))
    p+=pedestal(-.63,0,top=.667,label='Left pedestal',spread=.37)
    p+=pedestal(.63,0,top=.667,label='Right pedestal',spread=.37)
    p.append(rect('Mortised bridge stretcher between pedestals',1.29,.086,.206,.266,mat='edge',r=.024))
    p.append(rect('Underside longitudinal bearing rail',1.52,.19,.641,.703,mat='wood',r=.024))
    p.append(bead('Inset elliptical walnut border',ellipse(2.04,.96,.760,n=48),.756,'edge',.004))
    return p

def kidney_ring(w,d,z,n=64):
    # Analytic concave front curve; limits explicitly mapped at design time.
    raw=[]
    for i in range(n):
        a=i*math.tau/n;s=math.sin(a)
        raw.append((math.cos(a),s+.69*max(-s,0)**4))
    ymn=min(y for x,y in raw);ymx=max(y for x,y in raw)
    return [(x*w*.5,(y-ymn)/(ymx-ymn)*d-d*.5,z) for x,y in raw]

def kidney():
    p=[shell('Kidney shaped writing surface',[kidney_ring(1.294,.694,.724),kidney_ring(1.3,.70,.729),kidney_ring(1.3,.70,.765),kidney_ring(1.294,.694,.770)]),
       shell('Inset teal leather writing pad',[kidney_ring(1.13,.55,.768),kidney_ring(1.13,.55,.771)],'leather'),
       loop_shell('Continuous hollow kidney apron',[kidney_ring(1.23,.63,.656),kidney_ring(1.23,.63,.726),kidney_ring(1.19,.59,.726),kidney_ring(1.19,.59,.656)],'dark')]
    p.append(bead('Leather inset brass tooling border',kidney_ring(1.16,.58,.771),.769,'brass',.002))
    p.append(rect('Center drawer box',.40,.32,.617,.692,y=-.065,mat='dark',r=.014))
    p.append(rect('Concave desk center drawer face',.394,.030,.621,.687,y=-.227,mat='edge',r=.018))
    p+=pull('Center desk drawer pull',0,-.246,.665)
    for side in [-1,1]:
        for back in [-1,1]:
            x=side*.49;y=back*.185
            path=[(x+side*.018,y-back*.016,.026),(x-side*.034,y+back*.020,.12),(x-side*.053,y+back*.042,.29),(x+side*.009,y+back*.008,.50),(x,y,.731)]
            p.append(sweep(f'Kidney cabriole leg {side} {back}',path,[.066,.044,.037,.065,.064],[.052,.040,.038,.066,.061]))
            p.append(slab(f'Kidney brass shoe {side} {back}',.063,.053,.0,.019,x+side*.018,y-back*.016,'brass',n=16))
    return p

def sector_drawer(name,center,r=.447,z0=.59,z1=.680):
    n=14;span=math.radians(72)
    outer=[(r*math.sin(center-span/2+i*span/n),-r*math.cos(center-span/2+i*span/n)) for i in range(n+1)]
    inner=[((r-.014)*math.sin(center-span/2+i*span/n),-(r-.014)*math.cos(center-span/2+i*span/n)) for i in range(n,-1,-1)]
    shape=outer+inner
    return shell(name,[[(x,y,z0) for x,y in shape],[(x,y,z1) for x,y in shape]],'edge')

def drum():
    p=[slab('Library drum table rolled top',1.12,1.12,.704,.740),
       slab('Library drum undersurface rim',1.07,1.07,.687,.711,mat='edge'),
       lathe('Library cylindrical drawer carcass',[(.405,.562),(.443,.574),(.443,.684),(.42,.698)],n=48),
       lathe('Drum bottom cockbead',[(.444,.566),(.448,.57),(.448,.579),(.444,.582)],mat='edge',n=48)]
    for k in range(4):
        a=k*math.pi/2
        p.append(sector_drawer(f'Radial library drawer front {k+1}',a))
        p+=pull(f'Library drawer ring {k+1}',0,-.447,.648,angle=a)
    p+=pedestal(0,0,top=.572,label='Library pedestal',foot_count=4,spread=.43)
    p.append(bead('Round tabletop inset walnut line',ellipse(1.01,1.01,.738,n=48),.737,'edge',.003))
    return p

def straight_leg(name,x,y,top=.705,turned=True):
    if turned:
        return lathe(name,[(.026,0),(.030,.025),(.030,.050),(.022,.075),(.020,.20),(.026,.47),(.039,.53),(.038,.565),(.028,.59),(.030,top)],x,y,n=12)
    rings=[rounded_rect(x,y,w,w,.005,z,n=1) for w,z in [(.037,0),(.041,min(.05,top*.30)),(.052,top*.84),(.062,top)]]
    return shell(name,rings)

def bar_pull(name,x,y,z,reverse=False):
    sign=1 if reverse else -1;parts=[]
    for q in [-1,1]:parts.append(kit.box(name+f' mounting post {q}',(x+q*.028-.005,y+min(0,sign*.014),z-.005),(x+q*.028+.005,y+max(0,sign*.014),z+.005),P['brass'],radius=.001,segments=1))
    yy=y+sign*.014
    parts.append(kit.box(name+' chamfered grip',(x-.037,yy-.004,z-.004),(x+.037,yy+.004,z+.004),P['brass'],radius=.0015,segments=1))
    return parts

def drawer_face(name,x,y,z,w=.28,h=.115,reverse=False):
    p=[kit.box(name+' raised walnut drawer face',(x-w/2,y-.010,z-h/2),(x+w/2,y+.010,z+h/2),P['edge'],radius=.003,segments=1)]
    p+=bar_pull(name+' brass handle',x,y+(.008 if reverse else -.008),z,reverse)
    return p

def gateleg():
    p=[rect('Gateleg fixed center tabletop',.34,.88,.708,.740,r=.04)]
    for side in [-1,1]:
        p.append(rect(f'Gateleg open side leaf {side}',.48,.88,.708,.740,x=side*.410,mat='edge',r=.075))
        for back in [-1,1]:
            x=side*.117;y=back*.33
            p.append(straight_leg(f'Gateleg main turned leg {side} {back}',x,y,.714))
            p.append(rect(f'Gateleg side stretcher {side} {back}',.06,.68,.15,.192,x=x,r=.012))
        x=side*.43
        p.append(straight_leg(f'Gateleg leaf bearing swing leg {side}',x,0,.714))
        p.append(rect(f'Gateleg pivot gate lower rail {side}',.38,.05,.157,.202,x=side*.274,r=.01))
        p.append(rect(f'Gateleg pivot gate upper rail {side}',.38,.064,.633,.714,x=side*.274,r=.01))
    p.append(rect('Gateleg center underside apron',.29,.74,.631,.713,mat='dark',r=.02))
    return p

def tea():
    p=[rect('Tea tray table broad framed tray',.66,.44,.662,.692,r=.025),rect('Tea tray inner bed',.59,.37,.690,.694,mat='dark',r=.018)]
    # Solid raised rim attached to the tray. Crossing rails are fixed geometry.
    for x in [-.313,.313]:p.append(rect('Tea tray long raised edge',.025,.415,.685,.700,x=x,mat='edge',r=.009))
    for y in [-.203,.203]:p.append(rect('Tea tray end raised edge',.625,.026,.685,.700,y=y,mat='edge',r=.009))
    for y in [-.15,.15]:
        for sign in [-1,1]:p.append(sweep(f'Tea table fixed X-frame rail {y} {sign}',[(-sign*.245,y,.025),(0,y,.344),(sign*.245,y,.664)],[.045,.04,.045],[.05,.045,.05],n=8))
        p.append(kit.cylinder('Tea table fixed brass cross pin',(0,y,.344),.022,.056,P['brass'],axis='Y',sides=12))
    for x in [-.245,.245]:
        p.append(rect('Tea frame horizontal foot bearer',.082,.36,0,.037,x=x,r=.016))
        p.append(rect('Tea frame tray underside bearer',.071,.385,.632,.667,x=x,r=.014))
    return p

def card():
    p=[rect('Square card-table rolled walnut rim',.88,.88,.72,.755,r=.08),rect('Recessed teal baize card surface',.76,.76,.753,.756,mat='baize',r=.052)]
    for x in [-.35,.35]:
        for y in [-.35,.35]:p.append(straight_leg('Card table tapered leg',x,y,.726,False))
    for x in [-.35,.35]:p.append(rect('Card table side apron',.042,.744,.625,.726,x=x,mat='edge',r=.012))
    for y in [-.35,.35]:p.append(rect('Card table transverse apron',.744,.042,.625,.726,y=y,mat='edge',r=.012))
    for x in [-.364,.364]:
        for y in [-.364,.364]:p.append(slab('Card table antique brass corner stud',.023,.023,.753,.756,x,y,'brass',n=12))
    return p

def banquet():
    p=[]
    for k in range(5):p.append(rect(f'Banquet broad longitudinal plank {k+1}',3.00,.195,.717,.760,y=(k-2)*.20125,r=.012))
    for x in [-1.0,1.0]:
        p.append(rect('Trestle lower transverse sole',.21,.83,0,.10,x=x,mat='edge',r=.031))
        p.append(rect('Trestle upper tabletop bearer',.22,.89,.632,.722,x=x,r=.025))
        p.append(rect('Trestle low bridge-bearing cross rail',.17,.71,.230,.305,x=x,mat='edge',r=.018))
        for sign in [-1,1]:p.append(sweep('Continuous shaped banquet trestle upright',[(x,sign*.32,.08),(x,sign*.23,.30),(x,sign*.13,.64)],[.13,.12,.12],[.11,.11,.13],n=8))
    p.append(rect('Banquet interlocking low bridge stretcher',2.17,.106,.203,.315,mat='dark',r=.022))
    for x in [-1.103,1.103]:p.append(rect('Banquet through-tenon end wedge',.046,.141,.173,.345,x=x,mat='edge',r=.01))
    for x in [-1,1]:
        for y in [-.38,.38]:p.append(slab('Banquet brass sole cap',.16,.066,0,.020,x,y,'brass',n=12))
    return p

def octagon_ring(d,z,n=8):return ellipse(d,d,z,n=n)

def octagonal():
    p=[shell('Octagonal center table shaped top',[octagon_ring(1.094,.714),octagon_ring(1.10,.721),octagon_ring(1.10,.757),octagon_ring(1.094,.760)],'wood',False),
       shell('Octagonal recessed broad frieze',[octagon_ring(.94,.623),octagon_ring(.94,.718)],'edge',False)]
    for a in [math.pi/4,3*math.pi/4,5*math.pi/4,7*math.pi/4]:
        x=.29*math.cos(a);y=.29*math.sin(a);p.append(straight_leg('Octagonal table clustered turned support',x,y,.67))
    for a in [math.pi/4,-math.pi/4]:
        ob=rect('Octagonal table crossed low stretcher',.67,.057,.16,.21,r=.019);ob.rotation_euler.z=a;bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);p.append(ob)
    p.append(bead('Octagonal tabletop fine brass inlay',octagon_ring(1.008,.758),.758,'brass',.002))
    return p

def moon_ring(w,d,z,n=32):
    # Flat rear edge at +Y, crescent front facing Blender -Y.
    return [(w*.5*math.cos(i*math.pi/n),d*.5-d*math.sin(i*math.pi/n),z) for i in range(n+1)]

def halfmoon():
    p=[shell('Half-moon console shaped top',[moon_ring(1.194,.447,.781),moon_ring(1.2,.45,.786),moon_ring(1.2,.45,.817),moon_ring(1.194,.447,.820)]),
       loop_shell('Half-moon console continuous open apron',[moon_ring(1.10,.395,.690),moon_ring(1.10,.395,.786),moon_ring(1.062,.369,.786),moon_ring(1.062,.369,.690)],'edge')]
    for x,y in [(-.48,.177),(.48,.177),(0,-.173)]:p.append(straight_leg('Half-moon console fluted-style turned leg',x,y,.788))
    for sign in [-1,1]:p.append(sweep('Half-moon lower curving stretcher',[(sign*.48,.177,.18),(sign*.34,.03,.18),(0,-.173,.18)],[.046,.046,.046],[.046,.046,.046],n=8))
    return p

def chess():
    p=[rect('Chess pedestal thick square top',.65,.65,.692,.728,r=.022),rect('Chessboard underlay field',.525,.525,.726,.729,mat='dark',r=.006)]
    step=.06
    for x in range(8):
        for y in range(8):p.append(kit.box(f'Chess board square {x+1}-{y+1}',((x-4)*step,(y-4)*step,.728),((x-3)*step,(y-3)*step,.730),P['ivory' if (x+y)%2 else 'dark'],radius=0))
    p.append(lathe('Chess table slender turned pedestal',[(.08,.07),(.082,.11),(.05,.16),(.043,.37),(.065,.43),(.066,.47),(.039,.53),(.035,.64),(.11,.69),(.11,.707)],n=16))
    for k in range(3):
        a=k*math.tau/3+math.pi/2;dx,dy=math.cos(a),math.sin(a)
        p.append(sweep('Chess pedestal three curved feet',[(dx*.06,dy*.06,.10),(dx*.15,dy*.15,.085),(dx*.24,dy*.24,.025)],[.068,.061,.055],[.056,.05,.05],n=8))
        p.append(slab('Chess table brass foot shoe',.058,.052,0,.02,dx*.24,dy*.24,'brass',n=12))
    return p

def dumbwaiter():
    p=[lathe('Dumbwaiter continuous slender turned column',[(.070,.075),(.072,.13),(.040,.17),(.034,.30),(.058,.34),(.042,.38),(.035,.65),(.058,.69),(.041,.73),(.032,1.07),(.056,1.113)],n=16)]
    for i,(d,z) in enumerate([(.65,.34),(.57,.69),(.48,1.13)]):
        p.append(slab(f'Dumbwaiter tier {i+1} tray',d,d,z-.025,z,mat='wood',n=32))
        p.append(bead(f'Dumbwaiter tier {i+1} walnut raised lip',ellipse(d-.02,d-.02,z-.003,n=32),z-.004,'edge',.004))
    for k in range(3):
        a=k*math.tau/3+math.pi/2;dx,dy=math.cos(a),math.sin(a)
        p.append(sweep('Dumbwaiter tripod carved foot',[(dx*.055,dy*.055,.115),(dx*.14,dy*.14,.083),(dx*.25,dy*.25,.029)],[.07,.058,.055],[.064,.055,.050],n=8))
        p.append(slab('Dumbwaiter brass foot shoe',.059,.055,0,.02,dx*.25,dy*.25,'brass',n=12))
    return p

def dressing():
    p=[rect('Vanity dressing-table top',1.10,.50,.723,.760,r=.055),rect('Vanity central shallow drawer housing',1.015,.415,.620,.727,mat='dark',r=.024)]
    for x in [-.43,.43]:
        for y in [-.17,.17]:p.append(straight_leg('Vanity turned leg',x,y,.725))
    for x,w in [(-.337,.29),(0,.30),(.337,.29)]:p+=drawer_face('Vanity individual drawer',x,-.216,.674,w,.092)
    for x in [-.29,.29]:p.append(straight_leg('Vanity oval mirror bearing upright',x,.13,1.19,False));p[-1].data.transform(__import__('mathutils').Matrix.Translation((0,0,.76)))
    # Native oval mirror shell rotated into a vertical plane, with real hinge pins.
    frame=slab('Vanity oval framed mirror',.51,.63,-.018,.018,mat='edge',n=48)
    pane=slab('Vanity polished silver mirror inset',.448,.568,-.020,-.016,mat='mirror',n=48)
    for ob in [frame,pane]:
        for v in ob.data.vertices:
            x,y,z=v.co;v.co=(x,.13+z,1.075+y)
    p.extend([frame,pane])
    # Uprights authored directly from .76 to 1.20 (no tall floor-level posts).
    for ob in p:
        if 'mirror bearing upright' in ob.name:
            for v in ob.data.vertices:v.co.z=.760+(v.co.z-.760)/1.19*.440
    for x in [-.267,.267]:p.append(kit.cylinder('Vanity fixed mirror hinge pin',(x,.13,1.075),.015,.065,P['brass'],axis='X',sides=12))
    return p

def sloped_slab(name,w,d,zfront,zback,thick,mat='wood'):
    v=[(-w/2,-d/2,zfront-thick),(w/2,-d/2,zfront-thick),(w/2,d/2,zback-thick),(-w/2,d/2,zback-thick),(-w/2,-d/2,zfront),(w/2,-d/2,zfront),(w/2,d/2,zback),(-w/2,d/2,zback)]
    return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

def davenport():
    p=[sloped_slab('Davenport angled writing lid',.65,.65,.78,1.005,.035),
       sloped_slab('Davenport sloping inset teal leather',.555,.475,.8115,0.976,.002,'leather'),
       rect('Davenport upper pen-box compartment',.60,.122,1.0,1.08,y=.253,r=.023),
       rect('Davenport back support carcass',.57,.27,.125,.79,y=.18,mat='dark',r=.02)]
    for x in [-.243,.243]:
        p.append(rect('Davenport narrow side drawer pedestal',.145,.53,.058,.77,x=x,mat='wood',r=.024))
        cheek=sloped_slab('Davenport continuous sloping side cheek',.038,.60,.756,.964,.215,'edge')
        for v in cheek.data.vertices:v.co.x+=(-.292 if x<0 else .292)
        p.append(cheek)
        for y in [-.204,.204]:p.append(straight_leg('Davenport short pedestal foot',x,y,.11,False))
        for k in range(4):p+=drawer_face('Davenport drawer',x,-.266,.175+k*.151,.122,.118)
    p.append(rect('Davenport raised front book stop',.56,.027,.781,.803,y=-.298,mat='edge',r=.01))
    return p

def partners():
    p=[rect('Partners broad symmetrical leather desk top',1.80,.95,.723,.770,r=.055),rect('Partners teal leather inset field',1.65,.80,.768,.771,mat='leather',r=.027)]
    for x in [-.626,.626]:
        p.append(rect('Partners twin pedestal cabinet',.44,.823,.055,.726,x=x,mat='wood',r=.028))
        p.append(rect('Partners pedestal base plinth',.474,.859,0,.086,x=x,mat='edge',r=.026))
        for sign in [-1,1]:
            for k in range(3):p+=drawer_face('Partners opposite-face pedestal drawer',x,sign*.419,.190+k*.176,.38,.139,sign==1)
    p.append(rect('Partners central paired pencil-drawer box',.765,.852,.63,.727,mat='dark',r=.025))
    for sign in [-1,1]:p+=drawer_face('Partners front/rear pencil drawer',0,sign*.434,.677,.736,.075,sign==1)
    return p

def rolltop():
    p=[rect('Roll-top desk writing surface',1.40,.75,.723,.760,r=.035)]
    for x in [-.468,.468]:
        p.append(rect('Roll-top lower drawer pedestal',.34,.65,.065,.725,x=x,mat='dark',r=.025));p.append(rect('Roll-top pedestal floor plinth',.38,.69,0,.088,x=x,mat='edge',r=.024))
        for k in range(3):p+=drawer_face('Roll-top desk base drawer',x,-.327,.191+k*.171,.302,.135)
    # Quarter-arc tambour silhouette is a closed, fixed cover. Separate slats
    # retain visible joins but do not imply a working sliding mechanism.
    radius=.37;cy=.02;cz=.81
    for x in [-.66,.66]:
        outline=[(-.35,.760),(.35,.760),(.35,1.18),(.02,1.18)]
        outline+=[(cy+radius*math.cos(a),cz+radius*math.sin(a)) for a in [math.pi/2+i*(math.pi/2)/12 for i in range(1,13)]]
        v=[(x-.026,y,z) for y,z in outline]+[(x+.026,y,z) for y,z in outline];n=len(outline)
        f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        p.append(mesh('Roll-top solid curved hood cheek',v,f,'edge'))
    for k in range(16):
        a0=math.pi/2+k*(math.pi/2)/16+.003;a1=math.pi/2+(k+1)*(math.pi/2)/16-.003
        ring=[(-.634,cy+(radius-.012)*math.cos(a0),cz+(radius-.012)*math.sin(a0)),(.634,cy+(radius-.012)*math.cos(a0),cz+(radius-.012)*math.sin(a0)),(.634,cy+radius*math.cos(a0),cz+radius*math.sin(a0)),(-.634,cy+radius*math.cos(a0),cz+radius*math.sin(a0))]
        upper=[(-.634,cy+(radius-.012)*math.cos(a1),cz+(radius-.012)*math.sin(a1)),(.634,cy+(radius-.012)*math.cos(a1),cz+(radius-.012)*math.sin(a1)),(.634,cy+radius*math.cos(a1),cz+radius*math.sin(a1)),(-.634,cy+radius*math.cos(a1),cz+radius*math.sin(a1))]
        p.append(shell(f'Roll-top static tambour slat {k+1}',[ring,upper],'wood',False))
    p.append(rect('Roll-top rear wall',1.31,.041,.760,1.18,y=.33,mat='dark',r=.01))
    p.append(rect('Roll-top fixed hood crown board',1.31,.342,1.162,1.180,y=.179,mat='edge',r=.012))
    p.append(rect('Roll-top cover bottom handle rail',1.267,.025,.776,.821,y=-.336,mat='edge',r=.012));p+=bar_pull('Roll-top brass cover grip',0,-.346,.795)
    return p

SPECS=[
 ('oval','rpg-mansion-oval-pedestal-dining-01','楕円双柱ダイニングテーブル',(2200,1120,760),oval,['wood','metal'],'Two linked turned pedestals; a continuous mortised bridge and three shaped feet on each pedestal support a rolled oval top. Dining surface 760 mm.'),
 ('kidney','rpg-mansion-kidney-writing-desk-01','キドニー型ライティングデスク',(1300,700,771),kidney,['wood','metal','leather'],'Concave kidney silhouette, inset teal leather writing pad, four continuous cabriole legs and a closed center drawer face. Leather surface 771 mm. Static decorative asset; drawer is not animated.'),
 ('drum','rpg-mansion-drum-library-table-01','ドラム型ライブラリーテーブル',(1120,1120,740),drum,['wood','metal'],'Round library reading table at 740 mm, cylindrical radial drawer drum on a baluster and four shaped splayed feet. Drawer faces are static geometry.')]

SPECS.extend([
 ('gateleg','rpg-mansion-gateleg-drop-leaf-01','ゲートレッグ・ドロップリーフテーブル',(1300,880,740),gateleg,['wood'],'Static open-leaf gateleg arrangement, with two visibly separate leaves, four main turned legs and two supporting gate frames. No moving hinge simulation.'),
 ('tea','rpg-mansion-folding-tea-tray-table-01','クロス脚ティートレイテーブル',(660,440,700),tea,['wood','metal'],'Raised-rim tea tray on crossed folding-style rails, attached brass cross pins and floor bearers. Fixed open geometry, not a simulated folding mechanism.'),
 ('card','rpg-mansion-baize-card-table-01','ベーズ張りカードテーブル',(880,880,756),card,['wood','metal','fabric'],'Square card-playing table with inset wool baize, corner studs and four tapered legs. Playing surface 756 mm.'),
 ('banquet','rpg-mansion-trestle-banquet-table-01','トレッスル式バンケットテーブル',(3000,1000,760),banquet,['wood','metal'],'Long five-plank banquet surface carried by two shaped trestles, with low through-tenon bridge and end wedges. Dining surface 760 mm.'),
 ('octagonal','rpg-mansion-octagonal-center-table-01','八角形センターテーブル',(1100,1100,760),octagonal,['wood','metal'],'Octagonal broad frieze, clustered turned legs and crossed low stretchers; fine brass inlay follows the eight-sided top.'),
 ('halfmoon','rpg-mansion-half-moon-console-01','半月コンソールテーブル',(1200,450,820),halfmoon,['wood'],'Flat-backed semicircular console with a hollow curved apron, three turned legs and curved Y-shaped lower bracing. Rear edge faces the wall.'),
 ('chess','rpg-mansion-pedestal-chess-table-01','チェス盤付きペデスタルテーブル',(650,650,730),chess,['wood','metal','inlay'],'Physical 64-square walnut/maple chessboard on a slender turned pedestal and three curving feet. No playing pieces or game logic.'),
 ('dumbwaiter','rpg-mansion-three-tier-dumbwaiter-01','三段ダムウェイターテーブル',(650,650,1130),dumbwaiter,['wood','metal'],'Three progressively smaller circular serving trays at 340/690/1130 mm on one turned column and tripod base. Trays are static, not rotating.'),
 ('dressing','rpg-mansion-oval-mirror-dressing-table-01','楕円鏡付きドレッシングテーブル',(1100,500,1390),dressing,['wood','metal'],'Three-drawer vanity at 760 mm with a framed oval silvered mirror carried by two uprights and fixed side hinge pins. Mirror is a PBR metal surface, not a live reflection renderer.'),
 ('davenport','rpg-mansion-davenport-writing-desk-01','ダヴェンポート・ライティングデスク',(650,650,1080),davenport,['wood','metal','leather'],'Compact sloping leather writing lid with front book stop, upper pen box, paired narrow drawer pedestals and short tapered feet. All drawers/lid are fixed geometry.'),
 ('partners','rpg-mansion-partners-leather-desk-01','パートナーズ・レザーデスク',(1800,950,771),partners,['wood','metal','leather'],'Large double-sided partners desk with 14 visible drawer fronts, twin cabinet pedestals, two pencil drawers and broad leather field. Drawers are fixed geometry; surface 771 mm.'),
 ('rolltop','rpg-mansion-roll-top-writing-desk-01','ロールトップ・ライティングデスク',(1400,750,1180),rolltop,['wood','metal'],'Quarter-round closed tambour hood with individually authored slats, solid curved cheeks, twin lower drawer cabinets and attached handle rail. Static cover, not an operable roll-top mechanism.')])

def checkpoint(parts,stem):
    WORK.mkdir(parents=True,exist_ok=True)
    uv_cache={}
    for i,ob in enumerate(parts):
        ob['authoringPart']=True;ob['partIndex']=i
        center=sum((v.co for v in ob.data.vertices),Vector())/len(ob.data.vertices)
        key=(tuple(tuple(round(v.co[k]-center[k],6) for k in range(3)) for v in ob.data.vertices),tuple(tuple(p.vertices) for p in ob.data.polygons))
        if key in uv_cache:
            layer=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
            for dst,src in zip(layer.data,uv_cache[key]):dst.uv=src
            layer.active_render=True
            for other in list(ob.data.uv_layers):
                if other.name!=layer.name:ob.data.uv_layers.remove(other)
        else:
            kit.unwrap(ob);uv_cache[key]=[tuple(x.uv) for x in ob.data.uv_layers.active.data]
    bpy.context.scene['sourceAsset']=stem;bpy.context.scene['nativePartCount']=len(parts)
    bpy.context.scene['unitsAuthored']='metres, no normalized scaling';bpy.context.scene['front']='Blender -Y / glTF +Z'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(stem+'-authoring.blend')))
    native=bpy.data.scenes.new('Native authoring parts')
    native.unit_settings.system='METRIC';native['sourceAsset']=stem;native['nativePartCount']=len(parts)
    for part in parts:
        editable=part.copy();editable.data=part.data.copy();native.collection.objects.link(editable)
        editable.name=part.name+' [native]'
    native.view_layers[0].update()
    for part in native.objects:part.select_set(False,view_layer=native.view_layers[0])

def stamp_contract(path,stem):
    raw=path.read_bytes();jslen,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    doc=json.loads(raw[20:20+jslen]);doc['asset']['extras']={
       'front':'+Z','up':'+Y','units':'metres','origin':'bottom-centre',
       'provenance':'original','sourceAsset':stem,'staticAsset':True}
    data=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode();data+=b' '*((-len(data))%4)
    rest=raw[20+jslen:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(data)+len(rest))+struct.pack('<II',len(data),kind)+data+rest)

def export_active(obj,path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,use_active_scene=True,
       export_format='GLB',export_apply=True,export_yup=True,export_animations=False,
       export_skins=False,export_morph=False,export_extras=True,export_texture_dir='')
    return path.stat().st_size

def configure_render():
    import exterior_build
    original=exterior_build._icon_scene
    def scene(*a,**kw):
        s=original(*a,**kw);s.cycles.use_denoising=False;s.cycles.samples=64;s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=-.65;return s
    exterior_build._icon_scene=scene
    @bpy.app.handlers.persistent
    def fit(scene,*args):
        c=scene.camera
        if c and c.constraints and not c.get('marginApplied'):
            c.data.ortho_scale*=1.22;c['marginApplied']=True
    bpy.app.handlers.render_pre.append(fit)

def main():
    global P
    kit.export=export_active;configure_render();selected=None
    if '--only' in sys.argv:selected=sys.argv[sys.argv.index('--only')+1].split(',')
    descriptors=[]
    for key,stem,name,size,fn,ch,notes in SPECS:
        if selected and key not in selected:continue
        def build(fn=fn,stem=stem,size=size):
            global P
            for scene in list(bpy.data.scenes):
                if scene!=bpy.context.scene:bpy.data.scenes.remove(scene)
            kit.clear_scene();P=palette();parts=fn();bpy.context.view_layer.update()
            from repair_winding import repair_mesh_winding
            for part in parts:repair_mesh_winding(part)
            points=[ob.matrix_world@v.co for ob in parts for v in ob.data.vertices]
            lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
            dims=[(hi[i]-lo[i])*1000 for i in range(3)]
            print('PREFLIGHT '+stem+' '+str(dims)+' tris='+str(sum(kit.tri_count(ob) for ob in parts)),flush=True)
            assert max(abs(dims[i]-size[i]) for i in range(3))<1,(stem,'direct authored dimensions',dims,size)
            assert max(abs(lo[i]+hi[i]) for i in [0,1])<1e-6 and abs(lo[2])<1e-6,(stem,'bottom-centred',lo,hi)
            checkpoint(parts,stem);return kit.combine(parts)
        budget=6000 if key in ['oval','drum'] else 4000
        obj=kit.run([(stem,size,build,set(ch),budget)],do_icons=False)[0]
        stamp_contract(kit.GLB_DIR/(stem+'.glb'),stem)
        if '--no-icons' not in sys.argv:
            kit.render_top(obj,str(kit.PREVIEW_DIR/(stem+'-top.png')))
            kit.render_thumb(obj,str(kit.PREVIEW_DIR/(stem+'-thumb.png')))
            shutil.copy2(kit.PREVIEW_DIR/(stem+'-thumb.png'),WORK/(stem+'-front.png'))
            obj.rotation_euler.z=math.pi;bpy.context.view_layer.update()
            kit.render_thumb(obj,str(WORK/(stem+'-rear.png')))
            for path in [kit.PREVIEW_DIR/(stem+'-top.png'),kit.PREVIEW_DIR/(stem+'-thumb.png'),WORK/(stem+'-front.png'),WORK/(stem+'-rear.png')]:strip_metadata(path)
        # Save both editable sources with portable output paths and no stale
        # browser directories or append-only weak-library references.
        from sanitize_sources import sanitize_loaded
        from repair_uv_atlas import repair_loaded,TARGET_PARTS
        for source_path in [WORK/(stem+'-authoring.blend'), WORK/(stem+'.blend')]:
            bpy.ops.wm.open_mainfile(filepath=str(source_path),load_ui=False)
            repair_loaded(stem)
            sanitize_loaded(stem)
            bpy.ops.wm.save_as_mainfile(filepath=str(source_path),compress=True)
            if stem in TARGET_PARTS and source_path.stem==stem:
                final_obj=next(ob for ob in bpy.context.scene.objects if ob.type=='MESH')
                export_active(final_obj,kit.GLB_DIR/(stem+'.glb'));stamp_contract(kit.GLB_DIR/(stem+'.glb'),stem)
                validation_path=WORK/(stem+'-validation.json');final_validation=json.loads(validation_path.read_text())
                final_validation['uv']=kit.uv_report(final_obj);final_validation['glb_bytes']=(kit.GLB_DIR/(stem+'.glb')).stat().st_size
                final_validation['packedUvOverlapCorrected']=True
                validation_path.write_text(json.dumps(final_validation,indent=2)+'\n')
        def rel(p):return str(p.relative_to(ROOT))
        descriptor=dict(id=stem,name=name,group='家具',category='机・テーブル',kind='table',assetSet='rpg-mansion',model=rel(kit.GLB_DIR/(stem+'.glb')),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),w=size[0],d=size[1],h=size[2],defaultElevation=0,provenance='original',previewVersion=1,sourceBlend=rel(WORK/(stem+'.blend')),authoringBlend=rel(WORK/(stem+'-authoring.blend')),exportBlend=rel(WORK/(stem+'.blend')),validation=rel(WORK/(stem+'-validation.json')),front=rel(WORK/(stem+'-front.png')),rear=rel(WORK/(stem+'-rear.png')),builder=rel(Path(__file__)),placementNotes=notes,finishChannels=[dict(key=k,label={'wood':'木部','metal':'金物','leather':'革','fabric':'布','inlay':'象嵌'}[k],default={'wood':'#563b2d','metal':'#b69b5d','leather':'#294d4b','fabric':'#274e45','inlay':'#d2bc90'}[k]) for k in ch],rights=dict(status='original',creator='OpenAI assistant using native Blender mesh authoring',sources=[],externalGeometry=False,externalImages=False,licenseBasis='Original procedural geometry created for this project'))
        report=json.loads((WORK/(stem+'-validation.json')).read_text());descriptor['triangleBudget']=budget;descriptor['measuredTriangles']=report['triangles'];descriptor['glbBytes']=(kit.GLB_DIR/(stem+'.glb')).stat().st_size
        descriptor['hashes']={k:hashlib.sha256((ROOT/descriptor[k]).read_bytes()).hexdigest() for k in ['model','sourceBlend','authoringBlend','exportBlend']}
        descriptors.append(descriptor)
        print('ASSET_READY '+stem,flush=True)
    path=HERE/(sys.argv[sys.argv.index('--descriptor-file')+1] if '--descriptor-file' in sys.argv else 'descriptors.json')
    old=json.loads(path.read_text()) if path.exists() else []
    by={a['id']:a for a in old};by.update({a['id']:a for a in descriptors});path.write_text(json.dumps(list(by.values()),ensure_ascii=False,indent=2)+'\n')
    print('DESCRIPTORS '+str(path),flush=True)

if __name__=='__main__':main()
