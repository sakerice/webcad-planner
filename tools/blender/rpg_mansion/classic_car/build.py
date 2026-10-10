"""Original 1930s-inspired sedan. Blender -Y front -> glTF +Z front.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/classic_car/build.py
Use -- --no-icons for geometry only. WEBCAD_CAR_OUTPUT_ROOT isolates replay outputs.
No downloaded geometry, textures, logos or manufacturer-specific blueprint.
"""
import json
import math
import os
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1]))
import model_kit as kit
from shape_kit import rounded_rect

ID = 'rpg-mansion-classic-sedan-01'
SIZE_MM = (1750, 4600, 1650)
BUDGET = 12000
OUT = Path(os.environ.get('WEBCAD_CAR_OUTPUT_ROOT', ROOT)).resolve()
PACK = OUT / 'assets/models/packs/rpg-mansion'
WORK = OUT / 'tools/blender/rpg_mansion/classic_car'
kit.GLB_DIR = PACK / 'models'
kit.PREVIEW_DIR = PACK / 'previews'
kit.WORK_DIR = WORK
PARTS = []
M = {}


def srgb(hex_value):
    values = [int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in values)


def materials():
    specs = {
        'paint': ('CarBody_ClassicGreen', '#28493c', .36, .12, 1),
        'chrome': ('Classic satin nickel', '#c4c6bf', .24, .85, 1),
        'rubber': ('Classic tire rubber', '#242722', .84, 0, 1),
        'black': ('Classic black trim', '#19201c', .52, .10, 1),
        'ivory': ('Classic warm sidewall', '#c4bfad', .73, 0, 1),
        'glass': ('Classic window glass', '#677e7b', .13, .05, .48),
        'lens': ('Classic headlamp lens', '#eee6c9', .22, .08, 1),
        'red': ('Classic ruby tail lamp', '#8f2527', .24, .08, 1),
        'leather': ('Classic saddle leather', '#795540', .63, 0, 1),
        'wood': ('Classic walnut dashboard', '#513c2d', .42, 0, 1),
    }
    for key, (name, color, roughness, metal, alpha) in specs.items():
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*srgb(color), 1)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Alpha'].default_value = alpha
        bsdf.inputs['Emission Strength'].default_value = 0
        bsdf.inputs['Coat Weight'].default_value = .36 if key == 'paint' else 0
        bsdf.inputs['Coat Roughness'].default_value = .20
        material.diffuse_color = (*srgb(color), alpha)
        material.use_backface_culling = True
        if key == 'glass':
            if hasattr(material, 'surface_render_method'):
                material.surface_render_method = 'DITHERED'
        if key == 'paint':
            material['finishChannel'] = 'body'
        M[key] = material


def remember(obj):
    PARTS.append(obj)
    return obj


