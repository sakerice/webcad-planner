"""Original mansion door leaves. Blender -Y front, Z up, bottom-centre origin.

Blender --background --factory-startup --python tools/blender/rpg_mansion/doors/build.py
This exports geometry/UV/source only; render.py produces the icons separately.
No catalogue registration here.
"""
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / 'tools/blender'))
import model_kit as kit
from model_kit import box, cylinder, bevel, combine, matp

kit.GLB_DIR = ROOT / 'assets/models/packs/rpg-mansion/models'
kit.PREVIEW_DIR = ROOT / 'assets/models/packs/rpg-mansion/previews'
kit.WORK_DIR = HERE / 'sources'

IDS = ['rpg-mansion-door-six-panel-01', 'rpg-mansion-door-glazed-01',
       'rpg-mansion-door-ledged-01', 'rpg-mansion-entrance-door-01',
       'rpg-mansion-entrance-door-glazed-01']


def material(name, colour, channel=None, rough=.4, metallic=0):
    m = matp(name, colour, rough=rough, metal=metallic)
    if channel:
        m['finishChannel'] = channel
    return m


def glass(name='Glass', colour='#dfe8ea'):
    m = material(name, colour, rough=.16)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    rgba = list(bsdf.inputs['Base Color'].default_value)
    rgba[3] = .25
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Alpha'].default_value = .25
    m.surface_render_method = 'DITHERED'
    m.use_transparency_overlap = False
    return m


def frame(parts, x0, x1, z0, z1, thickness, wood, stile=.085, rails=.09):
    """The structural rails/stiles of the leaf, never an external door frame."""
    for lo, hi in [((x0,-thickness/2,z0),(x0+stile,thickness/2,z1)),
                   ((x1-stile,-thickness/2,z0),(x1,thickness/2,z1)),
                   ((x0+stile,-thickness/2,z0),(x1-stile,thickness/2,z0+rails)),
                   ((x0+stile,-thickness/2,z1-rails),(x1-stile,thickness/2,z1))]:
        parts.append(box('Leaf stile or rail',lo,hi,wood,.0018,2))


def molding(parts, x0, x1, z0, z1, y, sign, wood):
    """Closed rectangular bolection profile, with mitred corners and a raised bead."""
    profile = [(0,0),(.004,.003),(.009,.003),(.015,.001),(.020,-.001)]
    rings = []
    for inset, depth in profile:
        rings.append([(x0+inset,y+sign*depth,z0+inset),
                      (x1-inset,y+sign*depth,z0+inset),
                      (x1-inset,y+sign*depth,z1-inset),
                      (x0+inset,y+sign*depth,z1-inset)])
    # Return underneath to the start, making an annular watertight molding.
    rings.extend([[(x0+.020,y-sign*.003,z0+.020),(x1-.020,y-sign*.003,z0+.020),
                   (x1-.020,y-sign*.003,z1-.020),(x0+.020,y-sign*.003,z1-.020)],
                  [(x0,y-sign*.003,z0),(x1,y-sign*.003,z0),
                   (x1,y-sign*.003,z1),(x0,y-sign*.003,z1)]])
    verts = [p for ring in rings for p in ring]
    faces=[]
    for k in range(len(rings)):
        nxt=(k+1)%len(rings)
        for i in range(4):
            j=(i+1)%4
            faces.append((k*4+i,k*4+j,nxt*4+j,nxt*4+i))
    mesh=bpy.data.meshes.new('Mitred panel molding')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new('Panel molding',mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(wood)
    # Recalculate normals rather than rely on the front/back winding.
    kit.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(obj)


def panel(parts,x0,x1,z0,z1,t,wood):
    parts.append(box('Raised field panel',(x0,-t*.32,z0),(x1,t*.32,z1),wood,.004,3))
    for sign in (-1,1):
        molding(parts,x0-.008,x1+.008,z0-.008,z1+.008,sign*t*.45,sign,wood)
        # The smaller raised central field makes the stepped profile legible.
        ys=sorted((sign*t*.32,sign*t*.44))
        parts.append(box('Panel raised centre',(x0+.025,ys[0],z0+.025),
                         (x1-.025,ys[1],z1-.025),wood,.003,2))


def keyhole(parts,x,z,sign,y,metal,dark):
    parts.append(cylinder('Key escutcheon',(x,sign*y,z),.017,.003,metal,'Y',16))
    parts.append(cylinder('Keyhole round',(x,sign*(y+.002),z+.004),.004,.001,dark,'Y',12))
    ys=sorted((sign*(y+.0015),sign*(y+.0025)))
    parts.append(box('Keyhole slot',(x-.002,ys[0],z-.009),(x+.002,ys[1],z+.004),dark,.0005,1))


def knobs(parts,x,z,t,d,metal,dark):
    """Low-profile oval-in-depth knobs reach exact +/- bbox, without scaling."""
    for sign in (-1,1):
        parts.append(cylinder('Turned brass rose',(x,sign*(t/2+.002),z),.026,.004,metal,'Y',24))
        parts.append(cylinder('Knob spindle',(x,sign*(t/2+.006),z),.010,.010,metal,'Y',16))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=(x,sign*(d/2-.006),z))
        o=bpy.context.object
        o.name='Brass round knob'
        o.scale=(.023,.006,.023)
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        o.data.materials.append(metal)
        for p in o.data.polygons:p.use_smooth=True
        parts.append(o)
        keyhole(parts,x,z-.090,sign,t/2+.003,metal,dark)


