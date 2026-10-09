"""Original lighting reconstruction from surviving geometry recipe. Fresh build and QA required."""
from pathlib import Path
import sys, math, json, hashlib, struct
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh
from mathutils import Vector
import model_kit as kit
from shape_kit import rounded_rect
from native_utils import positive_winding,metric_uv,export_active,sanitize
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews'
kit.WORK_DIR=HERE/'sources';kit.export=export_active;kit.unwrap=metric_uv
PARTS=[];M={};DATUM={}

def palette():
    global M
    M={}
    for key,label,col,rough,metal,ch in [
        ('metal','Antique brass structure','#96703c',.3,.78,'metal'),
        ('iron','Bronzed iron structure','#39352e',.34,.78,'metal'),
        ('shade','Ivory enamel spun metal shades','#c9bd9b',.29,.25,'shade'),
        ('glass','Green cast glass shade','#15583d',.18,.08,'glass'),
        ('clear','Clear lightly tinted glass','#c2ded2',.1,.0,'glass'),
        ('bulb','Opal bulb glass static appearance','#fff0c9',.24,0,'glass'),
        ('ceramic','Porcelain socket insulator','#d1c7ae',.42,0,'ceramic')
    ]:
        m=kit.matp(label,col,rough,metal)
        m['finishChannel']=ch;m.use_backface_culling=True;M[key]=m
        bs=m.node_tree.nodes.get('Principled BSDF')
        if key=='clear':
            bs.inputs['Alpha'].default_value=.1
            m.diffuse_color=(*m.diffuse_color[:3],.1)
            m.surface_render_method='DITHERED'
            bs.inputs['Transmission Weight'].default_value=.92
            bs.inputs['IOR'].default_value=1.45
            m['glassAppearance']='Closed 3mm panels, nonzero green tint, alpha 0.10 and transmission 0.92 using standard glTF PBR extension; actual GLB contrast tested'
        if key=='glass':
            bs.inputs['Transmission Weight'].default_value=.08
        if key=='bulb':
            bs.inputs['Emission Color'].default_value=(1,.71,.34,1)
            bs.inputs['Emission Strength'].default_value=.3
            m['appearanceOnly']='Modest material emission; no native PointLight or SpotLight'

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='ceramic',smooth=True):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    positive_winding(ob);return keep(ob)

def box(name,center,size,mat='metal',radius=.002):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),
               tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,1)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='ceramic',smooth=True,caps=True):
    n=len(rings[0]);verts=[tuple(v)for ring in rings for v in ring]
    faces=[tuple(reversed(range(n)))] if caps else []
    faces += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)
              for k in range(len(rings)-1)for i in range(n)]
    if caps:faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    else:faces += [((len(rings)-1)*n+i,(len(rings)-1)*n+(i+1)%n,(i+1)%n,i)for i in range(n)]
    ob=mesh(name,verts,faces,mat,smooth)
    if caps:ob.data.polygons[0].use_smooth=ob.data.polygons[-1].use_smooth=False
    return ob

def ellipse(w,d,z,cx=0,cy=0,n=48):
    return [(cx+w/2*math.cos(math.tau*i/n),
             cy+d/2*math.sin(math.tau*i/n),
             z(math.tau*i/n)if callable(z)else z)for i in range(n)]

def sweep(name,path,r,mat='metal',sides=10,closed=False,smooth=True):
    path=[Vector(p)for p in path]
    tangents=[((path[(i+1)%len(path)]-path[(i-1)%len(path)])if closed
               else(path[min(i+1,len(path)-1)]-path[max(i-1,0)])).normalized()
              for i in range(len(path))]
    seed=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],
             key=lambda a:max(abs(t.dot(a))for t in tangents))
    rings=[]
    for p,t in zip(path,tangents):
        u=t.cross(seed).normalized();v=t.cross(u).normalized()
        rings.append([p+r*(u*math.cos(math.tau*j/sides)+v*math.sin(math.tau*j/sides))
                      for j in range(sides)])
    return loft(name,rings,mat,smooth,caps=not closed)

def lathe(name,x,y,rows,mat='metal',n=16):
    return loft(name,[ellipse(2*r,2*r,z,x,y,n)for r,z in rows],mat)

def bulb(name,x,y,z,scale=1):
    return lathe(name,x,y,[(r*scale,z+h*scale)for r,h in
        [(.004,0),(.016,.009),(.025,.025),(.03,.052),(.025,.078),(.018,.095),(.015,.112)]],
        'bulb',24)

from mathutils import Matrix

base_palette=palette
def palette():
    base_palette()
    for key,label,col,rough,metal,ch in [('wood','Oiled walnut tripod timber','#60442b',.4,0,'wood'),('fabric','Warm woven shade fabric','#c5b58c',.78,0,'shade'),('stone','Honed dark limestone counterweight','#565a53',.58,0,'stone'),('wax','Ivory candle wax','#e7dbc0',.55,0,'wax'),('wick','Dark cotton wick','#242019',.9,0,'wax')]:
        m=kit.matp(label,col,rough,metal);m['finishChannel']=ch;m.use_backface_culling=True;M[key]=m

def support(a,b,p):DATUM.setdefault('supportProbes',[]).append(dict(parts=[a,b],pointOriginalM=list(p)))
def opening(part,origin,direction,lo,hi):DATUM.setdefault('cavityRays',[]).append(dict(part=part,originOriginalM=list(origin),direction=list(direction),rangeM=[lo,hi]))
def install(mount,elevation=0,**kw):
    DATUM['installation']=dict(mount=mount,defaultElevationMm=elevation,note='Original static decorative fixture with geometric support; no configured runtime light or physical certification.',**kw)
    DATUM['bulb']=dict(materialEmissionStrength=.3,runtimeLightObjects=0)
