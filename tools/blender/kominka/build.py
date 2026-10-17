"""Original Japanese vernacular forms. Blender -Y front -> glTF +Z front.
Run: Blender -b --factory-startup -P tools/blender/kominka/build.py
Optional: -- --only chair --output-root /tmp/kominka-replay
No downloaded geometry, photographs, fonts or image textures are used.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
import model_kit as kit
from exterior_build import hex_rgb

PALETTE = {
    'wood': ('木部', '#5c412b', .74, 0),
    'fabric': ('布', '#263c51', .96, 0),
    'metal': ('金物', '#282a29', .55, .72),
    'paper': ('和紙', '#ded8c6', .94, 0),
    'stone': ('石', '#85847c', .92, 0),
    'rush': ('い草', '#96956a', .92, 0),
    'plaster': ('漆喰', '#d9d2c0', .94, 0),
    'bamboo': ('竹', '#83714d', .82, 0),
    'brass': ('真鍮', '#897247', .42, .78),
    'copper': ('銅', '#805344', .46, .8),
}
M = {}
P = []

def materials():
    global M, P
    P = []
    M = {}
    for channel, (label, color, rough, metal) in PALETTE.items():
        mat = kit.matp('Kominka_' + channel, color, rough=rough, metal=metal)
        mat['finishChannel'] = channel
        M[channel] = mat
    for key, channel, color in [('dark','wood','#3b2b20'),('edge','wood','#705039'),
                                ('hinoki','wood','#aa8b60'),('cream','fabric','#d1c6af'),
                                ('gold','metal','#8a7040')]:
        M[key] = kit.matp('Kominka_' + key, color, rough=.77 if channel=='wood' else .7,
                          metal=.6 if channel=='metal' else 0)
        M[key]['finishChannel'] = channel
    for key,color in [('ink','#262c28'),('ash','#908f87'),('fire','#30241e')]:
        M[key] = kit.matp('Kominka_' + key, color, rough=.97)
    glass = kit.matp('Glass', '#dfe8ea', rough=.35)
    glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = .25
    glass.diffuse_color = (*hex_rgb('#dfe8ea'), .25)
    glass.surface_render_method = 'BLENDED'
    M['glass'] = glass


def box(name, x, y, z, w, d, h, mat='wood', r=.003, seg=2):
    o = kit.box(name, (x-w/2,y-d/2,z-h/2), (x+w/2,y+d/2,z+h/2), M[mat],
                min(r,w/4,d/4,h/4), seg)
    P.append(o)
    return o


def cyl(name, x,y,z, radius,length,mat='wood',axis='Z',sides=16, bevelled=True):
    if not bevelled:
        bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=radius,depth=length,location=(x,y,z))
        o=bpy.context.object
        o.name=name
        if axis=='X':o.rotation_euler.y=math.pi/2
        elif axis=='Y':o.rotation_euler.x=math.pi/2
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        o.data.materials.append(M[mat])
        P.append(o)
        return o
    o = kit.cylinder(name,(x,y,z),radius,length,M[mat],axis=axis,sides=sides)
    P.append(o)
    return o


def mesh(name, vertices, faces, mat):
    me=bpy.data.meshes.new(name)
    me.from_pydata(vertices,[],faces)
    me.update()
    o=bpy.data.objects.new(name,me)
    bpy.context.collection.objects.link(o)
    me.materials.append(M[mat])
    P.append(o)
    return o


def tube(name, points, radius, mat='metal', sides=8):
    """Closed polyline tube; parallel transported frames, capped ends."""
    pts=[Vector(v) for v in points]
    verts=[]
    prev=None
    for i,p in enumerate(pts):
        tangent=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        normal=tangent.cross(Vector((0,1,0)))
        if normal.length<.01: normal=tangent.cross(Vector((0,0,1)))
        normal.normalize()
        if prev is not None and normal.dot(prev)<0: normal=-normal
        prev=normal
        other=tangent.cross(normal).normalized()
        for j in range(sides):
            a=2*math.pi*j/sides
            verts.append(tuple(p+radius*(math.cos(a)*normal+math.sin(a)*other)))
    faces=[tuple(reversed(range(sides)))]
    for i in range(len(pts)-1):
        for j in range(sides):
            k=(j+1)%sides
            faces.append((i*sides+j,i*sides+k,(i+1)*sides+k,(i+1)*sides+j))
    faces.append(tuple((len(pts)-1)*sides+j for j in range(sides)))
    o=mesh(name,verts,faces,mat)
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    return o


def lathe(name, rows, mat, cx=0,cy=0,n=32):
    """Closed revolved profile; nonzero terminal rings capped."""
    vertices=[(cx+r*math.cos(2*math.pi*j/n),cy+r*math.sin(2*math.pi*j/n),z)
              for r,z in rows for j in range(n)]
    faces=[tuple(reversed(range(n)))]
    for i in range(len(rows)-1):
        for j in range(n):
            k=(j+1)%n
            faces.append((i*n+j,i*n+k,(i+1)*n+k,(i+1)*n+j))
    faces.append(tuple((len(rows)-1)*n+j for j in range(n)))
    o=mesh(name,vertices,faces,mat)
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    return o


def profile(name,rows,mat='wood',cy=0,n=4):
    o=kit.profile(name,rows,M[mat],cy=cy,n=n)
    P.append(o)
    return o


def ring_front(name,r0,r1,z,depth,mat='wood',y=0,n=64,square=False):
    verts=[]
    for yy,r in ((y-depth/2,r0),(y-depth/2,r1),(y+depth/2,r0),(y+depth/2,r1)):
        for j in range(n):
            a=2*math.pi*j/n
            rad=r/max(abs(math.cos(a)),abs(math.sin(a))) if square and r==r1 else r
            verts.append((rad*math.cos(a),yy,z+rad*math.sin(a)))
    faces=[]
    for j in range(n):
        k=(j+1)%n
        faces.extend([(j,k,n+k,n+j),(2*n+j,3*n+j,3*n+k,2*n+k),
                      (j,2*n+j,2*n+k,k),(n+j,n+k,3*n+k,3*n+j)])
    return mesh(name,verts,faces,mat)


def rail_frame(cx,z0,w,h,depth,y=0,rail=.04,mat='wood'):
    for x in (cx-w/2+rail/2,cx+w/2-rail/2):
        box('Stile',x,y,z0+h/2,rail,depth,h,mat)
    for z in (z0+rail/2,z0+h-rail/2):
        box('Rail',cx,y,z,w-2*rail,depth,rail,mat)


def lattice(cx,z0,w,h,depth,y,nx,nz=1,mat='wood',thick=.014):
    for i in range(1,nx):
        box('Kumiko vertical',cx-w/2+w*i/nx,y,z0+h/2,thick,depth,h,mat,r=.001,seg=1)
    for j in range(1,nz):
        box('Kumiko horizontal',cx,y,z0+h*j/nz,w,depth,thick,mat,r=.001,seg=1)


def planks(cx,y,z,w,d,h,n=6,vertical=False,mat='wood'):
    for i in range(n):
        if vertical:
            box('Board',cx-w/2+w*(i+.5)/n,y,z,w/n-.002,d,h,
                mat if i%3 else ('edge' if mat=='wood' else mat),r=.0015)
        else:
            box('Slab plank',cx,y-d/2+d*(i+.5)/n,z,w,d/n-.002,h,
                mat if i%3 else ('edge' if mat=='wood' else mat))


def handle(x,y,z,w=.065,mat='metal'):
    box('Escutcheon',x,y+.002,z,w+.026,.004,.048,mat,r=.004)
    for xx in (x-w/2,x+w/2): box('Handle foot',xx,y-.007,z,.009,.018,.014,mat,r=.002)
    tube('Forged pull',[(x-w/2,y-.011,z),(x-w/2,y-.021,z-.012),
                        (x+w/2,y-.021,z-.012),(x+w/2,y-.011,z)],.0045,mat)


def drawers(cx,y,z0,w,h,n=3,mat='wood'):
    for j in range(n):
        z=z0+h*(j+.5)/n
        box('Drawer front',cx,y,z,w-.006,.032,h/n-.008,mat,r=.002)
        handle(cx,y-.022,z,w=min(.10,w*.28))
        for x in (cx-w/2+.025,cx+w/2-.025):
            box('Corner strap',x,y-.019,z,.022,.005,h/n-.02,'metal',r=.001)


def fit(obj,size):
    """Bake final physical envelope, keeping every object's transform identity."""
    pts=[obj.matrix_world@v.co for v in obj.data.vertices]
    lo=[min(p[i] for p in pts) for i in range(3)]
    hi=[max(p[i] for p in pts) for i in range(3)]
    for v,p in zip(obj.data.vertices,pts):
        v.co=Vector(((p[0]-(lo[0]+hi[0])/2)*size[0]/1000/(hi[0]-lo[0]),
                     (p[1]-(lo[1]+hi[1])/2)*size[1]/1000/(hi[1]-lo[1]),
                     (p[2]-lo[2])*size[2]/1000/(hi[2]-lo[2])))
    obj.matrix_world.identity()
    obj.data.update()
    return obj


