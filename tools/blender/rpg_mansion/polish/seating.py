"""Measured, original seating refinements for the pinned PR81 mansion pack.

Blender 4.3.2 native meshes, no imported geometry, textures or paid services.
Run: blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/polish/seating.py
Optional --only sofa|wing-chair, --no-icons. Does not edit the pack manifest.

Design dimensions are authored directly in metres. No normalize/global scale is
used: both seats end at 460 mm, while their decorative back profiles preserve the
existing placement envelopes. All disconnected components are closed meshes.
"""
import sys, math, json, struct, hashlib
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
ROOT = FAMILY.parents[2]
sys.path.insert(0, str(FAMILY.parent))
sys.path.insert(0, str(FAMILY))
import model_kit as kit
from build_decor import lathe
from shape_kit import rounded_rect
from png_metadata import strip_metadata
import bpy, bmesh

PACK = ROOT / 'assets/models/packs/rpg-mansion'
kit.GLB_DIR = PACK / 'models'
kit.PREVIEW_DIR = PACK / 'previews'
kit.WORK_DIR = HERE / 'work'
P = {}

def palette():
    def mat(name, color, channel, rough=.55, metal=0):
        m = kit.matp(name, color, rough, metal)
        m['finishChannel'] = channel
        return m
    return dict(wood=mat('Polished walnut', '#493025', 'wood', .38),
                trim=mat('Carved walnut edge', '#704b32', 'wood', .43),
                fabric=mat('Oxblood woven velvet', '#672e37', 'fabric', .88),
                seam=mat('Oxblood cushion welting', '#52212a', 'fabric', .88),
                brass=mat('Antique brass hardware', '#b29455', 'metal', .32, .72))

def mesh(name, vertices, faces, material, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new(); bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data); bm.free()
    for p in data.polygons: p.use_smooth = smooth
    return obj

def shell(name, rings, material, extra=None, bands=None):
    """Closed layered profile; end-cap normals remain planar."""
    obj = kit.shell(name, rings, [material] + (extra or []), bands or [0]*(len(rings)-1))
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data); bm.free()
    return obj

def cushion(name, x, y, w, d):
    # Welded rounded volume with a real 2 mm projecting middle welt. The
    # 460 mm seat top is independent of the overall furniture height.
    rows = [(w-.060,d-.060,.062,.349),
            (w-.010,d-.010,.077,.366),
            (w-.003,d-.003,.080,.397),
            (w,d,.080,.402),
            (w,d,.080,.406),
            (w-.010,d-.010,.078,.432),
            (w-.065,d-.065,.063,.453),
            (w*.55,d*.55,.055,.460)]
    rings = [rounded_rect(x,y,a,b,r,z,n=2) for a,b,r,z in rows]
    ob = shell(name, rings, P['fabric'], [P['seam']], [0,0,1,1,0,0,0])
    ob['seat_top_mm'] = 460
    return ob

def profile_box(name, w,d,z0,z1,x=0,y=0,material='wood',r=.035):
    e=.007
    return shell(name,[rounded_rect(x,y,w-2*e,d-2*e,r-e,z0,2),
                       rounded_rect(x,y,w,d,r,z0+e,2),
                       rounded_rect(x,y,w,d,r,z1-e,2),
                       rounded_rect(x,y,w-2*e,d-2*e,r-e,z1,2)],P[material])

def carved_leg(x,y,sign=1):
    # Bowed cabriole-style support, not a stack of unrelated primitives.
    specs = [(0,.028,.027,0),(.072,.023,.023,.010),
             (.226,.036,.034,.021),(.302,.040,.040,0)]
    rings=[]
    for z,rx,ry,dx in specs:
        rings.append([(x+sign*dx+rx*math.cos(i*math.tau/8),
                       y+ry*math.sin(i*math.tau/8),z) for i in range(8)])
    shell('Authored curved walnut leg',rings,P['wood'])
    lathe('Brass foot ferrule',[(.028,0),(.029,.009),(.028,.028)],P['brass'],x,y,8)