def transform(parts,origin,axis=(0,0,1)):
    rot=Vector((0,0,1)).rotation_difference(Vector(axis).normalized()).to_matrix();origin=Vector(origin)
    for ob in parts:
        for v in ob.data.vertices:v.co=rot@v.co+origin
        ob.data.update()
    return rot
def beam(name,a,b,width,depth,mat='metal'):
    a=Vector(a);b=Vector(b);length=(b-a).length
    ob=box(name,(0,0,length/2),(width,depth,length),mat,min(width,depth)*.09)
    transform([ob],a,b-a);return ob
def ring(name,r,z,mat='metal',tube=.004,n=36,cx=0,cy=0):
    return sweep(name,[(cx+r*math.cos(math.tau*i/n),cy+r*math.sin(math.tau*i/n),z)for i in range(n)],tube,mat,8,True)
def head(prefix,joint,scale=1,axis=(0,0,1)):
    begin=len(PARTS);axis=Vector(axis).normalized();origin=Vector(joint)-axis*(.22*scale)
    lathe(prefix+' stem',0,0,[(r*scale,z*scale)for r,z in [(.024,.141),(.025,.160),(.018,.185),(.018,.225)]],'metal',20)
    lathe(prefix+' porcelain',0,0,[(r*scale,z*scale)for r,z in [(.019,.110),(.021,.14),(.023,.161)]],'ceramic',20)
    lathe(prefix+' retaining collar',0,0,[(r*scale,z*scale)for r,z in [(.019,.172),(.031,.175),(.031,.179),(.024,.183)]],'metal',16)
    rows=[(.025,.182),(.038,.168),(.06,.137),(.100,.072),(.128,.026),(.127,.021),(.123,.020),(.123,.026),(.096,.070),(.057,.135),(.035,.166),(.022,.180)]
    shell=loft(prefix+' open reflector',[ellipse(2*r*scale,2*r*scale,z*scale,n=24)for r,z in rows],'shade',True,False);shell['functionalRole']='hollow-shade'
    bulb(prefix+' opal bulb',0,0,0,scale)
    rot=transform(PARTS[begin:],origin,axis)
    pos=lambda p:tuple(origin+rot@(Vector(p)*scale))
    for a,b,p in [(' stem',' porcelain',(0,0,.151)),(' porcelain',' opal bulb',(0,0,.111)),(' stem',' retaining collar',(.018,0,.176)),(' retaining collar',' open reflector',(.027,0,.178))]:support(prefix+a,prefix+b,pos(p))
    opening(shell.name,pos((.07,0,-.02)),tuple(axis),.10*scale,.20*scale)
    opening(shell.name,pos((0,0,-.02)),tuple(axis),None,None)
    return prefix+' stem'
def drum(prefix,r,z0,z1,n=64):
    def profile(radius,z):return [( (radius+(.007 if i%2 else-.007))*math.cos(math.tau*i/n),(radius+(.007 if i%2 else-.007))*math.sin(math.tau*i/n),z)for i in range(n)]
    ob=loft(prefix+' pleated fabric shell',[profile(r,z0),profile(r,z1),profile(r-.005,z1),profile(r-.005,z0)],'fabric',False,False);ob['functionalRole']='hollow-shade'
    for z,label in [(z0+.004,'lower'),(z1-.004,'upper')]:ring(prefix+' '+label+' rim',r-.002,z,'metal',.004,48)
    opening(ob.name,(0,0,z0-.02),(0,0,1),None,None)
    return ob

def task_lamp():
    base=loft('Task lamp weighted oval base',[ellipse(w,d,z,n=36)for w,d,z in [(.23,.19,0),(.245,.205,.015),(.242,.203,.027),(.205,.17,.036)]],'iron');base['functionalRole']='desk-support'
    lathe('Task pivot foot',0,.045,[(.03,.026),(.032,.044),(.015,.065),(.015,.2)],'metal',20)
    A=(0,.045,.2);B=(0,.17,.42);C=(0,-.10,.58)
    for label,p in [('lower',A),('elbow',B),('head',C)]:sweep('Task '+label+' pivot',[(p[0]-.028,p[1],p[2]),(p[0]+.028,p[1],p[2])],.024,'metal',20)
    for s in [-1,1]:
        for label,a,b in [('lower',A,B),('upper',B,C)]:
            aa=(s*.019,a[1],a[2]);bb=(s*.019,b[1],b[2]);beam('Task '+label+' twin bar '+str(s),aa,bb,.012,.017,'iron')
            support('Task '+label+' twin bar '+str(s),'Task '+('lower'if label=='lower'else'elbow')+' pivot',aa)
            support('Task '+label+' twin bar '+str(s),'Task '+('elbow'if label=='lower'else'head')+' pivot',bb)
    sweep('Task counterweight lever',[B,(0,.265,.49)],.008,'metal',12)
    weight=sweep('Task rear counterweight',[(-.040,.265,.49),(.040,.265,.49)],.034,'iron',24)
    support('Task counterweight lever','Task elbow pivot',B);support('Task counterweight lever',weight.name,(0,.265,.49))
    stem=head('Task adjustable head',C,.95,(0,.38,.925));support(stem,'Task head pivot',C)
    support('Task pivot foot',base.name,(0,.045,.032));support('Task pivot foot','Task lower pivot',A)
    install('desk',740)