def build_opening(stem,size):
    w,d,h=[v/1000 for v in size]
    if stem=='door-itado':
        planks(0,0,h/2,w,.032,h,n=7,vertical=True)
        for z in (.24,1.0,1.77):
            box('Cross batten',0,.020,z,w-.035,.017,.082,'dark')
        handle(w/2-.08,-.020,.99,w=.055)
        for z in (.30,1.69):
            box('Strap hinge',-w/2+.045,-.023,z,.09,.010,.027,'metal',r=.002)
    elif stem=='door-shoji':
        rail_frame(0,0,w,h,.05,rail=.032)
        planks(0,0,.225,w-.064,.034,.418,n=5,vertical=True)
        box('Waist rail',0,0,.45,w-.064,.052,.045)
        box('Washi panel',0,.012,1.223,w-.064,.008,1.483,'paper',r=.001)
        lattice(0,.478,w-.064,1.490,.019,-.018,4,7,thick=.012)
        box('Recessed pull',w/2-.017,-.026,.91,.020,.008,.075,'metal')
    elif stem=='round-window':
        ring_front('Square spandrel',.365,.45,.45,.09,'wood',square=True)
        ring_front('Round reveal',.340,.370,.45,.145,'dark')
        cyl('Circular washi',0,.025,.45,.345,.008,'paper',axis='Y',sides=64)
        for x in (-.22,-.11,0,.11,.22):
            hh=2*math.sqrt(.34**2-x*x)
            cyl('Bamboo upright',x,-.034,.45,.006,hh,'bamboo',sides=8)
        for z in (.30,.48,.65):
            ww=2*math.sqrt(.34**2-(z-.45)**2)
            cyl('Bamboo horizontal',0,-.035,z,.006,ww,'bamboo',axis='X',sides=8,bevelled=False)
    else:
        rail_frame(0,0,w,h,d,rail=.05)
        if stem=='casement-window':
            # Front lattice protrudes from inner shoji; top/bottom deep shelves.
            for z in (.045,h-.045):box('Projecting shelf',0,-.035,z,w-.08,d,.05,'dark')
            rail_frame(0,.05,w-.10,h-.10,.038,y=-d/2+.020,rail=.035)
            lattice(0,.085,w-.17,h-.17,.024,-d/2+.021,12,3,thick=.022)
            box('Inner shoji paper',0,d/2-.04,h/2,w-.10,.008,h-.10,'paper')
            lattice(0,.06,w-.12,h-.12,.020,d/2-.025,6,4,thick=.012)
            for x in (-w/2+.045,w/2-.045):
                box('Return side',x,0,h/2,.035,d,h-.06)
        else:
            count=4 if stem=='engawa-glass-door' else 2
            trans=.30 if count==4 else 0
            leafh=h-.10-trans
            lw=(w-.10)/count
            for i in range(count):
                cx=-w/2+.05+lw*(i+.5)
                y=.018 if i%2==0 else .046
                rail_frame(cx,.05,lw,leafh,.045,y=y,rail=.030)
                waist=.36 if count==4 else (.10 if stem=='entrance-door' else 0)
                if waist:
                    planks(cx,y,.05+waist/2,lw-.06,.030,waist-.015,n=3,vertical=True)
                    box('Waist rail',cx,y,.05+waist,lw-.06,.045,.028)
                box('Glass pane',cx,y+.005,.05+waist+(leafh-waist)/2,
                    lw-.06,.006,leafh-waist-.06,'glass',r=.001)
                lattice(cx,.05+waist,lw-.065,leafh-waist-.035,.018,y-.025,
                        6 if stem=='entrance-door' else 2,3 if count==4 else 2,thick=.014)
                box('Flush sliding pull',cx+lw/2-.04,y-.024,.80 if h>1.5 else h/2,
                    .014,.007,.068,'metal')
            if stem=='sliding-window':
                rail_frame(0,.04,w-.08,h-.08,.032,y=-d/2+.022,rail=.024)
                lattice(0,.07,w-.14,h-.14,.027,-d/2+.020,15,2,thick=.024)
            if count==4:
                rail_frame(0,h-.30,w-.10,.25,.05,y=-.03,rail=.025)
                box('Transom paper',0,0,h-.175,w-.16,.007,.19,'paper')
                lattice(0,h-.265,w-.16,.18,.020,-.037,18,2,thick=.011)