def mesh(name, vertices, faces, key, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(M[key])
    for face in data.polygons:
        face.use_smooth = smooth and len(face.vertices) == 4
    return remember(obj)


def loft(name, rings, key, closed=False):
    n = len(rings[0])
    assert all(len(row) == n for row in rings)
    vertices = [tuple(p) for row in rings for p in row]
    faces = []
    last = len(rings) if closed else len(rings) - 1
    for row in range(last):
        nxt = (row + 1) % len(rings)
        for i in range(n):
            j = (i + 1) % n
            faces.append((row*n+i, row*n+j, nxt*n+j, nxt*n+i))
    if not closed:
        faces.extend([tuple(reversed(range(n))), tuple(range((len(rings)-1)*n, len(rings)*n))])
    return mesh(name, vertices, faces, key)


def block(name, center, size, key, radius=.006, segments=2):
    lo = [center[i] - size[i] / 2 for i in range(3)]
    hi = [center[i] + size[i] / 2 for i in range(3)]
    # A bevel reaching half the thin axis creates near-zero corner faces.
    # Keep a real web between opposite bevels on plates, trim and upholstery.
    radius = min(radius, min(size)*.24)
    return remember(kit.box(name, lo, hi, M[key], radius, segments))


def tube(name, points, radius, key, sides=8, closed=False):
    points = [Vector(p) for p in points]
    rings = []
    # A rotation-minimizing frame keeps long curved trim from twisting.
    tangents = []
    for i in range(len(points)):
        before = points[(i-1) % len(points)] if closed or i else points[0]
        after = points[(i+1) % len(points)] if closed or i < len(points)-1 else points[-1]
        tangents.append((after - before).normalized())
    normal = tangents[0].orthogonal().normalized()
    for i, (point, tangent) in enumerate(zip(points, tangents)):
        if i:
            normal = (tangents[i-1].rotation_difference(tangent) @ normal).normalized()
        other = tangent.cross(normal).normalized()
        rings.append([point + radius * (normal*math.cos(2*math.pi*k/sides) + other*math.sin(2*math.pi*k/sides))
                      for k in range(sides)])
    return loft(name, rings, key, closed)


def revolve(name, rows, center, axis, key, n=32, closed=False):
    # rows are (axial offset, radius), all radii positive: no collapsed poles.
    a = Vector(axis).normalized()
    u = a.orthogonal().normalized()
    v = a.cross(u).normalized()
    c = Vector(center)
    rings = [[c + a*offset + radius*(u*math.cos(2*math.pi*i/n) + v*math.sin(2*math.pi*i/n))
              for i in range(n)] for offset, radius in rows]
    return loft(name, rings, key, closed)


def ellipsoid(name, center, scales, key, rings=8, sides=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=sides, ring_count=rings, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scales
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(M[key])
    for face in obj.data.polygons:
        face.use_smooth = True
    return remember(obj)


def pane(name, points, normal, key='glass', thickness=.003):
    n = Vector(normal).normalized() * thickness / 2
    # Closed thin solid: the delivered mesh contains no open edges.
    return loft(name, [[Vector(p)-n for p in points], [Vector(p)+n for p in points]], key)


def wheel(side, y):
    x = side * .690
    center = (x, y, .345)
    tire = revolve('Rounded tire', [(-.095,.215),(-.102,.290),(-.065,.345),(.065,.345),
                                  (.102,.290),(.104,.285),(.104,.248),(.095,.215)],
                   center, (side,0,0), 'rubber', 32, True)
    tire.data.materials.append(M['ivory'])
    for face in tire.data.polygons:
        if face.index // 32 == 5:
            face.material_index = 1
    outer = x + side * .097
    # The ivory band is part of the tire surface: no stacked annular mesh.
    revolve('Pressed steel wheel', [(-.018,.215),(0,.236),(.018,.080)],
            (outer,y,.345), (side,0,0), 'paint', 24)
    revolve('Convex nickel hubcap', [(0,.084),(.010,.121),(.036,.095),(.048,.014)],
            (outer+side*.022,y,.345), (side,0,0), 'chrome', 16)
    for i in range(6):
        angle = 2*math.pi*i/6
        revolve('Wheel ventilation recess', [(-.001,.014),(.001,.014)],
                (outer+side*.014, y+.186*math.cos(angle), .345+.186*math.sin(angle)),
                (side,0,0), 'black', 6)


def fender(side, center_y, front):
    if front:
        # Begin at the hidden rounded underside of the nose, curl outward then
        # upward into the unchanged wheel arch. Angles rotate the crown around X.
        path = [(-2.005,.270,-140,.22,.42),(-2.040,.279,-118,.65,.86),
                (-2.060,.323,-82,.93,1),(-2.032,.408,-48,1,1),
                (-1.973,.493,-22,1,1),(-1.86,.57,0,1,1)]
        angles = [145-130*i/16 for i in range(17)]
        path.extend([(center_y+.48*math.cos(math.radians(a)), .345+.48*math.sin(math.radians(a)),0,1,1)
                     for a in angles])
        path.extend([(-.69,.415,0,1,1),(-.55,.390,0,1,1)])
    else:
        path = [(.65,.390,0,1,1),(.80,.435,0,1,1)]
        angles = [165-130*i/16 for i in range(17)]
        path.extend([(center_y+.48*math.cos(math.radians(a)), .345+.48*math.sin(math.radians(a)),0,1,1)
                     for a in angles])
        path.extend([(1.98,.485,0,1,1),(2.037,.413,42,1,1),
                     (2.067,.332,80,.93,1),(2.050,.280,118,.65,.86),
                     (2.012,.264,142,.22,.42)])
    # Rolled outer edge and convex crown; neither a box nor a flattened torus.
    cross = [(.535,-.018),(.540,.008),(.635,.033),(.780,.020),
             (.855,-.018),(.875,-.052),(.850,-.070),(.785,-.022)]
    rings = []
    for y,z,degrees,width_scale,depth_scale in path:
        angle = math.radians(degrees)
        rings.append([(side*(.705+(x-.705)*width_scale),
                       y+offset*depth_scale*math.sin(angle),
                       z+offset*depth_scale*math.cos(angle)) for x,offset in cross])
    loft(('Front' if front else 'Rear') + ' swept fender', rings, 'paint')


def build_car():
    PARTS.clear()
    materials()
    # Structural underbody and four distinct tire/wheel assemblies.
    block('Underbody', (0,.10,.310), (1.02,3.92,.13), 'black', .025, 2)
    for y in (-1.35,1.35):
        tube('Axle', [(-.68,y,.345),(.68,y,.345)], .045, 'black', 12)
        for side in (-1,1):
            wheel(side,y)
            fender(side,y,y<0)
    # Hollow lower coachwork, rounded in plan and in section; usable cabin space.
    rows = [(1.18,2.71,.22,.36),(1.32,2.87,.28,.435),(1.40,2.88,.31,.86),
            (1.38,2.77,.30,1.045),(1.31,2.69,.29,1.045),(1.24,2.60,.28,.475)]
    loft('Hollow coachwork', [rounded_rect(0,.515,w,d,r,z,n=5) for w,d,r,z in rows], 'paint')
    # Bonnet: longitudinal sections widen smoothly toward the cowl.
    stations = [(-2.08,.355,.98),(-2.02,.390,1.015),(-1.91,.412,1.035),
                (-1.62,.454,1.070),(-1.15,.518,1.110),(-.76,.585,1.140),(-.66,.604,1.135)]
    hood = []
    for y,w,top in stations:
        right = [(0,.535),(w*.80,.535),(w*.96,.63),(w,.87),(w*.97,top-.045),
                 (w*.82,top-.007),(w*.45,top+.012),(0,top+.016)]
        outline = right + [(-x,z) for x,z in reversed(right[1:-1])]
        hood.append([(x,y,z) for x,z in outline])
    loft('Crowned long bonnet', hood, 'paint')
    tube('Bonnet center hinge', [(0,-2.035,1.031),(0,-1.62,1.088),(0,-1.15,1.128),(0,-.72,1.157)], .0035, 'chrome', 6)
    for side in (-1,1):
        for i in range(7):
            y = -1.55+i*.092
            x = .454 + (y+1.62)*.136
            tube('Bonnet louvre', [(side*(x+.003),y,.88),(side*(x+.001),y+.029,1.035)], .004, 'black', 6)
        block('Running board painted edge', (side*.713,.085,.398), (.304,1.40,.070), 'paint', .018, 1)
        block('Running board rubber', (side*.744,.085,.437), (.233,1.34,.012), 'rubber', .004, 1)
        for x in (.676,.731,.786,.839):
            tube('Running board grip rib', [(side*x,-.545,.445),(side*x,.713,.445)], .0028, 'black', 6)
    # Rounded rear luggage deck grows from the lower coachwork.
    trunk = [(1.43,.621,1.105),(1.65,.61,1.035),(1.98,.545,.835),(2.105,.457,.69)]
    rings = []
    for y,w,top in trunk:
        right = [(0,.45),(w*.8,.45),(w,.59),(w*.96,top-.035),(w*.75,top+.015),(0,top+.025)]
        outline = right + [(-x,z) for x,z in reversed(right[1:-1])]
        rings.append([(x,y,z) for x,z in outline])
    loft('Rounded luggage deck', rings, 'paint')
    # Roof is a shallow multi-ring crown, with curved perimeter and no box corners.
    loft('Crowned roof', [rounded_rect(0,.365,w,d,r,z,n=6) for w,d,r,z in
                        [(1.27,1.68,.22,1.515),(1.27,1.67,.23,1.560),
                         (1.22,1.60,.25,1.612),(1.09,1.43,.27,1.650)]], 'paint')
    # Split windscreen. Slight rake and tapered width define the 1930s silhouette.
    for side in (-1,1):
        pts = [(side*.014,-.694,1.095),(side*.609,-.694,1.095),
               (side*.583,-.402,1.507),(side*.014,-.402,1.507)]
        pane('Split windscreen',pts,(0,-1,.70))
        tube('Windscreen nickel surround',pts,.009,'chrome',6,True)
    tube('Windscreen center pillar',[(0,-.710,1.083),(0,-.410,1.535)],.019,'paint',8)
    tube('Windscreen lower frame',[(-.629,-.702,1.088),(0,-.714,1.083),(.629,-.702,1.088)],.022,'paint',8)
    for side in (-1,1):
        tube('A pillar',[(side*.640,-.691,1.064),(side*.610,-.444,1.445),(side*.595,-.370,1.552)],.029,'paint',6)
        tube('B pillar',[(side*.681,.255,1.058),(side*.619,.253,1.533)],.027,'paint',6)
        tube('C pillar',[(side*.669,1.494,1.044),(side*.625,1.298,1.32),(side*.583,1.071,1.548)],.045,'paint',6)
        # Side panes share a tapered plane x(z). Chrome frames sit beyond the glass.
        side_windows = [
            [(-.629,1.095),(.207,1.095),(.208,1.500),(-.355,1.500),(-.435,1.440)],
            [(.310,1.095),(1.415,1.095),(1.241,1.337),(1.029,1.501),(.310,1.501)],
        ]
        for index, contour in enumerate(side_windows):
            pts = [(side*(.673-(z-1.095)*.140),y,z) for y,z in contour]
            pane(('Front' if not index else 'Rear')+' side window',pts,(side,0,.14))
            trim = [(x+side*.0035,y,z) for x,y,z in pts]
            tube('Side window nickel surround',trim,.008,'chrome',6,True)
        # Door shut lines stay below the windows and meet the rubber sill.
        for y0,y1 in [(-.64,.252),(.252,1.46)]:
            pts = [(side*.690,y0,1.035),(side*.696,y0,.82),
                   (side*.661,y0+.025,.455),(side*.661,y1-.025,.455),
                   (side*.696,y1,.82),(side*.690,y1,1.035)]
            tube('Door shut line',pts,.0026,'black',4)
            y = y1-.17
            tube('Door handle',[(side*.710,y-.070,1.010),(side*.730,y-.070,1.010),
                                (side*.730,y+.045,1.010),(side*.710,y+.045,1.010)],.009,'chrome',6)
        tube('Beltline nickel trim',[(side*.651,-.712,1.051),(side*.692,-.50,1.051),
                                    (side*.692,1.32,1.051),(side*.644,1.65,1.038)],.005,'chrome',6)
    rear_pts = [(-.566,1.475,1.111),(.566,1.475,1.111),(.536,1.119,1.504),(-.536,1.119,1.504)]
    pane('Rear window',rear_pts,(0,1,.905))
    tube('Rear window nickel surround',rear_pts,.011,'chrome',6,True)
    for side in (-1,1):
        tube('Rear window body surround',[(side*.579,1.497,1.084),(side*.555,1.124,1.535)],.031,'paint',8)
    tube('Rear window lower frame',[(-.598,1.487,1.087),(0,1.497,1.083),(.598,1.487,1.087)],.028,'paint',8)
    # Grille shield and individual vertical fins, all closed geometry.
    shield = [(0,-2.099,1.055),(.233,-2.099,1.031),(.278,-2.099,.957),
              (.236,-2.099,.545),(0,-2.099,.496),(-.236,-2.099,.545),
              (-.278,-2.099,.957),(-.233,-2.099,1.031)]
    pane('Recessed radiator grille',shield,(0,1,0),'black',.04)
    frame = [(x,-2.127,z) for x,y,z in shield]
    tube('Radiator nickel surround',frame,.015,'chrome',6,True)
    for i in range(15):
        x = -.218+i*.436/14
        low = .531+abs(x)*.16
        high = 1.034-abs(x)*.19
        tube('Radiator vertical fin',[(x,-2.134,low),(x,-2.134,high)],.0045,'chrome',4)
    # An abstract unbranded fin replaces any manufacturer badge.
    pane('Geometric bonnet ornament',[(0,-2.016,1.07),(0,-1.956,1.14),
                                     (0,-1.900,1.085),(0,-1.935,1.071)],(1,0,0),'chrome',.014)
    for side in (-1,1):
        tube('Headlamp support',[(side*.56,-1.88,.72),(side*.56,-1.99,.866)],.022,'chrome',8)
        ellipsoid('Round headlamp housing',(side*.563,-1.994,.908),(.143,.168,.143),'paint',8,16)
        revolve('Round headlamp lens',[(0,.119),(.018,.126),(.026,.109),(.031,.020)],
                (side*.563,-2.137,.908),(0,-1,0),'lens',16)
        points = [(side*.563+.131*math.cos(2*math.pi*i/24),-2.148,
                   .908+.131*math.sin(2*math.pi*i/24)) for i in range(24)]
        tube('Headlamp nickel bezel',points,.011,'chrome',4,True)
        for dx in (-.064,0,.064):
            h = math.sqrt(.105**2-dx**2)
            tube('Headlamp lens flute',[(side*.563+dx,-2.169,.908-h),
                                       (side*.563+dx,-2.169,.908+h)],.0015,'chrome',5)
        ellipsoid('Tail lamp nickel mount',(side*.520,2.040,.745),(.060,.033,.070),'chrome',4,12)
        ellipsoid('Ruby tail lamp',(side*.520,2.066,.745),(.044,.022,.050),'red',4,12)
    # Bowed bumpers. Their center sections establish exact +/-2.30m extents.
    for end in (-1,1):
        pts = [(-.759,end*2.180,.435),(-.70,end*2.235,.435),(-.45,end*2.270,.435),
               (0,end*2.270,.435),(.45,end*2.270,.435),(.70,end*2.235,.435),(.759,end*2.180,.435)]
        tube('Bowed nickel bumper',pts,.030,'chrome',8)
        for x in (-.435,.435):
            block('Bumper overrider',(x,end*2.276,.468),(.045,.043,.169),'chrome',.013,1)
            tube('Bumper bracket',[(x,end*1.98,.380),(x,end*2.25,.409)],.021,'black',8)
        block('Blank unbranded number plate',(0,end*2.182,.628),(.295,.012,.112),'black',.009,1)
        tube('Number plate edge',[(-.14,end*2.191,.58),(.14,end*2.191,.58),
                                  (.14,end*2.191,.675),(-.14,end*2.191,.675)],.003,'chrome',6,True)
    # Minimum visible interior: two benches, flooring, dashboard and steering wheel.
    block('Cabin floor',(0,.34,.492),(1.16,1.88,.037),'black',.008,1)
    for y in (.16,1.025):
        block('Leather bench cushion',(0,y,.744),(1.135,.48,.17),'leather',.059,2)
        block('Leather bench back',(0,y+.20,.997),(1.125,.145,.48),'leather',.043,2)
        for x in (-.35,0,.35):
            tube('Leather seat stitch',[(x,y-.181,.831),(x,y+.158,.831)],.0018,'wood',5)
    block('Walnut dashboard',(0,-.566,1.077),(1.15,.10,.13),'wood',.019,1)
    for x,radius in [(-.32,.042),(-.21,.027),(0,.025)]:
        revolve('Dashboard gauge',[(0,radius),(.004,radius)],(x,-.507,1.087),(0,1,0),'black',12)
    steering_center = Vector((-.342,-.230,1.127))
    steering_axis = Vector((0,-.67,.74)).normalized()
    tube('Steering column',[(-.342,-.45,.80),tuple(steering_center)],.017,'black',8)
    u = Vector((1,0,0)); v = steering_axis.cross(u)
    points = [steering_center+.157*(u*math.cos(2*math.pi*i/20)+v*math.sin(2*math.pi*i/20)) for i in range(20)]
    tube('Steering wheel',points,.012,'black',6,True)
    for i in range(3):
        angle = 2*math.pi*i/3
        tube('Steering wheel spoke',[steering_center,steering_center+.146*(u*math.cos(angle)+v*math.sin(angle))],.006,'chrome',6)
    ellipsoid('Steering hub',steering_center,(.026,.026,.026),'chrome',4,12)
    # Bake all object transforms before joining so UV density uses world dimensions.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    WORK.mkdir(parents=True,exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(ID+'-authoring.blend')))
    obj = kit.combine(PARTS)
    # Resolve curved quads and cap ngons before UV projection. The GLB is
    # triangulated anyway; doing it here prevents collapsed UV cap triangles.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='BEAUTY')
    bm.to_mesh(obj.data)
    bm.free()
    obj['assetId'] = ID
    obj['frontAxis'] = '+Z'
    obj['upAxis'] = '+Y'
    obj['units'] = 'meters'
    obj['provenance'] = 'original'
    return obj


def main():
    # Keep the shared inspector intact; only redirect new asset output folders.
    kit.run([(ID,SIZE_MM,build_car,{'body'},BUDGET)],do_icons=False)
    inspection = json.loads((WORK/(ID+'-validation.json')).read_text())
    assert inspection['uv']['degenerate_world'] == 0
    assert inspection['uv']['degenerate_uv'] == 0
    if '--no-icons' not in sys.argv:
        sys.path.insert(0,str(HERE))
        import render
        render.main()


if __name__ == '__main__':
    main()