def carry_lantern():
    base=lathe('Portable lantern stepped foot',0,0,[(.095,0),(.108,.012),(.108,.03),(.094,.041)],'iron',32);base['functionalRole']='desk-support'
    gl=loft('Portable lantern closed cylindrical glass',[ellipse(2*r,2*r,z,n=40)for r,z in [(.091,.037),(.091,.293),(.088,.293),(.088,.037)]],'clear',True,False);gl['functionalRole']='clear-glass-pane'
    roof=loft('Portable lantern hollow ventilator roof',[ellipse(2*r,2*r,z,n=32)for r,z in [(.111,.284),(.111,.302),(.062,.352),(.027,.362),(.024,.354),(.054,.344),(.099,.296),(.100,.284)]],'iron',True,False)
    ring('Portable glass upper retaining ring',.090,.291,'metal',.003,32)
    for j in range(4):
        a=math.tau*j/4
        sweep('Portable glass upper retainer stay '+str(j),[(.090*math.cos(a),.090*math.sin(a),.291),(.105*math.cos(a),.105*math.sin(a),.291)],.0035,'metal',8)
    for j in range(4):
        a=math.pi/4+math.tau*j/4;x=.101*math.cos(a);y=.101*math.sin(a)
        rail=sweep('Portable lantern guard upright '+str(j),[(x,y,.026),(x,y,.293)],.006,'metal',10)
        support(base.name,rail.name,(x,y,.028));support(roof.name,rail.name,(x,y,.289))
    for z in [.10,.23]:ring('Portable lantern guard hoop '+str(z),.100,z,'metal',.0045,40)
    for s in [-1,1]:box('Portable handle mounting ear '+str(s),(s*.099,0,.307),(.026,.026,.039),'metal',.002)
    path=[(-.106,0,.312)]+[(.11*math.cos(math.pi-math.pi*i/18),0,.36+.11*math.sin(math.pi-math.pi*i/18))for i in range(19)]+[(.106,0,.312)]
    sweep('Portable carrying bow',path,.007,'iron',10)
    for s in [-1,1]:support('Portable carrying bow','Portable handle mounting ear '+str(s),(s*.106,0,.318))
    lathe('Portable interior pedestal',0,0,[(.039,.035),(.035,.05),(.018,.071),(.018,.085)],'metal',20)
    lathe('Portable porcelain socket',0,0,[(.022,.073),(.023,.094),(.018,.108)],'ceramic',20)
    bulb('Portable opal bulb',0,0,.097,1.15)
    support('Portable interior pedestal',base.name,(0,0,.039));support('Portable interior pedestal','Portable porcelain socket',(0,0,.079));support('Portable porcelain socket','Portable opal bulb',(0,0,.103))
    opening(roof.name,(.040,0,.27),(0,0,1),.045,.10)
    DATUM['glassThicknessProbes']=[dict(part=gl.name,originOriginalM=[.04,-.14,.17],direction=[0,1,0],expectedMm=None,minimumMm=3,maximumMm=3.5)]
    install('desk',740)

def tripod_floor():
    lathe('Tripod upper metal hub',0,0,[(.045,1.265),(.068,1.28),(.068,1.33),(.036,1.35)],'metal',24)
    for j in range(3):
        a=math.tau*j/3+math.pi/6;foot=(.33*math.cos(a),.33*math.sin(a),.018);top=(.042*math.cos(a),.042*math.sin(a),1.312)
        leg=beam('Spreading walnut tripod leg '+str(j),foot,top,.041,.034,'wood');leg['functionalRole']='floor-support'
        support(leg.name,'Tripod upper metal hub',top)
        # End-grain feet are horizontal physical pads touching the floor.
        pad=box('Tripod floor shoe '+str(j),(foot[0],foot[1],.012),(.055,.046,.024),'iron',.001)
        support(leg.name,pad.name,(foot[0],foot[1],.019))
    lathe('Tripod socket pedestal',0,0,[(.023,1.32),(.025,1.355),(.020,1.38)],'metal',20)
    lathe('Tripod porcelain socket',0,0,[(.022,1.36),(.022,1.392),(.018,1.408)],'ceramic',20)
    bulb('Tripod opal bulb',0,0,1.398,1.2)
    drum('Tripod',.302,1.235,1.66)
    for j in range(3):
        a=math.tau*j/3;end=(.299*math.cos(a),.299*math.sin(a),1.239)
        p=sweep('Tripod lower shade spoke '+str(j),[(0,0,1.34),end],.004,'metal',8)
        support(p.name,'Tripod socket pedestal',(0,0,1.34));support(p.name,'Tripod lower rim',end)
    support('Tripod upper metal hub','Tripod socket pedestal',(0,0,1.337));support('Tripod socket pedestal','Tripod porcelain socket',(0,0,1.37));support('Tripod porcelain socket','Tripod opal bulb',(0,0,1.403))
    install('floor',0)

def arched_floor():
    base=box('Arched lamp limestone counterweight',(-.40,0,.045),(.48,.36,.09),'stone',.012);base['functionalRole']='floor-support'
    lathe('Arched lamp base collar',-.40,0,[(.041,.079),(.043,.098),(.026,.125)],'metal',24)
    path=[(-.40,0,.10),(-.40,0,1.22),(-.388,0,1.38),(-.34,0,1.54),(-.245,0,1.69),(-.09,0,1.795),(.10,0,1.835),(.285,0,1.795),(.425,0,1.714),(.50,0,1.65)]
    arc=sweep('Continuous arched reading support',path,.017,'iron',16)
    stem=head('Arched reading head',(.5,0,1.65),1.38,(.16,0,.987))
    support(base.name,'Arched lamp base collar',(-.40,0,.084));support('Arched lamp base collar',arc.name,(-.40,0,.112));support(arc.name,stem,(.5,0,1.65))
    install('floor',0)