def build_table(stem,size):
    w,d,h=[v/1000 for v in size]
    low=stem=='zataku'
    thick=.062 if low else .060
    # A single slab with gently irregular live edges, not parallel boards.
    xs=[-w/2,-w*.36,-w*.16,w*.10,w*.30,w/2]
    verts=[]
    edge=[1,.98,.94,.97,.95,1]
    plan=[(x,-d/2*edge[i]) for i,x in enumerate(xs)]+[(x,d/2*edge[i]) for i,x in reversed(list(enumerate(xs)))]
    for z in (h-thick,h): verts.extend((x,y,z) for x,y in plan)
    n=len(plan)
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    slab=mesh('Single keyaki slab',verts,faces,'wood')
    kit.bevel(slab,.006,3)
    for x in (-w/2+.13,w/2-.13):
        for y in (-d/2+.11,d/2-.11):
            box('Heavy mortised leg',x,y,(h-thick)/2,.095 if low else .085,.10,h-thick,'dark',r=.008)
            if low:
                box('Carved shoulder',x,y,h-.12,.125,.13,.10,'wood',r=.018,seg=3)
                for yy in (y-.055,y+.055):
                    tube('Shoulder carving',[(x-.044,yy,h-.12),(x,yy,h-.14),(x+.044,yy,h-.12)],.003,'edge')
    for y in (-d/2+.11,d/2-.11):box('Long apron',0,y,h-thick-.055,w-.22,.036,.09)
    for x in (-w/2+.13,w/2-.13):box('Side apron',x,0,h-thick-.055,.04,d-.20,.09)
    # Subtle grain relief on the slab, all original geometry; no image maps.
    for j in range(7):
        yy=-d*.35+d*.70*j/6
        tube('Slab grain',[(x,yy+.006*math.sin(i*1.7+j),h+.0005) for i,x in enumerate(xs)],.0006,'edge',sides=6)


