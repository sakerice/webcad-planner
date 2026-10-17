"""Original mansion upright piano and fantasy floor globe.

All geometry is authored natively in Blender. No imported models, photographs,
textures, scans, copyrighted sheet music, or external map data are used.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/polish/props.py
Optional: -- --only piano,globe --no-icons
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import sys

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(FAMILY.parent))
sys.path.insert(0, str(FAMILY))
import model_kit as kit
import bpy
from build_decor import mesh_part, lathe, loop
from mathutils import Vector, Matrix
from render_config import configure
from png_metadata import strip_metadata

WORK = HERE / 'work'
PACK = ROOT / 'assets/models/packs/rpg-mansion'
kit.WORK_DIR = WORK
kit.GLB_DIR = PACK / 'models'
kit.PREVIEW_DIR = PACK / 'previews'
P = {}


def palette():
    def m(name, color, channel=None, rough=.45, metal=0):
        out = kit.matp(name, color, rough, metal)
        if channel:
            out['finishChannel'] = channel
        return out
    return dict(wood=m('Polish dark walnut', '#493025', 'wood'),
                edge=m('Polish walnut moulding', '#704b32', 'wood'),
                sound=m('Piano warm spruce soundboard', '#946443', 'wood', .7),
                metal=m('Polish antique brass', '#b29455', 'metal', .32, .72),
                ivory=m('Piano fixed ivory key tops', '#ede8d8', rough=.35),
                ebony=m('Piano fixed ebony sharps', '#161918', rough=.26),
                ocean=m('Fantasy globe fixed teal sea', '#2a6871', rough=.55),
                land=m('Fantasy globe fixed ochre continents', '#c7b276', rough=.78),
                coast=m('Fantasy globe fixed coastal sand', '#dcc894', rough=.78),
                sea_grid=m('Fantasy globe fixed sea graticule', '#467d80', rough=.65),
                land_grid=m('Fantasy globe fixed land graticule', '#ac9866', rough=.78))


def box(name, center, size, mat='wood', bevel=.002):
    return kit.box(name, [a-b/2 for a,b in zip(center,size)],
                   [a+b/2 for a,b in zip(center,size)], P[mat],
                   min(bevel, min(size)/4), 1)


def prism_x(name, x0, x1, yz, mat):
    """Closed profile extrusion along X; useful for curved key ends and feet."""
    n = len(yz)
    verts = [(x,y,z) for x in [x0,x1] for y,z in yz]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj = mesh_part(name, verts, faces, P[mat])
    # Explicit outward normals, independent of the profile's winding direction.
    import bmesh
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data); bm.free()
    return obj


def rod(name, a, b, radius, mat='metal', sides=8):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius,
                                      depth=(b-a).length, location=(a+b)/2)
    ob=bpy.context.object; ob.name=name
    ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    ob.data.materials.append(P[mat])
    for face in ob.data.polygons:
        face.use_smooth=len(face.vertices)==4
    return ob


def frame(name, x, y, z, w, h, mat='edge', width=.017):
    # Individually closed rails sit proud of the flat raised panel field.
    for xx in [x-w/2+width/2,x+w/2-width/2]:
        box(name+' stile',(xx,y,z),(width,.010,h),mat,0)
    for zz in [z-h/2+width/2,z+h/2-width/2]:
        box(name+' rail',(x,y,zz),(w-2*width,.010,width),mat,0)


def piano():
    # 1250mm upright, 88 keys at standard ~23.5mm white-key pitch. The
    # cabinet is shallow behind the projecting 750mm-height keyboard.
    box('Closed upper instrument case',(0,.100,.936),(1.412,.400,.578),'wood',.005)
    box('Full-width lid with front overhang',(0,.084,1.231),(1.460,.452,.038),'edge',.004)
    box('Lid brass hinge line',(0,.282,1.210),(1.370,.006,.008),'metal',0)
    for x in [-.696,.696]:
        box('Case side pilaster',(x,.102,.652),(.046,.402,1.156),'wood',.003)
        box('Front side capital',(x,-.105,1.191),(.062,.018,.050),'edge',.002)
    # Back panel intentionally recessed behind a genuine supporting framework.
    box('Rear soundboard',(0,.290,.670),(1.300,.018,1.014),'sound',0)
    for x in [-.596,-.298,0,.298,.596]:
        box('Rear structural backpost',(x,.291,.657),(.061,.038,1.072),'edge',.003)
    for z in [.138,1.170]:
        box('Rear horizontal frame rail',(0,.285,z),(1.348,.050,.062),'wood',.003)
    box('Lower front acoustic panel',(0,-.109,.437),(1.319,.035,.570),'wood',.004)
    frame('Lower raised-panel moulding',0,-.130,.447,1.246,.460,width=.025)
    # Two broad raised upper fields, with a working-looking music ledge.
    box('Upper front panel',(0,-.111,1.014),(1.330,.036,.382),'wood',.003)
    for x in [-.327,.327]:
        frame('Upper framed field',x,-.134,1.033,.618,.300,width=.020)
    box('Music ledge',(0,-.162,.859),(1.112,.120,.025),'edge',.003)
    box('Music rest brass lower lip',(0,-.222,.877),(1.048,.012,.018),'metal',.001)
    # An original rosette, not a real manufacturer's logo.
    rod('Central brass maker medallion',(0,-.142,1.039),(0,-.151,1.039),.026,sides=12)
    box('Original maker medallion bar',(0,-.158,1.039),(.042,.004,.006),'wood',0)
    # Keybed and cheekblocks define the front depth exactly at -310mm.
    box('Keyboard structural bed',(0,-.199,.724),(1.410,.222,.043),'wood',.004)
    for x in [-.665,.665]:
        box('Keyboard cheekblock',(x,-.199,.756),(.080,.222,.080),'edge',.004)
    box('Keyboard fallboard back rail',(0,-.077,.806),(1.285,.030,.079),'wood',.003)
    box('Brass strip above the keys',(0,-.095,.780),(1.272,.006,.008),'metal',0)
    # A0..C8: 52 white keys and 36 black keys, with the actual 2/3 grouping.
    pitch=.02350
    white_notes=[note for note in range(21,109) if note%12 not in [1,3,6,8,10]]
    white_x={note:(i-25.5)*pitch for i,note in enumerate(white_notes)}
    for note in white_notes:
        box('Ivory natural MIDI '+str(note),(white_x[note],-.1985,.7555),
            (pitch-.00065,.201,.019),'ivory',0)
    for note in range(21,109):
        if note%12 not in [1,3,6,8,10]:
            continue
        # Chamfered top-front profile rather than expensive bevelled cubes.
        x=(white_x[note-1]+white_x[note+1])/2
        prism_x('Ebony sharp MIDI '+str(note),x-.0069,x+.0069,
                [(-.205,.765),(-.102,.765),(-.102,.784),(-.196,.784),(-.205,.779)],'ebony')
    # Front legs have a sloped shoulder, reduced waist and projecting toe.
    for x in [-.660,.660]:
        prism_x('Front carved supporting leg',x-.033,x+.033,
                [(-.297,.047),(-.184,.047),(-.177,.632),(-.119,.704),
                 (-.238,.704),(-.257,.636),(-.244,.151),(-.297,.095)],'wood')
        box('Front brass foot shoe',(x,-.246,.036),(.078,.119,.032),'metal',.003)
        box('Leg lower collar',(x,-.235,.161),(.073,.052,.016),'edge',.001)
    for x in [-.649,.649]:
        box('Rear solid foot',(x,.235,.050),(.095,.150,.100),'wood',.004)
    box('Lower pedal rail',(0,-.095,.105),(1.290,.120,.082),'edge',.003)
    for x in [-.118,0,.118]:
        rod('Brass pedal lever',(x,-.149,.083),(x,-.232,.066),.008,sides=6)
        prism_x('Pedal polished toe',x-.019,x+.019,
                [(-.272,.049),(-.200,.049),(-.192,.062),(-.252,.071),(-.272,.066)],'metal')
    # The rear faces are guaranteed to reach +310mm; feet reach the floor.
    for x in [-.649,.649]:
        box('Rear foot ground pad',(x,.236,.009),(.088,.135,.018),'ebony',0)
    # Instrument acoustics are a fixed decorative model, no claimed playback.


def sphere_map():
    """One closed sphere, with constrained organic coastlines as shared edges.

    Hand-authored fantasy outlines are smoothed with a cyclic Catmull-Rom
    spline, then inserted into Blender's native constrained triangulator.
    Both coast edges and restrained graticule bands are genuine topology:
    no cell-based mask, raised/floating patches, texture, or Earth map data.
    The longitude seam and both poles are welded before validation/export.
    """
    from mathutils.geometry import delaunay_2d_cdt
    radius=.228; center=Vector((0,0,.925)); half=math.pi/2
    tilt=Matrix.Rotation(math.radians(-12),4,'Z') @ Matrix.Rotation(math.radians(23),4,'Y')
    # Each outline has deliberately different bays, promontories and lobes.
    # Coordinates are original design points in an abstract longitude/latitude
    # chart; these do not represent existing countries or any supplied map.
    regions=[
        (-1.85,.42,.65,.56,[(-.92,.14),(-.61,.57),(-.34,.91),(.02,.78),(.35,1),(.67,.68),(.95,.43),(.55,.18),(.67,-.09),(.38,-.35),(.50,-.69),(.09,-.91),(-.16,-.57),(-.48,-.73),(-.63,-.32),(-.88,-.16)]),
        (-.65,-.36,.36,.47,[(-.75,.80),(-.24,1),(.13,.60),(.67,.42),(.92,.08),(.51,-.18),(.68,-.52),(.34,-.84),(-.03,-1),(-.33,-.68),(-.36,-.17),(-.67,.12)]),
        (.66,.47,.65,.40,[(-1,.12),(-.65,.62),(-.30,.77),(-.03,.45),(.29,.87),(.74,.70),(1,.25),(.70,-.02),(.83,-.37),(.39,-.63),(.15,-.93),(-.17,-.57),(-.54,-.71),(-.76,-.32)]),
        (1.77,-.34,.43,.51,[(-.53,1),(-.02,.68),(.27,.87),(.53,.55),(.34,.22),(.81,-.08),(.64,-.46),(.13,-.64),(-.02,-1),(-.36,-.76),(-.67,-.33),(-.48,.10),(-.80,.48)]),
        (2.73,.26,.28,.57,[(-.56,.94),(-.03,.69),(.60,.88),(.83,.46),(.44,.06),(.84,-.37),(.49,-.65),(.04,-.96),(-.42,-.71),(-.78,-.27),(-.42,.15),(-.77,.51)]),
        (-2.46,-.89,.30,.17,[(-1,.03),(-.67,.71),(-.20,.87),(.19,.53),(.74,.73),(1,.10),(.68,-.39),(.20,-.51),(-.13,-.86),(-.64,-.65)]),
        (.05,-1.02,.29,.14,[(-.94,.02),(-.64,.65),(-.12,.85),(.31,.53),(.87,.69),(1,-.06),(.53,-.70),(.09,-.43),(-.37,-.81),(-.75,-.48)])]

    def spline(points):
        out=[]; count=len(points)
        for i in range(count):
            a,b,c,d=[Vector(points[k%count]) for k in (i-1,i,i+1,i+2)]
            for step in range(3):
                t=step/3
                out.append((2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+
                            (-a+3*b-3*c+d)*t*t*t)*.5)
        return out

    polygons=[]
    for x,y,rx,ry,points in regions:
        outline=spline(points)
        polygons.append(([(x+rx*p.x,y+ry*p.y) for p in outline],
                         [(x+.965*rx*p.x,y+.965*ry*p.y) for p in outline]))
    coords=[]; edges=[]; lookup={}
    def vertex(lon,lat):
        key=(round(lon,9),round(lat,9))
        if key not in lookup:
            lookup[key]=len(coords); coords.append(Vector((lon,lat)))
        return lookup[key]
    def chain(points,closed=False):
        ids=[vertex(*p) for p in points]
        edges.extend(zip(ids,ids[1:]))
        if closed:edges.append((ids[-1],ids[0]))

    grid_width=.005
    lons=[-math.pi+math.tau*i/32 for i in range(33)]
    lats=[-half+math.pi*j/12 for j in range(13)]
    # Replace a grid centreline with the two edges of a narrow ink band.
    for value in [-half,0,half]:
        lons=[v for v in lons if abs(v-value)>1e-8]+[value-grid_width,value+grid_width]
    lons += [-math.pi+grid_width,math.pi-grid_width]
    for value in [-math.pi/4,0,math.pi/4]:
        lats=[v for v in lats if abs(v-value)>1e-8]+[value-grid_width,value+grid_width]
    lons.sort();lats.sort()
    for lat in lats:
        for lon in lons:vertex(lon,lat)
    for lat in [-half,half,-math.pi/4-grid_width,-math.pi/4+grid_width,
                -grid_width,grid_width,math.pi/4-grid_width,math.pi/4+grid_width]:
        chain([(lon,lat) for lon in lons])
    for lon in [-math.pi,math.pi,-math.pi+grid_width,math.pi-grid_width,
                -half-grid_width,-half+grid_width,-grid_width,grid_width,
                half-grid_width,half+grid_width]:
        chain([(lon,lat) for lat in lats])
    for outer,inner in polygons:chain(outer,True);chain(inner,True)
    uv,_,triangles,_,_,_=delaunay_2d_cdt(coords,edges,[],0,1e-8,False)

    def inside(point,polygon):
        x,y=point; hit=False
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
                hit=not hit
        return hit
    verts=[]; mapping={}; welded={}
    for i,(lon,lat) in enumerate(uv):
        p=Vector((radius*math.cos(lat)*math.cos(lon),radius*math.cos(lat)*math.sin(lon),radius*math.sin(lat)))
        key=tuple(round(v,7) for v in p)
        if key not in welded:
            welded[key]=len(verts);verts.append(tuple(center+tilt@p))
        mapping[i]=welded[key]
    faces=[]; colors=[]
    for tri in triangles:
        ids=tuple(mapping[i] for i in tri)
        if len(set(ids))<3:continue  # the chart's pole edges collapse to one vertex
        lon,lat=sum((uv[i] for i in tri),Vector((0,0)))/3
        land=any(inside((lon,lat),inner) for _,inner in polygons)
        coast=not land and any(inside((lon,lat),outer) for outer,_ in polygons)
        grid=min(abs(lat-v) for v in [-math.pi/4,0,math.pi/4])<grid_width or \
             min(abs(lon-v) for v in [-math.pi,-half,0,half,math.pi])<grid_width
        faces.append(ids);colors.append(2 if coast else (4 if grid else 1) if land else (3 if grid else 0))
    obj=mesh_part('Original organic fantasy cartography sphere',verts,faces,P['ocean'],True)
    for name in ['land','coast','sea_grid','land_grid']:obj.data.materials.append(P[name])
    for poly,index in zip(obj.data.polygons,colors):poly.material_index=index
    # Shared positions produce smooth sphere normals even along material edges.
    import bmesh
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    obj['cartography']='Seven original spline coastlines, shared constrained topology, welded sphere, restrained 45-degree graticule'
    return obj


def globe():
    sphere_map()
    # A 680mm broad wooden horizon ring surrounds the 456mm globe.
    # Four rectangular-section rings form a closed chamfered annular profile.
    n=40; verts=[]
    for r,z in [(.310,.909),(.340,.916),(.340,.935),(.310,.943)]:
        verts += [(r*math.cos(math.tau*i/n),r*math.sin(math.tau*i/n),z) for i in range(n)]
    faces=[]
    for k in range(4):
        for i in range(n):
            faces.append((k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i))
    mesh_part('Closed walnut horizon ring',verts,faces,P['edge'],True)
    # The brass vertical meridian is circular; its top defines 1180mm.
    loop('Full antique brass meridian',(0,0,.925),.249,.249,.006,P['metal'],vertical=True,steps=48)
    # The axial rod is aligned to the globe's 23-degree inclination.
    tilt=Matrix.Rotation(math.radians(-12),4,'Z') @ Matrix.Rotation(math.radians(23),4,'Y')
    pole=tilt@Vector((0,0,.247))
    rod('Inclined globe axle',Vector((0,0,.925))-pole,Vector((0,0,.925))+pole,.007,sides=8)
    # A turned pedestal supports the meridian from below at 670mm.
    lathe('Walnut turned central pedestal',[(.048,.048),(.075,.082),(.045,.122),
        (.030,.285),(.038,.367),(.063,.400),(.062,.430),(.032,.472),
        (.032,.605),(.064,.626),(.064,.645),(.036,.655),(.024,.676)],P['wood'],sides=12)
    lathe('Pedestal brass collar',[(.064,.422),(.066,.426),(.066,.439),(.064,.442)],P['metal'],sides=12)
    # Three swept feet are thick closed solids with flat floor contacts.
    for angle in [-math.pi/2,math.pi/6,5*math.pi/6]:
        before=set(bpy.context.scene.objects)
        prism_x('Swept tripod foot',-.030,.030,
                [(0,.097),(.13,.098),(.295,.030),(.310,.014),(.310,0),(.263,0),
                 (.223,.028),(.096,.054),(0,.054)],'wood')
        ob=(set(bpy.context.scene.objects)-before).pop()
        rot=Matrix.Rotation(angle-math.pi/2,4,'Z')
        for v in ob.data.vertices:v.co=rot@v.co
        ob.data.update()
        # Outboard vertical posts support the horizon at three points and
        # stay outside the sphere, so they do not intersect the globe surface.
        r=.294
        x,y=r*math.cos(angle),r*math.sin(angle)
        rod('Horizon supporting turned post',(x,y,.048),(x,y,.914),.016,'wood',sides=8)
        rod('Pedestal diagonal brace',(0,0,.406),(x,y,.605),.012,'edge',sides=6)
        rod('Horizon brass support ferrule',(x,y,.884),(x,y,.914),.019,'metal',sides=8)
    # The sphere owns the topology-backed 45-degree graticule. The stand is
    # deliberately a historical decorative globe, not a navigation instrument.


SPECS=[
    ('upright-piano','88鍵のアップライトピアノ',(1460,620,1250),piano,'小物',
     'Original 88-key decorative upright: A0–C8 keyboard, three pedals, moulded walnut case and framed rear soundboard. Static geometry; no audio playback. Floor placement.'),
    ('floor-globe','真鍮子午環の床置き地球儀',(680,680,1180),globe,'小物',
     '456mm fantasy globe with seven original organic spline coastlines and restrained topology-backed graticule in a walnut horizon ring, brass meridian and inclined axle, with a turned pedestal and three floor-supported posts. Invented landmasses, not an accurate Earth map. Static floor decoration.')
]


def build(fn):
    global P
    P=palette();fn()
    parts=[o for o in bpy.context.scene.objects if o.type=='MESH']
    obj=kit.combine(parts)
    mat=obj.matrix_world.copy()
    for v in obj.data.vertices:v.co=mat@v.co
    obj.matrix_world.identity();obj.data.update()
    return obj


def add_glb_provenance(path):
    b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0]
    data=json.loads(b[20:20+n])
    data['asset']['extras']={'front':'+Z','up':'+Y','units':'metres','origin':'bottom-centre',
        'packId':'rpg-mansion','provenance':'Original native procedural Blender geometry; no imported geometry, imagery or map data',
        'source':str(Path(__file__).relative_to(ROOT))}
    raw=json.dumps(data,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
    rest=b[20+n:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)


def front_render(obj,path):
    from exterior_build import _icon_scene,_sun
    scene=_icon_scene(obj)
    _sun(3.4,(math.radians(40),0,math.radians(25)),(3,-4,6))
    dx,dy,dz=obj.dimensions
    bpy.ops.object.camera_add(location=(0,-max(dx,dy,dz)*3,dz*.52))
    cam=bpy.context.active_object;cam.data.type='ORTHO'
    cam.data.ortho_scale=max(dx,dz)*1.20
    cam.rotation_euler=(Vector((0,0,dz*.52))-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=cam;scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


def main():
    configure()
    WORK.mkdir(parents=True,exist_ok=True)
    only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
    descriptor_path=WORK/'props-descriptors.json'
    prior=json.loads(descriptor_path.read_text()) if descriptor_path.exists() else []
    descriptors=[]
    for slug,name,size,fn,category,note in SPECS:
        if only and slug not in only and ('piano' if slug=='upright-piano' else 'globe') not in only:continue
        stem='rpg-mansion-'+slug+'-01'
        # The globe's constrained smooth coastlines and fine graticule are a
        # meaningful quality increase approved over its earlier 2976 triangles.
        budget=4400 if slug=='floor-globe' else 3000
        obj=kit.run([(stem,size,lambda fn=fn:build(fn),{'wood','metal'},budget)])[0]
        path=kit.GLB_DIR/(stem+'.glb');add_glb_provenance(path)
        if '--no-icons' not in sys.argv:
            front_render(obj,WORK/(stem+'-front.png'))
            for image in [kit.PREVIEW_DIR/(stem+'-thumb.png'),kit.PREVIEW_DIR/(stem+'-top.png'),WORK/(stem+'-front.png'),WORK/(stem+'-rear.png')]:strip_metadata(image)
        report=WORK/(stem+'-validation.json');valid=json.loads(report.read_text())
        valid.update(glb_bytes=path.stat().st_size,glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                     source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),placement_notes=note)
        report.write_text(json.dumps(valid,ensure_ascii=False,indent=2)+'\n')
        rel=lambda p:str(p.relative_to(ROOT))
        descriptors.append(dict(id=stem,name=name,packId='rpg-mansion',group='家具',category=category,
          kind='decor',sourceFolder='BlenderRpgMansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),
          top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),rear=rel(WORK/(stem+'-rear.png')),frontPreview=rel(WORK/(stem+'-front.png')),
          sourceBlend=rel(WORK/(stem+'.blend')),validation=rel(report),w=size[0],d=size[1],h=size[2],
          defaultElevation=0,provenance='original',builder=rel(Path(__file__)),
          finishChannels=[{'key':'wood','label':'木部','default':'#493025'},{'key':'metal','label':'金属','default':'#b29455'}],
          placementHint='floor',placementNotes=note,front='+Z',previewVersion=1))
        print('PROPS_COMPLETE '+stem,flush=True)
    built={d['id'] for d in descriptors}
    descriptors=[d for d in prior if d['id'] not in built]+descriptors
    descriptor_path.write_text(json.dumps(descriptors,ensure_ascii=False,indent=2)+'\n')
    sources={rel:hashlib.sha256((ROOT/rel).read_bytes()).hexdigest() for rel in [str(Path(__file__).relative_to(ROOT)),
             'tools/blender/model_kit.py','tools/blender/shape_kit.py','tools/blender/build_decor.py',
             'tools/blender/exterior_build.py','tools/blender/rpg_mansion/render_config.py']}
    (WORK/'props-source-checkpoint.json').write_text(json.dumps({'source_sha256':sources,'models':[d['id'] for d in descriptors]},indent=2)+'\n')

if __name__=='__main__':main()