def torchiere():
    base=lathe('Torchiere weighted pedestal foot',0,0,[(.145,0),(.16,.017),(.16,.03),(.12,.048),(.06,.058)],'iron',36);base['functionalRole']='floor-support'
    lathe('Torchiere tapered standard',0,0,[(.031,.048),(.028,.12),(.02,1.48),(.025,1.565)],'metal',24)
    for z in [.14,1.40]:lathe('Torchiere standard collar '+str(z),0,0,[(.025,z-.012),(.032,z),(.025,z+.012)],'iron',20)
    rows=[(.031,1.55),(.055,1.57),(.10,1.60),(.18,1.67),(.237,1.733),(.242,1.739),(.241,1.747),(.234,1.747),(.230,1.739),(.173,1.677),(.094,1.607),(.050,1.578),(.026,1.56)]
    bowl=loft('Torchiere upward open bowl',[ellipse(2*r,2*r,z,n=32)for r,z in rows],'shade',True,False);bowl['functionalRole']='hollow-shade'
    lathe('Torchiere internal socket mount',0,0,[(.032,1.55),(.034,1.572),(.021,1.59)],'metal',20)
    lathe('Torchiere porcelain socket',0,0,[(.023,1.58),(.023,1.609),(.018,1.621)],'ceramic',20)
    bulb('Torchiere upward opal bulb',0,0,1.612,1)
    for j in range(3):
        a=math.tau*j/3
        p=(.135*math.cos(a),.135*math.sin(a),1.632)
        brace=sweep('Torchiere bowl brace '+str(j),[(.021*math.cos(a),.021*math.sin(a),1.485),p],.007,'metal',10)
        support(brace.name,'Torchiere tapered standard',(.019*math.cos(a),.019*math.sin(a),1.487))
        support(brace.name,bowl.name,p)
    support(base.name,'Torchiere tapered standard',(0,0,.053));support('Torchiere tapered standard','Torchiere internal socket mount',(0,0,1.557));support('Torchiere internal socket mount','Torchiere porcelain socket',(0,0,1.585));support('Torchiere porcelain socket','Torchiere upward opal bulb',(0,0,1.617))
    opening(bowl.name,(.1,0,1.85),(0,0,-1),.20,.28)
    opening(bowl.name,(0,0,1.85),(0,0,-1),None,None)
    install('floor',0)

def post_lantern():
    base=lathe('Hexagonal lantern post plinth',0,0,[(.16,0),(.174,.018),(.17,.045),(.12,.068),(.075,.09)],'iron',6);base['functionalRole']='floor-support'
    lathe('Hexagonal lantern tapered post',0,0,[(.066,.075),(.044,.15),(.030,.96),(.056,1.082)],'metal',16)
    lathe('Hexagonal lantern lower tray',0,0,[(.15,1.068),(.165,1.082),(.165,1.10),(.147,1.109)],'iron',6)
    for j in range(6):
        a=math.tau*j/6;x=.145*math.cos(a);y=.145*math.sin(a)
        p=beam('Hexagonal frame upright '+str(j),(x,y,1.09),(x,y,1.455),.013,.013,'iron')
        support(p.name,'Hexagonal lantern lower tray',(x,y,1.099))
    def hx(r,z):return ellipse(2*r,2*r,z,n=6)
    upper=loft('Hexagonal continuous upper frame',[hx(.158,1.44),hx(.158,1.467),hx(.135,1.467),hx(.135,1.44)],'iron',False,False)
    roof=loft('Hexagonal hollow pyramidal roof',[hx(.18,1.448),hx(.18,1.46),hx(.043,1.622),hx(.036,1.612),hx(.168,1.451),hx(.168,1.448)],'iron',False,False)
    for j in range(6):
        a=math.tau*(j+.5)/6;r=.145*math.cos(math.pi/6)
        gl=box('Hexagonal clear pane '+str(j),(0,0,0),(.134,.003,.335),'clear',0)
        # Local X is tangent; local Y is pane normal.
        rot=Matrix.Rotation(a-math.pi/2,3,'Z');center=Vector((r*math.cos(a),r*math.sin(a),1.2775))
        for v in gl.data.vertices:v.co=rot@v.co+center
        gl['functionalRole']='clear-glass-pane'
        if j==0:DATUM['glassThicknessProbes']=[dict(part=gl.name,originOriginalM=list(center+Vector((math.cos(a),math.sin(a),0))*.03),direction=[-math.cos(a),-math.sin(a),0],expectedMm=3)]
        va=math.tau*j/6;pt=(.145*math.cos(va),.145*math.sin(va),1.45)
        support('Hexagonal frame upright '+str(j),upper.name,pt)
    # Upper frame enters the inner roof wall without crossing its outer skin.
    support(upper.name,roof.name,(.157,0,1.466))
    lathe('Hexagonal roof finial',0,0,[(.045,1.601),(.048,1.612),(.034,1.633),(.017,1.65),(.005,1.678)],'metal',16)
    lathe('Hexagonal interior lamp pedestal',0,0,[(.04,1.102),(.04,1.12),(.024,1.156)],'metal',20)
    lathe('Hexagonal porcelain socket',0,0,[(.026,1.143),(.026,1.179),(.022,1.19)],'ceramic',20)
    bulb('Hexagonal opal lamp bulb',0,0,1.179,1.45)
    support(base.name,'Hexagonal lantern tapered post',(0,0,.084));support('Hexagonal lantern tapered post','Hexagonal lantern lower tray',(0,0,1.075));support('Hexagonal lantern lower tray','Hexagonal interior lamp pedestal',(0,0,1.106));support('Hexagonal interior lamp pedestal','Hexagonal porcelain socket',(0,0,1.15));support('Hexagonal porcelain socket','Hexagonal opal lamp bulb',(0,0,1.185));support(roof.name,'Hexagonal roof finial',(.043,0,1.614))
    opening(roof.name,(.08,0,1.40),(0,0,1),.10,.21)
    install('floor',0)