def cushion(x,y,z,w,d,h,mat='fabric'):
    o=box('Soft cushion',x,y,z,w,d,h,mat,r=min(h*.39,.045),seg=5)
    # Cloth welts follow a rounded rectangle, recessed from the silhouette.
    ring=kit.rounded_rect(x,y,w-.016,d-.016,min(.042,h*.3),z,n=3)
    tube('Sewn welt',[tuple(p) for p in ring]+[tuple(ring[0])],.002,mat,sides=6)
    return o


def build_seating(stem,size):
    w,d,h=[v/1000 for v in size]
    if stem=='chair':
        for x in (-.180,.180):
            for y in (-.195,.195):
                box('Chair leg',x,y,.20,.045,.045,.40,'dark',r=.005)
        rail_frame(0,.44,.45,.36,.045,y=.225,rail=.046)
        lattice(0,.49,.358,.259,.025,.225,5,1,thick=.021)
        box('Seat frame',0,-.01,.415,.45,.48,.05,'wood',r=.012)
        box('Rush woven seat',0,-.02,.445,.373,.397,.026,'rush',r=.006)
        for i in range(26):
            box('Rush strand',0,-.205+.37*i/25,.459,.353,.006,.003,'rush',r=.0008)
        for x in (-.18,.18):box('Lower side stretcher',x,0,.18,.025,.39,.036)
        box('Front stretcher',0,-.195,.20,.34,.025,.037)
    elif stem=='zaisu':
        box('Floor runner',0,-.017,.025,.45,.55,.05,'dark',r=.012)
        cushion(0,-.07,.086,.414,.43,.092)
        for x in (-.193,.193):box('Back upright',x,.235,.257,.041,.04,.386)
        box('Back crest',0,.235,.423,.45,.045,.052,'wood',r=.015)
        for x in (-.10,0,.10):box('Back slat',x,.235,.284,.038,.024,.235)
        for x in (-.197,.197):box('Base rail',x,0,.063,.040,.49,.047)
    else:
        for x in (-.81,.81):
            for y in (-.30,.30):box('Sofa leg',x,y,.115,.085,.085,.23,'dark',r=.008)
        box('Sofa seat deck',0,0,.295,w-.09,d-.06,.105,'wood',r=.012)
        for x in (-.84,.84):
            for y in (-.325,.325):box('Arm support',x,y,.47,.06,.065,.42)
            box('Arm cap',x,0,.666,.12,.80,.07,'wood',r=.023)
        box('Back top',0,.356,.718,w,.073,.065,'dark',r=.013)
        box('Back lower',0,.356,.425,w-.12,.057,.070)
        for x in (-.66,-.44,-.22,0,.22,.44,.66):box('Back spindle',x,.356,.567,.039,.027,.248)
        for x in (-.515,0,.515):
            cushion(x,-.05,.393,.50,.625,.14)
            o=cushion(x,.254,.58,.50,.12,.265)
            # modest recline, explicitly baked before combining
            for v in o.data.vertices: v.co.y += .14*(v.co.z-.58)


def build_bed(size):
    w,d,h=[v/1000 for v in size]
    for x in (-w/2+.10,w/2-.10):
        for y in (-.88,.88):box('Bed foot',x,y,.065,.12,.12,.13,'dark',r=.008)
    box('Low sleeping platform',0,0,.151,w,d,.085,'wood',r=.015)
    planks(0,0,.201,w-.035,d-.030,.025,n=12)
    cushion(0,-.02,.252,w-.09,2.00,.081,'cream')
    cushion(0,-.24,.32,w-.065,1.57,.11,'fabric')
    # Folded cream lining at the upper edge and gently uneven stitched ridges.
    cushion(0,.527,.360,w-.095,.185,.036,'cream')
    count=2 if w>1.1 else 1
    for i in range(count):
        x=(i-(count-1)/2)*.62
        cushion(x,.800,.352,.49,.285,.094,'cream')
    for x in (-w*.26,0,w*.26):
        tube('Quilt seam',[(x,-.98,.365),(x+.013,-.55,.375),(x-.008,-.12,.377),(x,.44,.373)],.0017,'fabric')


def carcass(w,d,h,mat='wood'):
    box('Back panel',0,d/2-.013,(h-.040+.078)/2,w-.088,.026,h-.118,mat)
    for x in (-w/2+.022,w/2-.022):box('Cabinet side',x,0,(h-.040+.078)/2,.044,d,h-.118,mat)
    box('Cabinet top',0,0,h-.020,w,d,.040,mat)
    box('Plinth',0,0,.039,w,d,.078,'dark',r=.009)