def levers(parts,x,z,t,d,metal,dark):
    for sign in (-1,1):
        parts.append(cylinder('Lever rose',(x,sign*(t/2+.003),z),.024,.006,metal,'Y',20))
        parts.append(cylinder('Lever spindle',(x,sign*(t/2+.007),z),.009,.012,metal,'Y',16))
        ys=sorted((sign*(d/2-.012),sign*d/2))
        parts.append(box('Curved edge brass lever',(x-.109,ys[0],z-.009),(x+.008,ys[1],z+.009),metal,.006,3))
        keyhole(parts,x,z-.090,sign,t/2+.004,metal,dark)


def hinges(parts,w,h,t,metal):
    # Decorative hinge leaves only. App supplies the external hinge axis.
    for z in (.25,h/2,h-.25):
        for sign in (-1,1):
            ys=sorted((sign*t/2,sign*(t/2+.002)))
            parts.append(box('Hinge leaf',(-w/2+.005,ys[0],z-.035),(-w/2+.026,ys[1],z+.035),metal,.001,2))


def diagonal(parts, a, b, width, depth, material):
    mid=(Vector(a)+Vector(b))/2
    delta=Vector(b)-Vector(a)
    o=box('Rear Z brace',(-width/2,-depth/2,-delta.length/2),(width/2,depth/2,delta.length/2),material,.002,2)
    # Rotate only around Y: the 8mm depth must stay along Y, not turn into the 65mm width.
    o.rotation_euler=(0,math.atan2(delta.x,delta.z),0)
    o.location=mid
    kit.activate(o)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    parts.append(o)


def ring(parts,x,y,z,metal):
    bpy.ops.mesh.primitive_torus_add(major_radius=.051,minor_radius=.005,
                                   major_segments=32,minor_segments=8,location=(x,y,z),rotation=(math.pi/2,0,0))
    o=bpy.context.object
    o.name='Brass ring knocker'
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.materials.append(metal)
    for p in o.data.polygons:p.use_smooth=True
    parts.append(o)