def twin_wall():
    plate=box('Twin reading wall mounting plate',(0,.24,.575),(.19,.025,.31),'iron',.005);plate['functionalRole']='wall-anchor'
    for x in [-.065,.065]:
        for z in [.457,.693]:sweep('Twin wall fixing screw %.3f %.3f'%(x,z),[(x,.229,z),(x,.217,z)],.006,'metal',12)
    for s in [-1,1]:
        A=(s*.063,.222,.61);B=(s*.19,.008,.515);C=(s*.31,-.145,.361)
        for label,p in [('wall',A),('elbow',B),('head',C)]:sweep('Twin '+str(s)+' '+label+' pivot',[(p[0]-.023,p[1],p[2]),(p[0]+.023,p[1],p[2])],.025,'metal',18)
        first=sweep('Twin '+str(s)+' first articulated arm',[A,B],.012,'iron',12);second=sweep('Twin '+str(s)+' second articulated arm',[B,C],.012,'iron',12)
        support(first.name,'Twin '+str(s)+' wall pivot',A);support(first.name,'Twin '+str(s)+' elbow pivot',B);support(second.name,'Twin '+str(s)+' elbow pivot',B);support(second.name,'Twin '+str(s)+' head pivot',C)
        # Short physical wall boss crosses the rear pivot into the plate.
        boss=sweep('Twin '+str(s)+' wall standoff',[(A[0],.233,A[2]),(A[0],.212,A[2])],.018,'metal',16)
        support(boss.name,plate.name,(A[0],.230,A[2]));support(boss.name,'Twin '+str(s)+' wall pivot',A)
        stem=head('Twin '+str(s)+' reading head',C,.88,(0,.45,.893));support(stem,'Twin '+str(s)+' head pivot',C)
    install('wall-bracket',1450,wallContactPlaneBlenderY=.2525)

def cage_pendant():
    canopy=lathe('Cage pendant ceiling canopy',0,0,[(.032,.687),(.1,.704),(.1,.738),(.095,.74)],'iron',32);canopy['functionalRole']='ceiling-anchor'
    rod=sweep('Cage pendant suspension rod',[(0,0,.356),(0,0,.713)],.009,'metal',16)
    head('Cage protected head',(0,0,.388),1.4)
    collar=lathe('Cage upper guard clamp',0,0,[(.034,.335),(.055,.342),(.055,.359),(.034,.367)],'iron',24)
    ring('Cage lower perimeter',.155,.014,'iron',.005,40)
    for j in range(6):
        a=math.tau*j/6
        points=[(.155,.014),(.195,.075),(.214,.155),(.193,.238),(.12,.309),(.043,.350)]
        rail=sweep('Cage bowed guard '+str(j),[(r*math.cos(a),r*math.sin(a),z)for r,z in points],.0055,'iron',8)
        spoke=sweep('Cage underside radial guard '+str(j),[(.155*math.cos(a),.155*math.sin(a),.014),(.018*math.cos(a),.018*math.sin(a),.008)],.004,'iron',8)
        support(rail.name,'Cage lower perimeter',(.155*math.cos(a),.155*math.sin(a),.014));support(rail.name,collar.name,(.043*math.cos(a),.043*math.sin(a),.350));support(spoke.name,'Cage lower perimeter',(.155*math.cos(a),.155*math.sin(a),.014))
    lathe('Cage underside central boss',0,0,[(.022,0),(.023,.009),(.019,.018)],'metal',20)
    support(rod.name,canopy.name,(0,0,.709));support(rod.name,collar.name,(0,0,.36));support('Cage protected head stem',collar.name,(0,0,.35))
    install('ceiling-rods',1960,ceilingContactPlaneBlenderZ=.74,ceilingPlaneMm=2700)

def drum_pendant():
    canopy=lathe('Drum pendant ceiling canopy',0,0,[(.036,.689),(.104,.712),(.104,.74)],'metal',32);canopy['functionalRole']='ceiling-anchor'
    sweep('Drum central suspension rod',[(0,0,.50),(0,0,.716)],.010,'metal',16)
    lathe('Drum three-stay joining boss',0,0,[(.035,.503),(.045,.523),(.044,.545)],'iron',24)
    drum('Suspended drum',.31,0,.27)
    for j in range(3):
        a=math.tau*j/3;A=(.308*math.cos(a),.308*math.sin(a),.266);B=(.023*math.cos(a),.023*math.sin(a),.527)
        stay=sweep('Drum sloping suspension stay '+str(j),[A,B],.005,'metal',10)
        support(stay.name,'Suspended drum upper rim',A);support(stay.name,'Drum three-stay joining boss',B)
    lathe('Drum interior socket stem',0,0,[(.016,.197),(.016,.224),(.010,.505)],'metal',18)
    lathe('Drum porcelain socket',0,0,[(.019,.176),(.022,.201),(.02,.213)],'ceramic',20)
    bulb('Drum opal bulb',0,0,.066,1.1)
    support('Drum central suspension rod',canopy.name,(0,0,.710));support('Drum central suspension rod','Drum three-stay joining boss',(0,0,.525));support('Drum interior socket stem','Drum three-stay joining boss',(0,0,.504));support('Drum interior socket stem','Drum porcelain socket',(0,0,.205));support('Drum porcelain socket','Drum opal bulb',(0,0,.183))
    install('ceiling-rods',1960,ceilingContactPlaneBlenderZ=.74,ceilingPlaneMm=2700)