def build_storage(stem,size):
    w,d,h=[v/1000 for v in size]
    if stem=='kaidan-dansu':
        # Six closed step cabinets, stairs ascend left-to-right in front view.
        n=6;sw=w/n
        for i in range(n):
            cx=-w/2+sw*(i+.5);sh=h*(i+1)/n
            box('Step cabinet body',cx,0,(sh-.034)/2,sw-.004,d-.027,sh-.034,'dark',r=.004)
            box('Tread cap',cx,0,sh-.017,sw,d,.034,'wood')
            if i%2==0:drawers(cx,-d/2, .035,sw-.026,sh-.080,max(1,i+1))
            else:
                rail_frame(cx,.05,sw-.026,sh-.095,.033,y=-d/2,rail=.020)
                planks(cx,-d/2+.01,sh/2,sw-.065,.016,sh-.14,n=3,vertical=True)
                handle(cx+sw*.28,-d/2-.027,min(.63,sh*.55),w=.033)
    else:
        mat='dark' if stem=='butsudan' else 'wood'
        carcass(w,d,h,mat)
        y=-d/2-.004
        if stem=='tansu':
            drawers(0,y,.10,w-.085,h-.15,6)
            for x in (-w/2+.030,w/2-.030):
                box('Tall iron corner',x,y-.023,h/2,.036,.007,h-.12,'metal')
        elif stem=='mizuya':
            drawers(0,y,.82,w-.09,.18,2)
            for x in (-w*.235,w*.235):
                rail_frame(x,1.02,w*.46,h-1.075,.047,y=y,rail=.035)
                box('Cupboard glazing',x,y+.015,1.385,w*.40,.008,.62,'glass')
                lattice(x,1.06,w*.39,.66,.017,y-.025,5,3,thick=.015)
                rail_frame(x,.10,w*.46,.70,.037,y=y,rail=.028)
                planks(x,y,.45,w*.40,.024,.62,n=4,vertical=True)
                handle(x+w*.13,y-.03,.45,w=.055)
        elif stem=='butsudan':
            for x in (-w*.23,w*.23):
                rail_frame(x,.18,w*.455,h-.31,.04,y=y,rail=.032,mat='dark')
                box('Closed altar door',x,y+.005,.78,w*.385,.025,1.08,'dark',r=.011)
                box('Recessed field',x,y-.009,.84,w*.26,.012,.83,'wood',r=.012)
                for z in (.35,1.22):box('Quiet gilt hinge',x-w*.155,y-.023,z,.037,.005,.065,'gold')
                handle(x+(w*.16 if x<0 else -w*.16),y-.027,.83,w=.027,mat='gold')
        else:
            for x in (-w*.235,w*.235):
                rail_frame(x,.12,w*.46,h-.18,.034,y=y,rail=.026)
                planks(x,y+.003,h*.51,w*.40,.020,h-.245,n=4,vertical=True)
                handle(x+(w*.13 if x<0 else -w*.13),y-.024,.59,w=.045)


def build_desk(size):
    w,d,h=[v/1000 for v in size]
    box('Keyaki desktop',0,0,h-.027,w,d,.054,'wood',r=.009)
    for y in (-.235,.235):box('Free desk leg',-.50,y,.338,.074,.074,.676,'dark',r=.006)
    box('Left foot stretcher',-.50,0,.11,.034,.49,.044)
    box('Drawer pedestal',.365,0,.330,.39,.53,.66,'dark')
    drawers(.365,-.276,.10,.352,.54,3)
    box('Desk apron',0,.246,.615,w-.15,.037,.11)
    box('Pencil drawer',-.21,-.255,.620,.65,.04,.11)
    handle(-.21,-.282,.62,w=.08)


def build_light(stem,size):
    if stem=='andon':
        box('Andon base',0,0,.035,.30,.30,.07,'dark',r=.009)
        box('Andon cap',0,0,.781,.30,.30,.038,'wood',r=.007)
        for x in (-.127,.127):
            for y in (-.127,.127):box('Andon post',x,y,.422,.028,.028,.704)
        for axis in (0,1):
            for sign in (-1,1):
                if axis==0:box('Washi side',sign*.126,0,.414,.004,.230,.650,'paper',r=.001)
                else:box('Washi front',0,sign*.126,.414,.230,.004,.650,'paper',r=.001)
        for z in (.22,.43,.65):
            for y in (-.135,.135):box('Andon horizontal',0,y,z,.25,.012,.012)
            for x in (-.135,.135):box('Andon side rail',x,0,z,.012,.25,.012)
    else:
        shade=[(max(.025,.25*math.sin(math.pi*j/24)),.16-.16*math.cos(math.pi*j/24)) for j in range(25)]
        lathe('Washi lantern shade',shade,'paper',n=48)
        for j in range(18):
            a=2*math.pi*j/18
            points=[((r+.002)*math.cos(a),(r+.002)*math.sin(a),z) for r,z in shade]
            tube('Bamboo rib',points,.003,'bamboo',sides=6)
        for r,z in ((.249,.16),(.241,.20),(.026,.003),(.026,.317)):
            tube('Bamboo hoop',[(r*math.cos(2*math.pi*j/48),r*math.sin(2*math.pi*j/48),z) for j in range(49)],.003,'bamboo',sides=6)
        cyl('Suspension cord',0,0,.36,.003,.08,'fabric',sides=8,bevelled=False)


def ink_stroke(points,r=.003):tube('Original brush mark',points,r,'ink',sides=6)