def build(kind):
    entrance=kind>=3
    w,h,d,t=(.940,2.300,.090,.052) if entrance else (.760,2.000,.060,.026)
    colours=['#513523','#eee7d9','#796045','#193e31','#493422']
    wood=material('Door wood',colours[kind],'wood',.43)
    metal=material('Black iron' if kind==2 else 'Antique brass','#242829' if kind==2 else '#b18b42','metal',.34,.82)
    dark=material('Hardware recess','#121416',None,.75,.1)
    parts=[]
    if kind in (0,3):
        # Continuous solid leaf core backs every panel/rail joint. A door leaf
        # must never expose the background through a decorative join.
        parts.append(box('Solid leaf core',(-w/2,-t*.20,0),(w/2,t*.20,h),wood,.001,2))
        frame(parts,-w/2,w/2,0,h,t,wood)
        parts.append(box('Centre muntin',(-.028,-t/2,.09),(.028,t/2,h-.09),wood,.0015,2))
        rows=[(.12,.47),(.57,1.08),(1.18,1.87)] if kind==0 else [(.14,.94),(1.07,2.16)]
        for z0,z1 in rows:
            for x0,x1 in [(-w/2+.095,-.04),(.04,w/2-.095)]:
                panel(parts,x0,x1,z0,z1,t,wood)
        for z in ([.52,1.13] if kind==0 else [1.005]):
            parts.append(box('Intermediate rail',(-w/2+.08,-t/2+.001,z-.044),(w/2-.08,t/2-.001,z+.044),wood,.0015,2))
        knobs(parts,w/2-.059,1.0 if kind==0 else 1.09,t,d,metal,dark)
        if kind==3:
            # Centre decorative round pull, plus operational knobs at +X on both faces.
            parts.append(cylinder('Central round pull',(0,-.034,1.06),.036,.013,metal,'Y',24))
            ring(parts,0,-.035,1.71,metal)
            parts.append(cylinder('Knocker pivot',(0,-.030,1.765),.019,.007,metal,'Y',20))
            parts.append(cylinder('Knocker strike',(0,-.030,1.65),.013,.006,metal,'Y',16))
            parts.append(box('Mail slot surround',(-.137,-.033,.66),(.137,-.027,.719),metal,.004,3))
            parts.append(box('Mail aperture',(-.118,-.034,.682),(.118,-.033,.705),dark,.002,2))
            parts.append(box('Mail flap',(-.118,-.035,.685),(.118,-.032,.709),metal,.001,2))
    elif kind==1:
        frame(parts,-w/2,w/2,0,h,t,wood)
        panel(parts,-.279,.279,.12,.56,t,wood)
        parts.append(box('Lower transom',(-.30,-t/2+.001,.59),(.30,t/2-.001,.685),wood,.0018,2))
        g=glass()
        x0,x1,z0,z1=-.284,.284,.695,1.905
        for col in range(3):
            for row in range(5):
                xa=x0+(x1-x0)*col/3;xb=x0+(x1-x0)*(col+1)/3
                za=z0+(z1-z0)*row/5;zb=z0+(z1-z0)*(row+1)/5
                parts.append(box('Clear glazing pane',(xa,-.002,za),(xb,.002,zb),g,.0005,1))
        for x in [x0,x0+(x1-x0)/3,x0+2*(x1-x0)/3,x1]:
            parts.append(box('Glazing vertical muntin',(x-.012,-t/2,z0-.008),(x+.012,t/2,z1+.008),wood,.001,2))
        for z in [z0+i*(z1-z0)/5 for i in range(6)]:
            parts.append(box('Glazing horizontal muntin',(x0,-t/2+.001,z-.010),(x1,t/2-.001,z+.010),wood,.001,2))
        levers(parts,w/2-.055,1.0,t,d,metal,dark)
    elif kind==2:
        # Solid planks with actual 1.5mm joints backed by a thin leaf skin.
        parts.append(box('Joint backing',(-w/2,-.008,0),(w/2,.008,h),wood,.001,2))
        for i in range(7):
            xa=-w/2+i*w/7;xb=-w/2+(i+1)*w/7
            parts.append(box('Vertical timber plank',(xa+(.0008 if i else 0),-.014,0),
                             (xb-(.0008 if i<6 else 0),.013,h),wood,.001,2))
        for z in (.25,1.0,1.72):
            parts.append(box('Rear ledge',(-w/2+.014,.013,z-.048),(w/2-.014,.023,z+.048),wood,.002,2))
        diagonal(parts,(-.29,.020,.29),(.29,.020,1.68),.065,.008,wood)
        for z in (.25,1.72):
            parts.append(box('Black strap hinge',(-w/2+.005,-.018,z-.021),(.105,-.014,z+.021),metal,.002,2))
            for x in (-.32,-.20,-.08,.075):
                parts.append(cylinder('Hinge rivet',(x,-.020,z),.005,.003,metal,'Y',12))
        for sign in (-1,1):
            ys=sorted((sign*.025,sign*.030))
            parts.append(box('Latch handle',(w/2-.13,ys[0],.961),(w/2-.053,ys[1],.977),metal,.004,3))
            parts.append(box('Latch plate',(w/2-.060,sign*.012,.918),(w/2-.028,sign*.018,1.042),metal,.0015,2) if sign==1 else
                         box('Latch plate',(w/2-.060,-.018,.918),(w/2-.028,-.012,1.042),metal,.0015,2))
            parts.append(cylinder('Latch post',(w/2-.055,sign*.022,.969),.007,.012,metal,'Y',12))
    else:
        parts.append(box('Solid lower leaf core',(-w/2,-t*.20,0),(w/2,t*.20,1.202),wood,.001,2))
        frame(parts,-w/2,w/2,0,h,t,wood,.090,.105)
        parts.append(box('Lower centre muntin',(-.032,-t/2,.11),(.032,t/2,1.13),wood,.0018,2))
        for xa,xb in [(-.367,-.048),(.048,.367)]:
            panel(parts,xa,xb,.14,1.065,t,wood)
        parts.append(box('Glazing transom',(-.38,-t/2+.001,1.105),(.38,t/2-.001,1.202),wood,.002,2))
        gs=[glass('Glass Ivory','#dfe8ea'),glass('Glass Amber','#d6ab59'),
            glass('Glass Teal','#4e9691'),glass('Glass Ruby','#944754')]
        lead=material('Lead came','#464643',None,.5,.65)
        x0,x1,z0,z1=-.365,.365,1.218,2.185
        # Geometric leaded glass: central diamond in a 3 by 4 field.
        for col in range(3):
            for row in range(4):
                xa=x0+(x1-x0)*col/3;xb=x0+(x1-x0)*(col+1)/3
                za=z0+(z1-z0)*row/4;zb=z0+(z1-z0)*(row+1)/4
                parts.append(box('Stained glazing pane',(xa,-.003,za),(xb,.003,zb),gs[(col+row)%4],.0007,1))
        for x in [x0+i*(x1-x0)/3 for i in range(4)]:
            parts.append(box('Vertical lead came',(x-.0045,-.006,z0),(x+.0045,.006,z1),lead,.001,2))
        for z in [z0+i*(z1-z0)/4 for i in range(5)]:
            parts.append(box('Horizontal lead came',(x0,-.005,z-.0045),(x1,.005,z+.0045),lead,.001,2))
        # Diagonal metal cames overlay the coloured rectangle grid, avoiding large circular motifs.
        diamond=[(0,0,2.14),(.24,0,1.70),(0,0,1.26),(-.24,0,1.70),(0,0,2.14)]
        for a,b in zip(diamond,diamond[1:]):
            diagonal(parts,a,b,.010,.016,lead)
        for sign in (-1,1):
            molding(parts,x0-.015,x1+.015,z0-.01,z1+.01,sign*t*.45,sign,wood)
        levers(parts,w/2-.058,1.05,t,d,metal,dark)
    if kind!=2:hinges(parts,w,h,t,metal)
    # Clean each closed component separately; welding touching rails after join
    # would incorrectly connect several independent solid shells.
    for part in parts:
        bm=bmesh.new()
        bm.from_mesh(part.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        assert all(e.is_manifold for e in bm.edges),part.name
        bm.to_mesh(part.data)
        bm.free()
        part.data.update()
    obj=combine(parts)
    # Metadata survives GLB export and makes the two-face controls reviewable.
    obj['front']='+Z'
    obj['hingeEdge']='-X'
    obj['handleEdge']='+X'
    obj['doorLeafOnly']=True
    obj['originalProceduralAsset']=True
    return obj


if __name__=='__main__':
    kit.run([(stem,(940,90,2300) if i>=3 else (760,60,2000),
              lambda i=i:build(i),{'wood','metal'},12000) for i,stem in enumerate(IDS)],
            do_icons=False)