def swept_arm(x, sign, chair=False):
    # Sofas have horizontal generous scroll arms; wing chairs rise toward the
    # back. Cross-sections define actual upholstery volume and exact X extrema.
    rows = [(-.425,.610,.012,.015),(-.417,.612,.056,.068),(-.400,.615,.080,.094),
            (-.348,.618,.095,.105),(-.190,.622,.086,.087),
            (.070,.652 if chair else .633,.078,.083),
            (.270,.737 if chair else .666,.073,.084),
            (.335,.755 if chair else .681,.058,.061)]
    rings=[]
    for y,z,rx,rz in rows:
        rings.append([(x+rx*math.cos(i*math.tau/12),y,z+rz*math.sin(i*math.tau/12))
                      for i in range(12)])
    shell('Rising wing-chair arm' if chair else 'Swept salon scroll arm',rings,P['fabric'])
    # A narrow inset front seam stays inside the arm envelope.
    ring_path('Arm scroll front welt',[(x+.059*math.cos(i*math.tau/12),-.414,
                                      .615+.072*math.sin(i*math.tau/12)) for i in range(12)],
              P['seam'],.0028,3)
    # Exposed support follows the padded arm; its concave apron is visibly wood.
    outline=[(x-sign*.034,.319),(x+sign*.036,.319),
             (x+sign*.048,.570),(x+sign*.045,.647 if chair else .602),
             (x-sign*.032,.561),(x-sign*.045,.465)]
    xz_volume('Carved arm support',outline,-.300,.260,P['trim'],.003)

def ring_path(name, points, material, radius=.011, sides=6):
    """Moulded closed path with smooth, native closed-ring topology."""
    verts=[]; n=len(points)
    for i,p in enumerate(points):
        v=Vector(p); tangent=(Vector(points[(i+1)%n])-Vector(points[(i-1)%n])).normalized()
        a=tangent.cross(Vector((0,1,0)))
        if a.length < .01: a=tangent.cross(Vector((0,0,1)))
        a.normalize(); b=tangent.cross(a).normalized()
        for j in range(sides):
            verts.append(tuple(v+radius*(math.cos(j*math.tau/sides)*a+math.sin(j*math.tau/sides)*b)))
    faces=[]
    for i in range(n):
        for j in range(sides):
            faces.append((i*sides+j,((i+1)%n)*sides+j,
                          ((i+1)%n)*sides+(j+1)%sides,i*sides+(j+1)%sides))
    return mesh(name,verts,faces,material)

def xz_volume(name, outline, front, rear, material, bevel=.01):
    verts=[(x,y,z) for y in [front,rear] for x,z in outline]; n=len(outline)
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    ob=mesh(name,verts,faces,material,False)
    return kit.bevel(ob,bevel,1) if bevel else ob

def curved_outline(points):
    """Two Catmull-Rom samples per authored point preserve the extrema."""
    out=[]; n=len(points)
    lo=[min(p[j] for p in points) for j in range(2)]; hi=[max(p[j] for p in points) for j in range(2)]
    for i in range(n):
        a,b,c,d=[Vector(points[j%n]) for j in [i-1,i,i+1,i+2]]
        for t in [0,.5]:
            q=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
            out.append(tuple(max(lo[j],min(hi[j],q[j])) for j in range(2)))
    return out