def build_art(stem,size):
    w,d,h=[v/1000 for v in size]
    if stem=='hengaku':
        rail_frame(0,0,w,h,d,rail=.033,mat='dark')
        box('Calligraphy field',0,.005,h/2,w-.08,.020,h-.08,'paper')
        # Invented, deliberately nonliteral marks; no real person's calligraphy.
        for j in range(4):
            x=-.39+j*.26
            ink_stroke([(x-.04,-.014,.34),(x+.025,-.014,.31),(x-.012,-.014,.13)],.008)
            ink_stroke([(x-.084,-.014,.238),(x+.075,-.014,.247),(x+.047,-.014,.18)],.006)
            ink_stroke([(x-.026,-.014,.19),(x-.092,-.014,.11),(x+.062,-.014,.12)],.004)
    else:
        box('Scroll backing',0,.003,.85,.51,.012,1.61,'fabric',r=.001)
        box('Painting silk',0,-.005,.86,.412,.006,1.13,'paper',r=.001)
        for z in (.025,1.675):cyl('Scroll roller',0,0,z,.014,.55,'dark',axis='X',sides=16)
        for j in range(6):
            z=.53+j*.105
            ink_stroke([(-.19,-.010,z),(-.12,-.010,z+.12),(-.07,-.010,z+.06),(.01,-.010,z+.18),(.08,-.010,z+.08),(.18,-.010,z+.11)],.0015+j*.00025)
        for j in range(5):ink_stroke([(-.12+j*.065,-.010,.42),(-.07+j*.056,-.010,.46),(.08+j*.018,-.010,.43)],.0012)
        ink_stroke([(-.16,-.010,.48),(-.15,-.010,.64),(-.18,-.010,.76)],.003)
        for z in (.60,.66,.71):ink_stroke([(-.185,-.010,z),(-.15,-.010,z+.028),(-.11,-.010,z+.008)],.002)


def build_screen(stem,size):
    w,d,h=[v/1000 for v in size]
    if stem=='tsuitate':
        for x in (-.465,.465):box('Screen foot',x,0,.048,.16,.35,.096,'dark',r=.018)
        rail_frame(0,.08,1.20,1.12,.046,rail=.054)
        box('Screen washi',0,.003,.65,1.078,.008,.97,'paper')
        lattice(0,.15,1.07,.98,.016,-.020,8,4,thick=.012)
        box('Screen middle rail',0,-.017,.41,1.08,.022,.034)
    else:
        # Dense bamboo rods, closed cross section, with twin lifting cords.
        for j in range(112):
            z=.018+(h-.036)*j/111
            cyl('Sudare bamboo',0,0,z,.0055,w,'bamboo',axis='X',sides=8,bevelled=False)
        box('Sudare top lath',0,0,h-.012,w,.026,.024,'wood')
        box('Sudare bottom weight',0,0,.012,w,.026,.024,'wood')
        for x in (-.63,-.21,.21,.63):
            tube('Binding cord',[(x,-.006,.02),(x,-.006,1.77)],.002,'fabric',sides=6)
        for x in (-.63,.63):
            tube('Roll-up cord',[(x,-.012,.07),(x,-.012,1.788),(x,.012,1.788),(x,.012,.60)],.003,'fabric')


def build_rug(size):
    box('Rush mat',0,0,.004,2,2,.008,'rush',r=.002)
    for x in (-.971,.971):box('Woven border',x,0,.0055,.056,2,.007,'fabric',r=.001)
    for y in (-.971,.971):box('Woven border',0,y,.0055,1.89,.056,.007,'fabric',r=.001)
    for i in range(85):box('Rush weave',0,-.93+1.86*i/84,.009,1.88,.005,.001,'rush',r=.0002)
    # Restrained broken diagonal woven motif in the same rush family.
    for x in (-.66,0,.66):
        for y in (-.66,0,.66):
            for j in range(4):
                box('Woven accent',x-.06+j*.04,y-.06+j*.04,.0092,.025,.08,.001,'bamboo',r=.0002)


def build_irori(size):
    box('Hearth pedestal',0,0,.071,1.11,1.11,.142,'dark',r=.008)
    for x in (-.521,.521):box('Heavy hearth edge',x,0,.159,.158,1.20,.108,'wood',r=.010)
    for y in (-.521,.521):box('Heavy hearth edge',0,y,.159,.884,.158,.108,'wood',r=.010)
    box('Ash bed',0,0,.121,.885,.885,.032,'ash',r=.007)
    for j in range(14):
        x=.26*math.sin(j*2.7);y=.25*math.cos(j*1.9)
        cyl('Charcoal',x,y,.146,.020,.06,'fire',axis='X',sides=8)
    for j in range(3):
        a=2*math.pi*j/3
        cyl('Trivet foot',.115*math.cos(a),.115*math.sin(a),.204,.012,.125,'metal',sides=12)
    tube('Trivet hoop',[(.14*math.cos(2*math.pi*j/24),.14*math.sin(2*math.pi*j/24),.265) for j in range(25)],.012,'metal')
    lathe('Iron kettle',[(.08,.267),(.122,.29),(.145,.34),(.135,.39),(.08,.41)],'metal',n=32)
    lathe('Kettle lid',[(.084,.407),(.08,.417),(.025,.433)],'metal',n=24)
    tube('Kettle arch handle',[(.105*math.cos(math.pi*j/16),0,.377+.073*math.sin(math.pi*j/16)) for j in range(17)],.009,'metal')
    tube('Kettle spout',[(.12,-.005,.323),(.175,-.006,.339),(.194,-.006,.388)],.016,'metal',sides=12)