def candelabrum():
    base=loft('Candelabrum oval weighted base',[ellipse(w,d,z,n=32)for w,d,z in [(.22,.17,0),(.232,.182,.014),(.224,.175,.028),(.12,.10,.042)]],'metal');base['functionalRole']='desk-support'
    lathe('Candelabrum turned central standard',0,0,[(.04,.032),(.035,.057),(.019,.09),(.016,.16),(.026,.182),(.018,.211),(.013,.335),(.023,.374)],'metal',24)
    for s in [-1,1]:
        arm=sweep('Candelabrum swept branch '+str(s),[(0,0,.17),(s*.062,0,.146),(s*.125,0,.163),(s*.178,0,.212),(s*.208,0,.27),(s*.211,0,.322)],.009,'metal',12)
        support(arm.name,'Candelabrum turned central standard',(s*.008,0,.168))
    for index,(x,z)in enumerate([(-.211,.318),(0,.370),(.211,.318)]):
        cup=lathe('Candelabrum candle cup '+str(index),x,0,[(.015,z-.012),(.025,z-.007),(.039,z),(.039,z+.011),(.025,z+.016),(.019,z+.011),(.014,z+.003)],'metal',24)
        top=z+.199
        wax=loft('Candelabrum wax candle '+str(index),[ellipse(2*r,2*r,zz,x,0,20)for r,zz in [(.013,z+.002),(.014,z+.018),(.014,top-.025),(.0138,lambda a:top+.003*math.sin(a*3)+.0015*math.cos(a*5))]],'wax')
        wick=sweep('Candelabrum wick '+str(index),[(x,0,top-.005),(x+.001,0,top+.012)],.0015,'wick',8)
        support(cup.name,wax.name,(x+.004,0,z+.0025));support(wax.name,wick.name,(x,0,top-.003))
        if index==1:support(cup.name,'Candelabrum turned central standard',(0,0,.367))
        else:support(cup.name,'Candelabrum swept branch '+str(-1 if index==0 else 1),(x,0,.318))
    support(base.name,'Candelabrum turned central standard',(0,0,.039))
    DATUM['bulb']=dict(type='Three wax candles and static unlit wicks',materialEmissionStrength=0,runtimeLightObjects=0)
    install('desk',740);DATUM['bulb']=dict(type='Three wax candles and static unlit wicks',materialEmissionStrength=0,runtimeLightObjects=0)

SPECS=[dict(slug='counterbalanced-task-lamp',name='釣合い重り・二本腕デスクライト',kind='table-lamp',fn=task_lamp,channels=['metal','shade','glass','ceramic'],size=None,elevation=740,signature='weighted-base-twin-articulated-bars-counterweight-tilted-open-reflector',meaning='One static counterbalanced articulated desk fixture with true paired bars, physical pivots and downward tilted open reflector.'),dict(slug='guarded-carry-lantern',name='持ち手と保護枠付き・携帯ランタン',kind='table-lamp',fn=carry_lantern,channels=['metal','glass','ceramic'],size=None,elevation=740,signature='cylindrical-clear-glass-guard-hoops-carry-bow-table-lantern',meaning='One portable tabletop lantern with continuous cylindrical clear glass, external guard hoops and a physical carrying bow.'),dict(slug='tripod-drum-floor-lamp',name='木製三脚・プリーツシェードフロアランプ',kind='floor-lamp',fn=tripod_floor,channels=['metal','wood','shade','glass','ceramic'],size=None,elevation=0,signature='spreading-three-timber-legs-pleated-drum-open-fabric-shade',meaning='Wide spreading walnut tripod legs support a true open pleated fabric drum and separately supported socket.'),dict(slug='arched-reading-floor-lamp',name='石台カウンターウェイト・弧状読書灯',kind='floor-lamp',fn=arched_floor,channels=['metal','stone','shade','glass','ceramic'],size=None,elevation=0,signature='stone-counterweight-base-long-asymmetric-arch-open-reading-head',meaning='Long asymmetric arched support over a limestone counterweight, ending in a physically mounted tilted open reading reflector.')]