def walnut_surround(name, outer, inner, front=.303, rear=.418):
    # A solid annular joinery surround connects the visible crest moulding to
    # upholstery. This removes the detached-wire-frame appearance on the rear.
    assert len(outer)==len(inner)
    cx=sum(x for x,z in inner)/len(inner);cz=sum(z for x,z in inner)/len(inner)
    inner=[(cx+(x-cx)*.94,cz+(z-cz)*.94) for x,z in inner]
    n=len(outer)
    vertices=[(x,y,z) for y in [front,rear] for row in [outer,inner] for x,z in row]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
                      (i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    return mesh(name,vertices,faces,P['wood'],False)

def back_pillow(name, outline, cy, thickness, lean=.12):
    # Five silhouette layers, contracting toward both faces, produce a coherent
    # rounded back rather than an independently bevelled rectangular block.
    cx=sum(p[0] for p in outline)/len(outline)
    cz=sum(p[1] for p in outline)/len(outline)
    rings=[]
    for scale,dy in [(.90,-thickness*.50),(.976,-thickness*.40),(1,0),(.976,thickness*.40),(.90,thickness*.50)]:
        rings.append([(cx+(x-cx)*scale,cy+dy+lean*(z-.460),cz+(z-cz)*scale) for x,z in outline])
    return shell(name,rings,P['fabric'])

def stud(x,y,z):
    # Small button with a rounded bevel; all channels correspond to real parts.
    rings = [[(x+r*math.cos(i*math.tau/8), yy, z+r*math.sin(i*math.tau/8)) for i in range(8)]
             for r,yy in [(.007,y-.004),(.009,y-.002),(.009,y+.003)]]
    shell('Inset antique brass upholstery button',rings,P['brass'])

def sofa():
    global P; P=palette()
    for x in [-.895,.895]:
        for y in [-.332,.328]: carved_leg(x,y,1 if x>0 else -1)
    profile_box('Rounded walnut seat frame',1.890,.786,.271,.353,material='wood',r=.063)
    # Three separate, measured seats and their visible real-volume seam bands.
    for i,x in enumerate([-.552,0,.552]): cushion('Seat cushion %d, 460 mm top'%(i+1),x,-.081,.538,.594)
    outline=[(-.874,.448),(-.895,.790),(-.865,.876),(-.778,.916),
             (-.614,.928),(-.449,.979),(-.255,1.037),(0,1.066),
             (.255,1.037),(.449,.979),(.614,.928),(.778,.916),
             (.865,.876),(.895,.790),(.874,.448)]
    outline=curved_outline(outline)
    back_pillow('Continuous camelback upholstered back',outline,.304,.137,.075)
    crest=[(-.927,.438),(-.945,.797),(-.910,.902),(-.795,.957),
           (-.631,.969),(-.462,1.020),(-.265,1.081),(0,1.102),
           (.265,1.081),(.462,1.020),(.631,.969),(.795,.957),
           (.910,.902),(.945,.797),(.927,.438)]
    # Peak 1.120 m and rear 0.425 m are authored, not scaled after the fact.
    crest=curved_outline(crest)
    ring_path('Continuous carved camelback crest',[(x,.407,z) for x,z in crest],P['trim'],.018,8)
    walnut_surround('Continuous walnut camelback surround',crest,outline)
    kit.box('Finished rear lower walnut rail',(-.885,.389,.320),(.885,.417,.494),P['wood'],.003,1)
    for sign in [-1,1]: swept_arm(sign*.930,sign)
    for x,z in [(-.53,.758),(0,.812),(.53,.758)]: stud(x,.236+.075*(z-.46),z)
    # A proper carved front apron, rather than a thick square seat plinth.
    apron=[(-.898,.313),(.898,.313),(.850,.258),(.550,.245),(0,.225),
           (-.550,.245),(-.850,.258)]
    xz_volume('Scalloped walnut front apron',apron,-.407,-.371,P['trim'],.004)
    return finalize('sofa')

def wing_chair():
    global P; P=palette()
    for x in [-.322,.322]:
        for y in [-.327,.329]: carved_leg(x,y,1 if x>0 else -1)
    profile_box('Wing-chair walnut seat frame',.746,.786,.271,.353,material='wood',r=.052)
    cushion('Single wing-chair cushion, 460 mm top',0,-.081,.559,.594)
    outline=[(-.282,.444),(-.304,.826),(-.282,1.025),(-.224,1.133),
             (-.112,1.177),(0,1.188),(.112,1.177),(.224,1.133),
             (.282,1.025),(.304,.826),(.282,.444)]
    outline=curved_outline(outline)
    back_pillow('Rounded high wing-chair back',outline,.295,.143,.060)
    frame=[(-.329,.419),(-.352,.826),(-.328,1.044),(-.263,1.173),
           (-.134,1.202),(0,1.203),(.134,1.202),(.263,1.173),
           (.328,1.044),(.352,.826),(.329,.419)]
    frame=curved_outline(frame)
    ring_path('Carved arched chair back frame',[(x,.410,z) for x,z in frame],P['trim'],.015,8)
    walnut_surround('Continuous walnut high-back surround',frame,outline)
    kit.box('Finished chair rear lower walnut rail',(-.317,.389,.320),(.317,.417,.494),P['wood'],.003,1)
    # A centre crown meets the old 1220 mm envelope without tall seating.
    xz_volume('Arched crown medallion',[(-.064,1.177),(-.050,1.204),(0,1.220),(.050,1.204),(.064,1.177)],
              .379,.415,P['wood'],0)
    for sign in [-1,1]:
        # True flared protective wings. Their lower tails tuck into the rising
        # arm supports; front and back surfaces are shaped and upholstered.
        o=[(sign*.217,.612),(sign*.377,.661),(sign*.405,.808),
           (sign*.402,1.033),(sign*.368,1.104),(sign*.300,1.152),
           (sign*.202,1.106)]
        # The wing narrows toward its top and bulges forward in the middle.
        o=curved_outline(o)
        # Preserve the original forward face, but extend the real closed rear
        # volume into the central back. The widened inboard silhouette and
        # deeper rear face provide upholstered joinery, not camera concealment.
        ob=back_pillow('Integrated upholstered protective wing',o,.1975,.222,.035)
        cx=sum(x for x,z in o)/len(o); cz=sum(z for x,z in o)/len(o)
        welt=[(cx+(x-cx)*.976,.1975-.222*.40+.035*(z-.46),cz+(z-cz)*.976) for x,z in o]
        ring_path('Attached wing transition welt',welt,P['seam'],.0026,4)
        swept_arm(sign*.330,sign,True)
    for x,z in [(-.12,.869),(.12,.869),(0,1.061)]: stud(x,.218+.060*(z-.46),z)
    apron=[(-.335,.313),(.335,.313),(.285,.264),(0,.234),(-.285,.264)]
    xz_volume('Curved wing-chair front apron',apron,-.407,-.371,P['trim'],.004)
    return finalize('wing-chair')

def finalize(slug):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    components=[]
    for ob in objects:
        p=[ob.matrix_world@v.co for v in ob.data.vertices]
        components.append(dict(name=ob.name,triangles=kit.tri_count(ob),
                               bounds_m=[[min(v[i] for v in p) for i in range(3)],[max(v[i] for v in p) for i in range(3)]]))
    (HERE/'work'/(slug+'-components.json')).write_text(json.dumps(components,indent=2)+'\n')
    obj=kit.combine(objects)
    matrix=obj.matrix_world.copy()
    for v in obj.data.vertices: v.co=matrix@v.co
    obj.matrix_world.identity(); obj.data.update()
    obj['authorship']='Original native procedural Blender seating, locally authored'
    obj['source']=str((HERE/'seating.py').relative_to(ROOT))
    obj['seatTopMm']=460
    obj['geometryRevision']='measured-seating-20261008'
    return obj

def qa_render(obj,path,rear=False):
    # The shared renderer is used by run for release icons. This independent
    # 1024 px studio view is additional front/back inspection, no shared edits.
    import exterior_build
    scene=exterior_build._icon_scene(obj,1024)
    scene.cycles.samples=64; scene.cycles.use_denoising=False
    scene.view_settings.view_transform='AgX'
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    target=Vector((0,0,obj.dimensions.z*.47))
    for name,location,power,size in [('Softbox key',(-3,-4,5),750,4),('Softbox fill',(3,-1,3),450,3),('Rear edge',(0,4,4),600,3)]:
        bpy.ops.object.light_add(type='AREA',location=location)
        ob=bpy.context.object; ob.name=name; ob.data.energy=power; ob.data.shape='DISK'; ob.data.size=size
        ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
    w,d,h=obj.dimensions; side=-1 if rear else 1
    bpy.ops.object.camera_add(location=(w*.42*side,-3.2*side,h*.70))
    cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=max(w,h)*1.25
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=cam;scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    strip_metadata(path)

def annotate_glb(path):
    b=path.read_bytes(); n=struct.unpack_from('<I',b,12)[0]; j=json.loads(b[20:20+n])
    j['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',
        provenance='Original native Blender geometry; no imported geometry, imagery, or paid generation',
        source=str((HERE/'seating.py').relative_to(ROOT)),seatTopMm=460,geometryRevision='measured-seating-20261008')
    raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
    rest=b[20+n:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)

def main():
    from render_config import configure
    configure()
    selection=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
    patch=[]
    for slug,size,fn in [('sofa',(2050,850,1120),sofa),('wing-chair',(850,850,1220),wing_chair)]:
        if selection and slug not in selection: continue
        stem='rpg-mansion-'+slug+'-01'
        obj=kit.run([(stem,size,fn,{'fabric','wood','metal'},3000)],do_icons='--no-icons' not in sys.argv)[0]
        path=kit.GLB_DIR/(stem+'.glb');annotate_glb(path)
        report_path=kit.WORK_DIR/(stem+'-validation.json');report=json.loads(report_path.read_text())
        report.update(seat_top_mm=460,normalization='none: direct measured geometry',
                      glb_bytes=path.stat().st_size,glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      source_sha256=hashlib.sha256((HERE/'seating.py').read_bytes()).hexdigest())
        report_path.write_text(json.dumps(report,indent=2)+'\n')
        if '--no-icons' not in sys.argv:
            for image in [kit.PREVIEW_DIR/(stem+'-thumb.png'),kit.PREVIEW_DIR/(stem+'-top.png'),kit.WORK_DIR/(stem+'-rear.png')]:strip_metadata(image)
            qa_render(obj,HERE/'evidence'/(stem+'-front.png'))
            qa_render(obj,HERE/'evidence'/(stem+'-rear.png'),True)
        patch.append(dict(id=stem,builder=str((HERE/'seating.py').relative_to(ROOT)),
                          sourceBlend=str((kit.WORK_DIR/(stem+'.blend')).relative_to(ROOT)),
                          validation=str(report_path.relative_to(ROOT)),
                          rear=str((kit.WORK_DIR/(stem+'-rear.png')).relative_to(ROOT)),
                          previewVersion=2))
        print('SEATING_COMPLETE '+stem,flush=True)
    # Descriptor patch only. The coordinator explicitly owns manifest changes.
    (HERE/'seating-manifest-patch.json').write_text(json.dumps({'itemPatches':patch},indent=2)+'\n')

if __name__=='__main__':main()