def build_kamado(size):
    profile('Plastered stove body',[(1.20,.70,.045,0),(1.20,.70,.045,.08),(1.14,.65,.070,.52),(1.07,.59,.065,.58)],'plaster')
    for cx in (-.29,.29):
        # Arch portal made from voussoirs, dark recessed combustion chamber.
        box('Fire chamber',cx,-.341,.231,.305,.008,.296,'fire',r=.04,seg=4)
        for x in (cx-.163,cx+.163):box('Portal jamb',x,-.35,.162,.042,.05,.215,'stone')
        for j in range(12):
            a=math.pi*j/11
            o=box('Arch stone',cx+.16*math.cos(a),-.35,.26+.16*math.sin(a),.050,.054,.039,'stone',r=.006)
            # Rotate each block around its own center in the facade plane.
            center=Vector((cx+.16*math.cos(a),-.35,.26+.16*math.sin(a)))
            from mathutils import Matrix
            rot=Matrix.Rotation(a-math.pi/2,3,'Y')
            for v in o.data.vertices:v.co=center+rot@(v.co-center)
        lathe('Hagama cast pot',[(.14,.536),(.18,.555),(.205,.66),(.227,.673),(.227,.692),(.202,.701),(.188,.743)],'metal',cx=cx,n=32)
        cyl('Wood pot lid',cx,0,.759,.209,.030,'wood',sides=32)
        box('Lid crossbar',cx,0,.788,.33,.038,.024,'dark')


def build_sink(size):
    for x in (-.48,.48):
        for y in (-.235,.235):box('Stone support',x,y,.279,.095,.095,.558,'stone',r=.012)
    box('Stone lower ledge',0,0,.14,1.08,.50,.05,'stone',r=.01)
    # Continuous vessel: underside -> outer rim -> inner wall -> basin floor.
    profile('Terrazzo basin',[(1.20,.60,.065,.51),(1.20,.60,.065,.605),
        (1.20,.60,.065,.667),(1.065,.455,.045,.667),(1.01,.405,.07,.552)],'stone',n=5)
    cyl('Drain',0,0,.554,.030,.006,'brass',sides=20)
    box('Rear upstand',0,.2725,.663,1.18,.035,.17,'stone',r=.008)
    tube('Brass gooseneck',[(-.02,.222,.684),(-.02,.222,.742),(-.02,.210,.78),
        (-.02,.171,.798),(-.02,.119,.790),(-.02,.071,.770),(-.02,.045,.741)],.012,'brass',sides=12)
    cyl('Tap base',-.02,.222,.681,.033,.03,'brass',sides=16)
    cyl('Tap spindle',.055,.221,.713,.015,.060,'brass',sides=12)
    box('Cross tap handle',.055,.221,.747,.084,.022,.012,'brass',r=.005)


def build_bath(size):
    # Substantial wooden walls and an open inner bathing well.
    profile('Hinoki tub vessel',[(1.32,.72,.07,0),(1.40,.80,.07,.09),
       (1.40,.80,.07,.55),(1.40,.80,.07,.60),(1.23,.63,.055,.60),
       (1.20,.60,.07,.12)],'hinoki',n=5)
    for x in (-.700,.700):
        for j in range(10):box('Side stave line',x, -.33+.66*j/9,.326,.001,.003,.425,'edge',r=.0002)
    for y in (-.400,.400):
        for j in range(17):box('End stave line',-.64+1.28*j/16,y,.326,.003,.001,.425,'edge',r=.0002)
    for z in (.135,.432):
        ring=kit.rounded_rect(0,0,1.408,.808,.073,z,n=4)
        # A wide flat band, closed cross-section, following the exterior.
        verts=[]
        for zz in (z-.018,z+.018):
            for offset in (0,.004):
                verts.extend((p.x*(1+offset),p.y*(1+offset),zz) for p in ring)
        n=len(ring);faces=[]
        for j in range(n):
            k=(j+1)%n
            faces.extend([(j,k,n+k,n+j),(2*n+j,3*n+j,3*n+k,2*n+k),
                          (j,2*n+j,2*n+k,k),(n+j,n+k,3*n+k,3*n+j)])
        mesh('Copper hoop',verts,faces,'copper')
    cyl('Bath drain',.42,.20,.123,.022,.004,'copper',sides=16)