SPECS += [dict(slug='bowl-torchiere-floor-lamp',name='上向き反射皿・トーチエール',kind='floor-lamp',fn=torchiere,channels=['metal','shade','ceramic','glass'],size=None,elevation=0,signature='upward-open-bowl-three-braces-tapered-pedestal-torchiere',meaning='Open upward reflector bowl on a floor pedestal with three real support braces and an interior socket.'),dict(slug='hexagonal-post-lantern',name='六角ガラス灯体・柱付きランタン',kind='floor-lamp',fn=post_lantern,channels=['metal','glass','ceramic'],size=None,elevation=0,signature='hexagonal-post-plinth-six-framed-glass-panes-hollow-pyramidal-roof',meaning='One floor-standing post lantern with a six-pane hexagonal body, continuous upper frame and hollow roof.'),dict(slug='twin-articulated-wall-reading-lamp',name='独立可動腕・二灯壁付け読書灯',kind='wall-lamp',fn=twin_wall,channels=['metal','shade','glass','ceramic'],size=None,elevation=1450,signature='wall-plate-two-independent-two-segment-reading-arms-open-heads',meaning='One wall fixture with two independently jointed reading heads and physical stand-offs carried by a common backplate.'),dict(slug='caged-workshop-pendant',name='開放ガード枠・工房ペンダント',kind='pendant-lamp',fn=cage_pendant,channels=['metal','shade','glass','ceramic'],size=None,elevation=1960,signature='ceiling-rod-domed-reflector-six-bowed-guard-cage-open-bottom',meaning='One workshop pendant with a physically supported reflector inside a real open bow-and-spoke protection cage.'),dict(slug='pleated-drum-pendant',name='三本ステー・プリーツドラムペンダント',kind='pendant-lamp',fn=drum_pendant,channels=['metal','shade','glass','ceramic'],size=None,elevation=1960,signature='three-sloping-stays-wide-pleated-fabric-drum-open-bottom',meaning='One wide open drum pendant carried by three sloped stays with its own central socket suspension.'),dict(slug='three-branch-table-candelabrum',name='曲線枝と蝋燭受け・三灯卓上燭台',kind='table-lamp',fn=candelabrum,channels=['metal','wax'],size=None,elevation=740,signature='oval-foot-turned-stem-two-scroll-branches-three-cups-wax-candles',meaning='One tabletop candelabrum with two swept branches, three distinct candle cups, solid wax candles and unlit wicks.')]
for sp in SPECS:
 sp['defaults']={'glass':'#c2ded2'}if sp['slug']in ['guarded-carry-lantern','hexagonal-post-lantern']else{}
 if sp['slug']in ['tripod-drum-floor-lamp','pleated-drum-pendant']:sp['defaults']['shade']='#c5b58c'

def triangulate_wax_caps_preserving_surface_uv(ob):
    old=ob.data;old.calc_loop_triangles();by_poly={}
    for t in old.loop_triangles:by_poly.setdefault(t.polygon_index,[]).append(t)
    faces=[];loops=[];materials=[];smooth=[];changed=0
    for p in old.polygons:
        wax=old.materials[p.material_index].name.startswith('Ivory candle wax')
        if wax and not p.use_smooth and len(p.vertices)>3:
            for t in by_poly[p.index]:faces.append(tuple(t.vertices));loops.append(tuple(t.loops));materials.append(p.material_index);smooth.append(False)
            changed+=1
        else:faces.append(tuple(p.vertices));loops.append(tuple(p.loop_indices));materials.append(p.material_index);smooth.append(p.use_smooth)
    if not changed:return 0
    me=bpy.data.meshes.new(old.name+' with true flat cap triangles');me.from_pydata([tuple(v.co)for v in old.vertices],[],faces);me.update()
    for mat in old.materials:me.materials.append(mat)
    for p,mat,sm in zip(me.polygons,materials,smooth):p.material_index=mat;p.use_smooth=sm
    for layer in old.uv_layers:
        new=me.uv_layers.new(name=layer.name);new.active_render=layer.active_render
        for p,source_loops in zip(me.polygons,loops):
            for new_index,old_index in zip(p.loop_indices,source_loops):new.data[new_index].uv=layer.data[old_index].uv
    for key in old.keys():me[key]=old[key]
    ob.data=me;positive_winding(ob,repair=False);return changed

def authoring(spec,stem):
    global PARTS,DATUM
    PARTS=[];DATUM={};palette();spec['fn']()
    pts=[ob.matrix_world@v.co for ob in PARTS for v in ob.data.vertices]
    lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)])
    offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
    for ob in PARTS:
        for v in ob.data.vertices:v.co+=offset
        positive_winding(ob);metric_uv(ob)
    DATUM['bottomCenterTranslationBlenderM']=list(offset);DATUM['measuredOriginalBoundsM']=[list(lo),list(hi)]
    if 'wallContactPlaneBlenderY'in DATUM.get('installation',{}):DATUM['installation']['wallContactPlaneGltfZ']=-(DATUM['installation']['wallContactPlaneBlenderY']+offset.y)
    sc=bpy.context.scene;sc.name='Native authoring parts';sc['front']='-Y';sc['up']='+Z';sc['units']='metres';sc['designBasis']='Original intended static fixture design, not measured historic reference';sc['installationDatumsJson']=json.dumps(DATUM)
    sanitize(stem);p=HERE/'authoring_sources'/(stem+'.blend');p.parent.mkdir(exist_ok=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Validated export'
    ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);ob['staticProp']=True;ob['constructionRole']=spec['signature'];ob['installationDatumsJson']=json.dumps(DATUM);sanitize(stem);return ob

