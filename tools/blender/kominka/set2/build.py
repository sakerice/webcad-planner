"""Original set 2 geometry; no downloaded meshes/images/fonts or image textures.
Blender -b --threads 1 --factory-startup --python-exit-code 1 -P tools/blender/kominka/set2/build.py
-- --only rickshaw --output-root /tmp/kominka-set2-replay
All forms use metres, Blender -Y front and Z up. model_kit.run owns UV/validation/export.
"""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parents[1]))
import model_kit as kit
spec=importlib.util.spec_from_file_location('kominka_base',HERE.parent/'build.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
b=H.box;c=H.cyl;t=H.tube;p=H.profile;l=H.lathe
PALETTE=dict(H.PALETTE, lacquer=('漆塗り','#222320',.36,0),
             cushion=('座布団','#823b32',.95,0), foliage=('松葉','#354b35',.92,0),
             bark=('幹','#4c382a',.95,0), linen=('麻布','#d1c6af',.96,0),
             indigo=('藍の縞','#263c51',.96,0), clay=('鉢','#625249',.70,0))

def materials():
    H.materials()
    for key,(label,color,rough,metal) in PALETTE.items():
        if key not in H.M:
            H.M[key]=kit.matp('Kominka_'+key,color,rough=rough,metal=metal)
            H.M[key]['finishChannel']=key
    H.M['ceramic']=kit.matp('Kominka_WhiteCeramic','#e1ded4',rough=.26)
    H.M['soil']=kit.matp('Kominka_Soil','#342c22',rough=1)


def ellipsoid(name,center,radii,mat='foliage',segments=16,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=(0,0,0))
    o=bpy.context.object;o.name=name
    for v in o.data.vertices:v.co=Vector(tuple(center[i]+v.co[i]*radii[i] for i in range(3)))
    o.data.materials.append(H.M[mat])
    for face in o.data.polygons:face.use_smooth=True
    H.P.append(o);return o


def closed_ring_loft(name,rings,mat):
    # Close last profile ring to first, leaving the central aperture open.
    n=len(rings[0]);verts=[tuple(v) for ring in rings for v in ring];faces=[]
    for k in range(len(rings)):
        nxt=(k+1)%len(rings)
        for j in range(n):
            jj=(j+1)%n;faces.append((k*n+j,k*n+jj,nxt*n+jj,nxt*n+j))
    return H.mesh(name,verts,faces,mat)


def annular_band(name,r,z,height,thickness,mat='copper',cx=0,cy=0,n=40):
    rings=[]
    for radius,zz in [(r,z),(r+thickness,z),(r+thickness,z+height),(r,z+height)]:
        rings.append([(cx+radius*math.cos(j*2*math.pi/n),cy+radius*math.sin(j*2*math.pi/n),zz) for j in range(n)])
    return closed_ring_loft(name,rings,mat)


def pine_pad(center,radii):
    # Flattened, asymmetrical layered foliage, with needle-tip serrations.
    x,y,z=center;rx,ry,rz=radii;n=32;rings=[]
    for scale,zz in [(0.43,z-rz*.60),(1,z-rz*.16),(.80,z+rz*.38),(.22,z+rz*.75)]:
        ring=[]
        for j in range(n):
            a=j*2*math.pi/n
            uneven=1+.09*math.sin(5*a)+.06*math.cos(3*a)+(.08 if j%2 else -.04)
            ring.append((x+rx*scale*uneven*math.cos(a),y+ry*scale*uneven*math.sin(a),zz+.003*math.sin(4*a)))
        rings.append(ring)
    H.P.append(kit.shell('Trained pine needle pad',rings,[H.M['foliage']],[0]*3))


def rotate(o,center,axis,angle):
    center=Vector(center);rot=Matrix.Rotation(angle,3,axis)
    for v in o.data.vertices:v.co=center+rot@(v.co-center)
    o.data.update();return o


def board_door(x,y,z,w,h,mat='wood'):
    H.rail_frame(x,z-h/2,w,h,.034,y=y,rail=.027,mat=mat)
    H.planks(x,y+.003,z,w-.055,.018,h-.055,n=max(2,int(w/.13)),vertical=True,mat=mat)
    H.handle(x+w/2-.053,y-.020,z+.02,w=.03)


def carcass(w,d,h,mat='wood',top=True):
    for x in (-w/2+.027,w/2-.027):b('Solid side',x,0,(h-.05)/2,.054,d-.040,h-.05,mat)
    b('Back panel',0,d/2-.030,h/2,w-.106,.024,h-.04,'dark')
    b('Bottom board',0,0,.072,w-.07,d-.05,.040,mat)
    b('Front plinth',0,-d/2+.035,.050,w-.07,.040,.10,'dark')
    if top:H.planks(0,0,h-.025,w,d,.050,n=3,mat=mat)
    for x in (-w/2+.030,w/2-.030):
        for y in (-d/2+.030,d/2-.030):b('Cabinet foot',x,y,.055,.060,.060,.11,'dark')


def table(w,d,h,shelf=True,mat='wood'):
    b('Thick slab',0,0,h-.035,w,d,.070,mat,r=.012,seg=3)
    for x in (-w/2+.070,w/2-.070):
        for y in (-d/2+.07,d/2-.07):
            p('Tapered leg',[(.075,.075,.003,0),(.10,.10,.004,h-.075)],mat,cy=y,n=3)
            o=H.P[-1]
            for v in o.data.vertices:v.co.x+=x
    for y in (-d/2+.06,d/2-.06):b('Apron',0,y,h-.12,w-.10,.03,.17,'dark')
    for x in (-w/2+.06,w/2-.06):b('End apron',x,0,h-.12,.03,d-.12,.17,'dark')
    if shelf:H.planks(0,0,.18,w-.08,d-.09,.036,n=5)
    # End grain is represented as shallow carved joinery, not a texture.
    for x in (-w/2+.022,w/2-.022):
        for y in (-d/2+.055,d/2-.055):b('Peg',x,y,h-.077,.012,.012,.015,'dark',r=.001)


def rickshaw(w,d,h):
    # Wheels normal to X, symmetrical. Passenger faces Blender -Y.
    for x in (-.49,.49):
        o=H.ring_front('Wood wheel rim',.485,.525,.56,.065,'wood',n=64)
        for v in o.data.vertices:v.co=Vector((x+v.co.y,v.co.x+.62,v.co.z))
        o=H.ring_front('Iron tyre',.520,.545,.56,.068,'metal',n=64)
        for v in o.data.vertices:v.co=Vector((x+v.co.y,v.co.x+.62,v.co.z))
        c('Wheel hub',x,.62,.56,.083,.10,'dark',axis='X',sides=20)
        for j in range(16):
            a=2*math.pi*j/16
            t('Turned wheel spoke',[(x,.62+.07*math.cos(a),.56+.07*math.sin(a)),
                (x,.62+.503*math.cos(a),.56+.503*math.sin(a))],.012,'wood',sides=8)
    c('Axle',0,.62,.56,.027,1.00,'metal',axis='X')
    b('Passenger footboard',0,.18,.45,.79,.73,.055,'lacquer',r=.014)
    b('Curved body base',0,.67,.68,.83,.77,.16,'lacquer',r=.040,seg=4)
    b('Red seat cushion',0,.61,.81,.70,.58,.09,'cushion',r=.035,seg=4)
    b('Seat back',0,.96,1.055,.75,.078,.55,'lacquer',r=.028,seg=3)
    b('Back pad',0,.911,1.075,.63,.070,.34,'cushion',r=.028,seg=3)
    for x in (-.403,.403):
        b('Body side',x,.67,.91,.060,.71,.31,'lacquer',r=.023,seg=3)
        b('Arm rest',x,.63,1.09,.07,.78,.055,'wood',r=.014)
        t('Long pull shaft',[(x,.5,.57),(x,-.05,.48),(x,-.83,.51),(x,-1.49,.60)],.025,'wood',sides=12)
        c('Shaft grip',x,-1.46,.60,.030,.15,'dark',axis='Y',sides=16)
        t('Mudguard rail',[(x,.11,.83),(x,.10,1.05),(x,.48,1.18),(x,.86,1.12)],.018,'metal')
        t('Hood bow',[(x,.73,1.08),(x,1.03,1.43),(x,.98,1.60),(x,.70,1.63),(x,.40,1.51)],.016,'metal')
    # Closed canopy loft, broad front opening and visible rear folds.
    rings=[]
    for y,z,width in [(1.02,1.30,.71),(1.03,1.54,.81),(.79,1.65,.88),(.39,1.54,.87)]:
        rings.append([(sx*width/2,y,z+dz) for sx,dz in [(-1,-.012),(1,-.012),(1,.012),(-1,.012)]])
    H.P.append(kit.shell('Black cloth folding hood',rings,[H.M['lacquer']],[0]*3))
    for x in (-.28,-.14,0,.14,.28):t('Hood seams',[(x,1.045,1.45),(x,.79,1.662),(x,.39,1.55)],.004,'dark',sides=6)


def engawa(w,d,h):
    H.planks(0,0,h-.025,w,d,.050,n=round(d/.10))
    for x in (-w/2+.11,w/2-.11):
        for y in (-d/2+.08,d/2-.08):b('Bench leg',x,y,(h-.05)/2,.085,.085,h-.05,'dark',r=.003)
    for y in (-d/2+.08,d/2-.08):b('Long support',0,y,h-.090,w-.10,.065,.095,'dark')
    for x in (-w/2+.11,w/2-.11):b('End support',x,0,.15,.065,d-.13,.060)
    for x in (-w/2+.11,w/2-.11):
        for j in range(round(d/.10)):c('Wood dowel',x,-d/2+d*(j+.5)/round(d/.10),h-.002,.004,.004,'dark',sides=8,bevelled=False)


def gate(w,d,h):
    b('Chestnut post',0,0,.655,.20,.15,1.31,'wood',r=.006)
    b('Base shoe',0,0,.08,.215,.17,.16,'metal',r=.009)
    b('Name board',0,-.088,1.06,.156,.025,.19,'edge',r=.004)
    # Original abstract carving, no characters/font or copied signage.
    for j in range(3):b('Carved sign stroke',0,-.102,1.01+j*.045,.06 if j!=1 else .035,.005,.009,'ink',r=.001)
    b('Roof fascia',0,0,1.315,.36,d,.035,'dark')
    for x,ang in ((-.10,-.28),(.10,.28)):
        o=b('Pitched roof',x,0,1.365,.212,d,.040,'wood',r=.003);rotate(o,(x,0,1.365),'Y',ang)
    b('Ridge cap',0,0,1.40,.047,d,.023,'dark')


def counter(stem,w,d,h):
    carcass(w,d,h)
    fy=-d/2+.028
    if stem.endswith('450'):H.drawers(0,fy,.12,w-.09,.615,n=3)
    elif stem.endswith('600'):
        H.drawers(0,fy,.56,w-.09,.17,n=1)
        board_door(0,fy,.335,w-.095,.43)
    else:
        for x in (-w/4,w/4):board_door(x,fy,.425,w/2-.036,.62)
    for y in (-.16,.16):b('Top breadboard joint',0,y,h-.006,w-.024,.004,.012,'dark',r=.0006,seg=1)


def kamado(w,d,h):
    p('Lime plaster oven',[(w,d,.075,0),(w,d,.075,.09),(w-.035,d-.035,.09,.57)],'plaster',n=6)
    b('Stone hearth ledge',0,-d/2+.045,.05,w,.15,.10,'stone',r=.015)
    b('Firemouth shadow',0,-d/2-.002,.235,.30,.014,.23,'fire',r=.075,seg=5)
    for j in range(11):
        a=math.pi*j/10;center=(.177*math.cos(a),-d/2-.014,.22+.177*math.sin(a))
        rotate(b('Arch masonry',*center,.065,.035,.046,'stone',r=.006),center,'Y',a-math.pi/2)
    for x in (-.18,.18):b('Arch foot',x,-d/2-.014,.15,.056,.035,.14,'stone',r=.005)
    l('Flanged iron rice pot',[(.14,.55),(.185,.575),(.213,.68),(.25,.688),(.25,.710),(.207,.718),(.199,.760)],'metal',n=40)
    c('Rice pot wooden lid',0,0,.775,.211,.026,'wood',sides=40)
    b('Lid hand grip',0,0,.795,.29,.044,.024,'dark')


def hood(w,d,h):
    rings=[]
    for width,depth,z in [(w,d,.03),(w,d,.09),(.43,.32,.45),(.27,.24,.47),(.27,.24,h)]:
        rings.append([(sx*width/2,sy*depth/2,z) for sx,sy in [(1,1),(-1,1),(-1,-1),(1,-1)]])
    # Actual open underside, closed thin metal walls instead of a capped solid.
    outer=rings[:4];inner=[[(x*.96,y*.96,z+.009) for x,y,z in ring] for ring in reversed(outer)]
    closed_ring_loft('Copper smoke canopy',outer+inner,'copper')
    flue_rings=[]
    for ww,dd,zz in [(.27,.24,.46),(.27,.24,h),(.25,.22,h),(.25,.22,.46)]:
        flue_rings.append([(sx*ww/2,sy*dd/2,zz) for sx,sy in [(1,1),(-1,1),(-1,-1),(1,-1)]])
    closed_ring_loft('Open copper flue',flue_rings,'copper')
    for y in (-d/2+.025,d/2-.025):b('Canopy wood rim',0,y,.045,w,.05,.09,'dark')
    for x in (-w/2+.025,w/2-.025):b('Canopy end rim',x,0,.045,.05,d-.05,.09,'dark')
    for x in (-.35,.35):t('Hanging strap',[(x,.18,.085),(x,.18,h)],.006,'metal',sides=8)
    for x in (-.2,0,.2):b('Folded seam',x,-.22,.22,.014,.008,.19,'copper',r=.001)


def icebox(w,d,h):
    carcass(w,d,h)
    for z,hh in ((.40,.60),(1.16,.84)):
        board_door(0,-d/2+.030,z,w-.09,hh)
        H.handle(w*.32,-d/2+.002,z,w=.065,mat='brass')
        for zz in (z-hh*.32,z+hh*.32):
            b('Brass hinge',-w*.40,-d/2+.006,zz,.075,.012,.033,'brass',r=.003)
    for x in (-w/2+.05,w/2-.05):b('Outer frame strip',x,-d/2+.018,h/2,.028,.014,h-.06,'dark')
    b('Compartments dividing rail',0,-d/2+.015,.735,w-.065,.035,.042,'dark')
    c('Drain spigot',w*.32,-d/2+.014,.11,.014,.03,'brass',axis='Y')


def sink(w,d,h):
    H.build_sink([1200,600,800])
    # The same authored terrazzo vessel and tap as set 1, resized to 900 wide.
    for o in H.P:
        for v in o.data.vertices:v.co.x*=w/1.20


def chadansu(w,d,h):
    carcass(w,d,h)
    lower=.22 if h<.7 else .30
    H.drawers(0,-d/2+.025,.12,w-.09,lower,n=1)
    z0=.12+lower+.035;hh=h-z0-.075
    b('Shelf division',0,0,z0-.016,w-.085,d-.055,.032,'dark')
    for i in range(2):
        lw=(w-.08)/2;cx=(i-.5)*lw;y=-d/2+.044+i*.018
        H.rail_frame(cx,z0,lw,hh,.026,y=y,rail=.027)
        b('Sliding inset',cx,y+.007,z0+hh/2,lw-.06,.013,hh-.056,'paper' if h>.7 else 'wood')
        for x in (cx-lw/2+.03,cx+lw/2-.03):b('Sliding stile',x,y-.012,z0+hh/2,.022,.025,hh,'dark')
        c('Recessed circular pull',cx+(-1 if i==0 else 1)*lw*.35,y-.016,z0+hh*.48,.017,.008,'metal',axis='Y')
    for y in (-d/2+.028,-d/2+.064):b('Sliding track',0,y,z0+.008,w-.06,.012,.014,'dark',r=.001)


def oshiire(w,d,h):
    carcass(w,d,h)
    lw=(w-.092)/2
    for i in range(2):
        cx=(i-.5)*lw;y=-d/2+.050+i*.025
        H.rail_frame(cx,.12,lw,h-.19,.035,y=y,rail=.035,mat='dark')
        b('Washi fusuma',cx,y+.008,(h+.05)/2,lw-.07,.022,h-.26,'paper',r=.003)
        c('Fusuma inset pull',cx+(.14 if i==0 else -.14),y-.012,.90,.032,.010,'metal',axis='Y',sides=24)
    b('Fusuma header',0,-d/2+.035,h-.095,w,.070,.090,'wood')
    b('Fusuma sill',0,-d/2+.035,.088,w,.070,.065,'wood')


def bonsai(w,d,h):
    table(.54,.39,.13,False)
    p('Oval bonsai bowl',[(.33,.245,.09,.13),(.41,.30,.095,.18),(.43,.32,.098,.235),(.39,.28,.09,.235),(.32,.22,.07,.157)],'clay',cy=.015,n=8)
    ellipsoid('Mounded soil',(0,.015,.188),(.17,.115,.020),'soil')
    trunk=[(-.065,.015,.20),(-.08,.02,.30),(-.03,.014,.405),(.02,.02,.46),(.015,.015,.59),(.09,.028,.63)]
    t('Twisted pine trunk',trunk,.025,'bark',sides=12)
    branches=[(trunk[2],(-.19,-.015,.40),(-.245,-.02,.425)),
              (trunk[3],(.17,-.01,.45),(.235,-.045,.47)),
              (trunk[4],(-.06,.07,.56),(-.13,.09,.58)),
              (trunk[-1],(.145,.01,.65),(.15,.01,.665))]
    for a,bb,cc in branches:
        t('Pine branch',[a,bb,cc],.013,'bark',sides=8)
        # Overlapping low foliage pads retain a trained pine silhouette.
        for j in range(3):
            x=cc[0]+(j-1)*.052;y=cc[1]+(.028 if j==1 else -.022)
            pine_pad((x,y,cc[2]+.025),(.10,.079,.038))
    pine_pad((.10,.02,.67),(.11,.08,.038))


def curtain(w,d,h):
    c('Wood curtain pole',0,.047,h-.026,.023,w,'wood',axis='X',sides=24)
    for side in (-1,1):
        # Fully closed double surface: folds narrow at the tie, flare at hem.
        nx=32;nz=12;verts=[]
        for back in (0,1):
            for k in range(nz+1):
                v=k/nz;z=.01+(h-.09)*v
                width=w*(.22-.085*math.exp(-((v-.42)/.18)**2))
                for j in range(nx+1):
                    u=j/nx;x=side*(w/2-.020-width*u)
                    y=-.025+.040*math.cos(u*math.pi*10)+(back-.5)*.005
                    verts.append((x,y,z))
        layer=(nx+1)*(nz+1);faces=[];mats=[]
        for back in (0,1):
            off=back*layer
            for k in range(nz):
                for j in range(nx):
                    ix=off+k*(nx+1)+j
                    face=(ix,ix+1,ix+nx+2,ix+nx+1)
                    faces.append(face if (side==1) != bool(back) else tuple(reversed(face)))
                    mats.append(1 if j in (5,6,18,19,29) else 0)
        edge=list(range(nx+1))+[k*(nx+1)+nx for k in range(1,nz+1)]+list(range(nz*(nx+1)+nx-1,nz*(nx+1)-1,-1))+[k*(nx+1) for k in range(nz-1,0,-1)]
        for i,a in enumerate(edge):
            bb=edge[(i+1)%len(edge)];faces.append((a,bb,bb+layer,a+layer));mats.append(0)
        o=H.mesh('Open gathered linen drape',verts,faces,'linen');o.data.materials.append(H.M['indigo'])
        for face,mi in zip(o.data.polygons,mats):face.material_index=mi;face.use_smooth=True
        x=side*(w/2-w*.073);b('Indigo tie band',x,-.04,h*.42,w*.145,.062,.034,'indigo',r=.009)
        for j in range(6):
            xx=side*(w/2-.02-w*.22*(j+.5)/6)
            t('Curtain suspension loop',[(xx,-.040,h-.07),(xx,-.043,h-.01),(xx,.040,h-.01),(xx,.041,h-.07)],.004,'linen',sides=8)
    # Rear brackets establish full 150mm depth as working curtain hardware.
    for x in (-w/2+.05,w/2-.05):b('Pole wall bracket',x,.078,h-.027,.025,.145,.030,'metal',r=.003)


def washstand(w,d,h):
    table(w,d,h-.19,True)
    r=w*.28
    l('White ceramic hand basin',[(r*.55,h-.215),(r*.85,h-.18),(r,h-.105),(r,h-.085),
       (r*.91,h-.085),(r*.82,h-.13),(r*.47,h-.185)],'ceramic',cy=-.025,n=48)
    c('Basin drain',0,-.025,h-.181,.021,.005,'brass',sides=20)
    y=d/2-.067
    t('Brass mixer neck',[(.11,y,h-.20),(.11,y,h-.09),(.11,y-.020,h-.017),
       (.11,y-.083,h),(.11,y-.15,h-.05)],.012,'brass',sides=12)
    c('Tap plinth',.11,y,h-.184,.026,.019,'brass',sides=20)
    H.handle(-.10,y-.003,h-.125,w=.066,mat='brass')


def toilet(w,d,h):
    p('Ceramic pedestal',[(.21,.30,.08,0),(.27,.35,.10,.06),(.19,.26,.08,.18),(.31,.43,.11,.35)],'ceramic',cy=-.11,n=8)
    p('Ceramic bowl',[(.29,.40,.10,.29),(.36,.50,.14,.36),(.395,.54,.15,.43),
       (.395,.54,.15,.455),(.305,.445,.135,.455),(.24,.35,.10,.34),(.16,.23,.07,.24)],'ceramic',cy=-.075,n=8)
    # A hollow wooden oval seat, solid lid upright behind the bowl.
    rings=[kit.rounded_rect(0,-.075,.42,.56,.16,z,n=8) for z in (.454,.480)]
    rings += [kit.rounded_rect(0,-.075,.31,.45,.135,z,n=8) for z in (.480,.454)]
    closed_ring_loft('Wooden open toilet seat',rings,'wood')
    lid=p('Upright wooden lid',[(.40,.51,.15,0),(.40,.51,.15,.027)],'wood',n=8)
    for v in lid.data.vertices:
        x,y,z=v.co;v.co=Vector((x,.19-z,.47+(y+.255)))
    for x in (-.115,.115):c('Seat hinge',x,.18,.482,.013,.08,'brass',axis='X')
    carc_y=d/2-.08
    b('Wooden high cistern',0,carc_y,1.41,.40,.16,.36,'wood',r=.012,seg=3)
    b('Cistern lid',0,carc_y,1.602,.42,.18,.026,'dark',r=.006)
    b('Tank front panel',0,carc_y-.087,1.41,.33,.015,.28,'edge',r=.007)
    t('High tank flush pipe',[(0,carc_y,1.23),(0,carc_y,.57),(0,.10,.43)],.017,'brass',sides=12)
    c('Pull lever',.23,carc_y-.06,1.45,.011,.11,'brass',axis='X')
    for j in range(17):
        z=1.43-j*.027
        ellipsoid('Chain link',(.264,carc_y-.067,z),(.005,.005,.015),'brass',segments=8,rings=4)
    ellipsoid('Pull chain grip',(.264,carc_y-.067,.945),(.021,.015,.042),'wood')


def shower(w,d,h):
    t('Brass rising pipe',[(.03,.20,.10),(.03,.20,1.77),(.03,.18,1.94),
      (.03,.10,1.985),(.03,-.12,1.985),(.03,-.19,1.93)],.014,'brass',sides=12)
    l('Rain shower head',[(.017,1.87),(.072,1.90),(.081,1.914),(.036,1.942),(.018,1.95)],'brass',cx=.03,cy=-.19,n=40)
    for a in range(8):
        x=.03+.048*math.cos(a*math.pi/4);y=-.19+.048*math.sin(a*math.pi/4)
        c('Shower spray holes',x,y,1.869,.003,.002,'ink',sides=8,bevelled=False)
    for z in (.80,1.61):
        c('Wall pipe fixing',.03,.224,z,.03,.035,'brass',axis='Y')
    c('Mixer cross',.03,.20,.87,.021,.20,'brass',axis='X');H.handle(-.035,.18,.90,.075,'brass')
    table(.27,.29,.22,False,'hinoki')
    l('Hinoki bathing bucket',[(.065,.22),(.092,.23),(.11,.39),(.095,.39),(.075,.25)],'hinoki',cy=-.025,n=32)
    for z,r in ((.26,.097),(.355,.107)):annular_band('Bucket copper band',r,z,.018,.004,'copper',cy=-.025,n=32)
    t('Bucket carrying handle',[(-.10,-.025,.37),(-.10,-.025,.49),(.10,-.025,.49),(.10,-.025,.37)],.010,'hinoki',sides=8)


def tarai(w,d,h):
    table(w,d,.23,False)
    l('Wood wash tub',[(.20,.23),(.245,.27),(.28,.43),(.28,.46),(.255,.46),(.235,.30),(.20,.27)],'hinoki',cx=-.11,n=48)
    for z,r in ((.28,.248),(.421,.280)):
        annular_band('Copper tub hoop',r,z,.023,.006,'copper',cx=-.11,n=48)
    for j in range(24):
        a=j*math.pi/12
        t('Tub stave seam',[(-.11+.244*math.cos(a),.244*math.sin(a),.28),
            (-.11+.282*math.cos(a),.282*math.sin(a),.455)],.0018,'edge',sides=6)
    center=(.20,-.025,.46)
    o=b('Washboard core',*center,.22,.032,.34,'wood',r=.008);rotate(o,center,'X',-.20)
    for j in range(11):
        z=.33+j*.020;o=b('Washboard rib',.20,-.048,z,.185,.014,.010,'edge',r=.003)
        rotate(o,center,'X',-.20)
    for x in (.086,.314):
        o=b('Washboard side',x,-.028,.46,.022,.042,.35,'dark',r=.004);rotate(o,center,'X',-.20)


def monohoshi(w,d,h):
    c('Bamboo drying pole',0,0,h-.025,.018,w,'bamboo',axis='X',sides=24)
    for x in (-.49,-.22,.05,.32,.49):c('Bamboo node',x,0,h-.025,.020,.014,'bamboo',axis='X',sides=24)
    for x in (-.43,.43):
        t('Forged wall hook',[(x,.041,h-.11),(x,.041,h),(x,-.039,h),(x,-.039,h-.050)],.007,'metal')
        b('Wall bracket plate',x,.044,h-.065,.040,.006,.10,'metal')
    for x in (-.22,.14):
        # Linen doubled over pole with a curved shoulder and thick closed hem.
        yz=[(-.020,.010),(-.020,h-.025),(-.014,h-.005),(0,h),(.014,h-.005),
            (.020,h-.025),(.020,.045),(.014,.045),(.014,h-.025),(0,h-.010),
            (-.014,h-.025),(-.014,.010)]
        verts=[(x+side*.115,y,z) for side in (-1,1) for y,z in yz]
        n=len(yz);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        for j in range(n):
            k=(j+1)%n;faces.append((j,k,n+k,n+j))
        H.mesh('Hanging folded tenugui',verts,faces,'linen')
        for xx in (x-.076,x+.077):b('Indigo towel stripe',xx,-.023,.135,.008,.003,.215,'indigo',r=.0006,seg=1)


def ac_cover(w,d,h):
    # Open wood grille enclosure with rear mounting rails, no modern plastic unit.
    for y in (-d/2+.018,d/2-.018):H.rail_frame(0,0,w,h,.036,y=y,rail=.028)
    for i in range(1,18):b('Front lattice stave',-w/2+w*i/18,-d/2+.020,h/2,.018,.030,h-.05,'wood',r=.002)
    for x in (-w/2+.014,w/2-.014):
        for j in range(1,5):b('End lattice batten',x,0,h*j/5,.028,d-.035,.019,'dark',r=.002)
    for j in range(1,8):b('Top ventilation slat',0,-d/2+d*j/8,h-.010,w-.035,.018,.020,'wood',r=.002)
    for x in (-w/2+.10,w/2-.10):b('Wall mounting cleat',x,d/2-.012,h/2,.035,.024,h-.065,'dark')


def build_item(it):
    materials();stem=it['stem'];w,d,h=[v/1000 for v in it['size']]
    if stem=='rickshaw':rickshaw(w,d,h)
    elif stem.startswith('engawa-bench'):engawa(w,d,h)
    elif stem=='gate-post':gate(w,d,h)
    elif stem.startswith('kitchen-counter'):counter(stem,w,d,h)
    elif stem=='kitchen-worktable':table(w,d,h)
    elif stem=='kamado-single':kamado(w,d,h)
    elif stem=='smoke-hood':hood(w,d,h)
    elif stem=='icebox':icebox(w,d,h)
    elif stem=='sink-900':sink(w,d,h)
    elif stem.startswith('chadansu'):chadansu(w,d,h)
    elif stem=='oshiire':oshiire(w,d,h)
    elif stem=='hanadai':table(w,d,h,False)
    elif stem=='bonsai':bonsai(w,d,h)
    elif stem.startswith('curtain'):curtain(w,d,h)
    elif stem.startswith('washstand'):washstand(w,d,h)
    elif stem=='toilet':toilet(w,d,h)
    elif stem=='shower':shower(w,d,h)
    elif stem=='tarai':tarai(w,d,h)
    elif stem=='monohoshi':monohoshi(w,d,h)
    elif stem=='ac-cover':ac_cover(w,d,h)
    else:raise ValueError(stem)
    o=kit.combine(H.P);kit.activate(o);bpy.ops.object.material_slot_remove_unused()
    H.fit(o,it['size'])
    # Recalculate outward normals of closed components (including drape sides).
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    mod=o.modifiers.new('Explicit export triangulation','TRIANGULATE');mod.quad_method='BEAUTY'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o['provenance']='original';o['frontAxis']='+Z';o['upAxis']='+Y';o['pivot']='bottom-center'
    return o


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--only',nargs='+')
    parser.add_argument('--output-root',type=Path,default=ROOT)
    a=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out=a.output_root.resolve();items=json.loads((HERE/'catalogue.json').read_text())['items']
    kit.GLB_DIR=out/'assets/models/packs/kominka/models';kit.GLB_DIR.mkdir(parents=True,exist_ok=True)
    kit.WORK_DIR=out/'tools/blender/kominka/set2/sources'
    rows=[];tags=json.loads((ROOT/'assets/models/tags.json').read_text())['kinds']
    for it in items:
        if a.only and it['stem'] not in a.only:continue
        mid=it['id'];print('BUILD '+mid,flush=True)
        kit.clear_scene();obj=build_item(it)
        channels=sorted({m.get('finishChannel') for m in obj.data.materials if m.get('finishChannel')})
        kit.run([(mid,it['size'],lambda it=it:build_item(it),set(channels),20000)],do_export=True,do_icons=False)
        check=json.loads((kit.WORK_DIR/(mid+'-validation.json')).read_text())
        assert check['uv']['excluded_triangles']==0,(mid,check['uv'])
        rec={k:it[k] for k in ('name','id','group','kind','defaultElevation') if k in it}
        rec['category']=it.get('category') or tags[it['kind']]['ja']
        for key,folder,suffix in [('model','models','.glb'),('thumb','previews','-thumb.png'),('top','previews','-top.png')]:
            rec[key]=f'assets/models/packs/kominka/{folder}/{mid}{suffix}'
        rec.update(w=it['size'][0],d=it['size'][1],h=it['size'][2],provenance='original',
          finishChannels=[dict(key=ch,label=PALETTE[ch][0],default=PALETTE[ch][1]) for ch in channels])
        rows.append(rec)
    # Only append set 2 items, preserving every existing set 1 field/value/order.
    if not a.only:
        path=out/'assets/models/packs/kominka/manifest.json'
        baseline=ROOT/'assets/models/packs/kominka/manifest.json'
        manifest=json.loads((path if path.exists() else baseline).read_text())
        ids={it['id'] for it in items}
        manifest['items']=[it for it in manifest['items'] if it['id'] not in ids]+rows
        path.write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n')

if __name__=='__main__':main()