def build_lantern(size):
    # Kasuga: tall pedestal, shaft, polygonal lantern, flared hip roof, finial.
    profile('Stone base',[(.60,.60,.025,0),(.60,.60,.025,.095),(.49,.49,.025,.145),(.43,.43,.025,.17)],'stone')
    lathe('Stone shaft',[(.145,.15),(.12,.20),(.11,.83),(.15,.87)],'stone',n=12)
    profile('Lantern platform',[(.30,.30,.018,.85),(.44,.44,.025,.91),(.43,.43,.025,.945)],'stone')
    for x in (-.142,.142):
        for y in (-.142,.142):box('Lantern pillar',x,y,1.066,.06,.06,.248,'stone',r=.006)
    box('Lantern rear',0,.148,1.067,.256,.035,.248,'stone',r=.008)
    box('Lantern inner shadow',0,.025,1.013,.20,.18,.020,'ink',r=.002)
    box('Lantern lintel',0,0,1.197,.37,.37,.055,'stone',r=.009)
    # Swept roof corners rise slightly at the broad eaves.
    rings=[]
    for width,z in ((.53,1.226),(.58,1.25),(.43,1.277),(.24,1.355),(.12,1.379)):
        rings.append([(sx*width/2,sy*width/2,z) for sx,sy in ((1,1),(-1,1),(-1,-1),(1,-1))])
    o=kit.shell('Kasuga flared roof',rings,[M['stone']],[0]*4);P.append(o)
    lathe('Lotus finial',[(.064,1.369),(.083,1.407),(.052,1.454),(.004,1.50)],'stone',n=16)
    for x in (-.048,.048):box('Lantern front grille',x,-.155,1.077,.014,.023,.18,'stone')


def build_item(item):
    materials()
    s=item['stem'];size=item['size']
    if 'category' in item:build_opening(s,size)
    elif s in ('dining-table','zataku'):build_table(s,size)
    elif s in ('chair','zaisu','sofa'):build_seating(s,size)
    elif s.startswith('bed-'):build_bed(size)
    elif s in ('tansu','kaidan-dansu','mizuya','butsudan','shoe-storage'):build_storage(s,size)
    elif s=='desk':build_desk(size)
    elif s in ('andon','pendant'):build_light(s,size)
    elif s in ('hengaku','kakejiku'):build_art(s,size)
    elif s in ('tsuitate','sudare'):build_screen(s,size)
    elif s=='hanagoza':build_rug(size)
    elif s=='irori':build_irori(size)
    elif s=='kamado':build_kamado(size)
    elif s=='sink':build_sink(size)
    elif s=='hinoki-bath':build_bath(size)
    elif s=='ishidoro':build_lantern(size)
    else:raise ValueError(s)
    obj=kit.combine(P)
    # Remove unused material slots so finish channel checks reflect visible parts.
    kit.activate(obj)
    bpy.ops.object.material_slot_remove_unused()
    fit(obj,size)
    # Freeze the same triangles for UV validation and glTF export. Exporter
    # diagonal changes can otherwise collapse a very narrow curved UV face.
    kit.activate(obj)
    mod=obj.modifiers.new('Explicit export triangulation','TRIANGULATE')
    mod.quad_method='BEAUTY'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--only',nargs='+')
    parser.add_argument('--output-root',type=Path,default=ROOT)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    catalog=json.loads((HERE/'catalogue.json').read_text())
    out=args.output_root.resolve()
    kit.GLB_DIR=out/'assets/models/packs/kominka/models'
    kit.WORK_DIR=out/'tools/blender/kominka/sources'
    kit.PREVIEW_DIR=out/'assets/models/packs/kominka/previews'
    kit.GLB_DIR.mkdir(parents=True,exist_ok=True)
    manifest=[]
    for it in catalog['items']:
        if args.only and it['stem'] not in args.only:continue
        mid='kominka-'+it['stem']+'-01'
        print('BUILD '+mid,flush=True)
        # Build once to derive the actually used finish channels; run rebuilds it.
        kit.clear_scene()
        obj=build_item(it)
        channels=sorted({m.get('finishChannel') for m in obj.data.materials if m.get('finishChannel')})
        kit.run([(mid,it['size'],lambda it=it:build_item(it),set(channels),
                  8000 if 'category' in it else 20000)],do_export=True,do_icons=False)
        check=json.loads((kit.WORK_DIR/(mid+'-validation.json')).read_text())
        assert check['uv']['excluded_triangles']==0,(mid,check['uv'])
        rec={k:v for k,v in it.items() if k in ('name','kind','defaultElevation')}
        rec.update(id=mid,group=it.get('group','家具'),category=it.get('category',''))
        if not rec['category']:
            tags=json.loads((ROOT/'assets/models/tags.json').read_text())
            rec['category']=tags['kinds'][it['kind']]['ja']
        rec.update(model=f'assets/models/packs/kominka/models/{mid}.glb',
                   thumb=f'assets/models/packs/kominka/previews/{mid}-thumb.png',
                   top=f'assets/models/packs/kominka/previews/{mid}-top.png',
                   w=it['size'][0],d=it['size'][1],h=it['size'][2],provenance='original',
                   finishChannels=[dict(key=c,label=PALETTE[c][0],default=PALETTE[c][1]) for c in channels])
        manifest.append(rec)
    if not args.only:
        (out/'assets/models/packs/kominka/manifest.json').write_text(json.dumps(
            dict(set='kominka',name='日本古民家',items=manifest),ensure_ascii=False,indent=1)+'\n')

if __name__=='__main__':main()
