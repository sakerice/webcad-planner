"""Export car / neighbor-house / neighbor-building GLBs for webcad-planner.

Run inside Blender after building the models with car_build.py /
house_build.py / bldg_build.py. Modules are grouped under named empties
(nh_base/nh_mid/nh_roof, bd_base/bd_mid/bd_top) which the app stacks
per-floor at runtime; keep those names stable.
"""
import bpy, os
OUT = '/Users/nariiwa/Projects/webcad-planner/assets/models/context'
os.makedirs(OUT, exist_ok=True)

def ensure_group(prefix, keys):
    empties = []
    for key in keys:
        name = prefix + key
        e = bpy.data.objects.get(name)
        if not e:
            e = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(e)
        e.location = (0, 0, 0)
        empties.append(name)
        for ob in bpy.data.objects:
            if ob.type == 'MESH' and ob.name.startswith(name + '_'):
                ob.parent = e
    return empties

house_empties = ensure_group('nh_', ['base', 'mid', 'roof'])
be = bpy.data.objects.get('nh_balc')
if be:
    be.location = (be.location.x, be.location.y, 0)
    house_empties.append('nh_balc')
bldg_empties = ensure_group('bd_', ['base', 'mid', 'top'])
fbike_root = bpy.data.objects.get('bk2_root')
if not fbike_root:
    fbike_root = bpy.data.objects.new('bk2_root', None)
    bpy.context.scene.collection.objects.link(fbike_root)
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name.startswith('bk2_') and ob.parent is None:
        ob.parent = fbike_root

bike_root = bpy.data.objects.get('bk_root')
if not bike_root:
    bike_root = bpy.data.objects.new('bk_root', None)
    bpy.context.scene.collection.objects.link(bike_root)
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name.startswith('bk_') and not ob.name.startswith('bk2_') and ob.parent is None:
        ob.parent = bike_root

pole_root = bpy.data.objects.get('up_root')
if not pole_root:
    pole_root = bpy.data.objects.new('up_root', None)
    bpy.context.scene.collection.objects.link(pole_root)
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name.startswith('up_') and ob.parent is None:
        ob.parent = pole_root

car_root = bpy.data.objects.get('car_root')
if not car_root:
    car_root = bpy.data.objects.new('car_root', None)
    bpy.context.scene.collection.objects.link(car_root)
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name.startswith('car_') and ob.parent is None:
        ob.parent = car_root

def export_sel(prefixes, empties, path):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in bpy.data.objects:
        if ob.name in empties or (ob.type == 'MESH' and any(ob.name.startswith(p) for p in prefixes)):
            ob.select_set(True)
            ob.hide_render = False
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB',
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False)
    return os.path.getsize(path)

print('car', export_sel(['car_'], ['car_root'], OUT + '/car_sedan.glb'))
print('house', export_sel(['nh_'], house_empties, OUT + '/neighbor_house.glb'))
print('bldg', export_sel(['bd_'], bldg_empties, OUT + '/neighbor_building.glb'))
print('pole', export_sel(['up_'], ['up_root'], OUT + '/utility_pole.glb'))
print('bike', export_sel(['bk_'], ['bk_root'], OUT + '/bicycle.glb'))
print('fbike', export_sel(['bk2_'], ['bk2_root'], OUT + '/bicycle_folding.glb'))