def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);assert len(d.get('meshes',[]))==len(d.get('scenes',[]))==1
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original project-authored native Blender geometry; no imported geometry or images',source='tools/blender/rpg_mansion/decorative_lighting_expansion/build.py',staticProp=True)
    payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(ob,path,view):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='Temporary product evidence'
    copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);ob=copy
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.seed=0;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world;scene.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=(0,0,span*4)
    elif view=='front':loc=(0,-span*4,target.z)
    elif view=='side':loc=(span*4,-span*.5,target.z+span*.25)
    elif view=='underside':loc=(span*1.9,-span*3,-span*1.7)
    elif view=='rear':loc=(-span*2.5,span*4,span*1.8)
    else:loc=(span*2.5,-span*4,span*1.8)
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));projected=[(p.dot(right),p.dot(up))for p in pts];lows=[min(p[i]for p in projected)for i in range(2)];highs=[max(p[i]for p in projected)for i in range(2)];centre=[(lows[i]+highs[i])/2 for i in range(2)];cam.location+=right*(centre[0]-target.dot(right))+up*(centre[1]-target.dot(up));cam.data.ortho_scale=max(highs[i]-lows[i]for i in range(2))/(1-48/512)
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(scene)

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    file=HERE/'descriptors.json';items=json.loads(file.read_text())['items']if file.exists()else[]
    for spec in SPECS:
        if only and spec['slug']not in only:continue
        bpy.ops.wm.read_factory_settings(use_empty=True);stem='rpg-mansion-'+spec['slug']+'-01'
        # Measure first prototype envelope without ever rescaling authored geometry.
        ob=authoring(spec,stem);pts=[v.co for v in ob.data.vertices];size=tuple(round((max(p[i]for p in pts)-min(p[i]for p in pts))*1000,3)for i in range(3))
        if spec['size'] is not None:assert max(abs(a-b)for a,b in zip(size,spec['size']))<.5,(stem,size,spec['size'])
        print('AUTHORED_ENVELOPE',stem,size,flush=True)
        # The unchanged kit validates the pre-authored object; its builder clears no data.
        # Run's clear_scene is replaced locally by retaining this canonical scene.
        old=kit.clear_scene;kit.clear_scene=lambda:None
        ob=kit.run([(stem,size,lambda:ob,set(spec['channels']),6000)],do_export=False,do_icons=False)[0];kit.clear_scene=old
        if 'candelabrum'in stem:
            for scene in bpy.data.scenes:
                bpy.context.window.scene=scene
                for mesh_ob in scene.objects:
                    if mesh_ob.type=='MESH'and triangulate_wax_caps_preserving_surface_uv(mesh_ob):metric_uv(mesh_ob)
            bpy.context.window.scene=bpy.data.scenes['Validated export']
        source=kit.WORK_DIR/(stem+'.blend');sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
        if 'candelabrum'in stem:
            standalone=HERE/'authoring_sources'/(stem+'.blend');bpy.ops.wm.open_mainfile(filepath=str(standalone),load_ui=False)
            for mesh_ob in bpy.context.scene.objects:
                if mesh_ob.type=='MESH'and triangulate_wax_caps_preserving_surface_uv(mesh_ob):metric_uv(mesh_ob)
            sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(standalone),compress=True)
            bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False);ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        path=kit.GLB_DIR/(stem+'.glb');export_active(ob,path);stamp(path)
        validation=kit.WORK_DIR/(stem+'-validation.json');report=json.loads(validation.read_text());report['uv']=kit.uv_report(ob);report.update(triangle_budget=6000,glb_bytes=path.stat().st_size,datums=DATUM,closedComponentSignedVolumesM3=positive_winding(ob,repair=False),source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest());validation.write_text(json.dumps(report,indent=2)+'\n')
        rel=lambda p:str(p.relative_to(ROOT));it=dict(id=stem,name=spec['name'],kind=spec['kind'],group='住設',category='照明',packId='rpg-mansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(HERE/'evidence'/(stem+'-front.png')),rear=rel(HERE/'evidence'/(stem+'-rear.png')),sourceBlend=rel(source),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),validation=rel(validation),builder=rel(HERE/'build.py'),w=size[0],d=size[1],h=size[2],authoredNominalDimensionsMm=spec['size']or list(size),actualMeasuredDimensionsMm=list(size),geometrySignature=spec['signature'],triangleBudget=6000,defaultElevation=spec['elevation'],provenance='original',staticProp=True,placementHint=DATUM['installation']['mount'],semanticCoverage=spec['meaning'],dimensionBasis='Original intended design envelope. Source catalogue dimensions are demand references, not measured replacement or ergonomic certification.',installationDatums=DATUM,finishChannels=[dict(key=c,label={'ceramic':'陶器','metal':'金属','glass':'ガラス','shade':'笠','wood':'木部','stone':'石','wax':'蝋'}[c],default=spec.get('defaults',{}).get(c,{'ceramic':'#d1c7ae','metal':'#96703c','glass':'#fff0c9','shade':'#c9bd9b','wood':'#60442b','stone':'#565a53','wax':'#e7dbc0'}[c]))for c in spec['channels']])
        for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:it[key]=hashlib.sha256((ROOT/it[field]).read_bytes()).hexdigest()
        items=[i for i in items if i['id']!=stem]+[it];items.sort(key=lambda i:next(n for n,s in enumerate(SPECS)if i['id']=='rpg-mansion-'+s['slug']+'-01'));file.write_text(json.dumps(dict(set='rpg-mansion',name='洋館・照明試作',prototypeOnly=True,items=items),ensure_ascii=False,indent=2)+'\n')
        if '--no-icons'not in sys.argv:
            for view in ['thumb','top','front','rear']:render(ob,ROOT/it[view],view)
        print('LIGHTING_PROTOTYPE_READY',stem,report['triangles'],report['glb_bytes'],flush=True)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this project; no separate public reuse license granted',measurementPolicy='Intended design dimensions; catalogue demands do not establish replacement equivalence',source='build.py',sourceSha256=hashlib.sha256((HERE/'build.py').read_bytes()).hexdigest(),assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]),indent=2)+'\n')
if __name__=='__main__':main()
