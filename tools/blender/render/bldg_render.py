import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
SH = 2.7
def ensure_empty(name):
    e = bpy.data.objects.get(name)
    if not e:
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
    return e
groups = {'base': ensure_empty('bd_base'), 'mid': ensure_empty('bd_mid'), 'top': ensure_empty('bd_top')}
mids = []
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name.startswith('bd_'):
        for key, e in groups.items():
            if ob.name.startswith('bd_' + key + '_'):
                if ob.parent != e:
                    ob.parent = e
# hide house/car
for ob in bpy.data.objects:
    if ob.name.startswith(('car_', 'nh_')) or ob.name in ('nh_base','nh_mid','nh_roof'):
        ob.hide_render = True
# stack a 4F building: base + mid x3 + top  (duplicate mid empties via instancing not needed for preview: move mid, render is single mid... use linked duplicates)
# clean old preview dupes
for ob in list(bpy.data.objects):
    if ob.name.startswith('bdprev_'):
        bpy.data.objects.remove(ob, do_unlink=True)
groups['base'].location = (0, 0, 0)
groups['mid'].location = (0, 0, SH)
for k in (2, 3):
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and ob.parent == groups['mid']:
            d = ob.copy()  # linked mesh
            d.name = 'bdprev_%d_%s' % (k, ob.name)
            d.parent = None
            mw = ob.matrix_world.copy()
            d.matrix_world = mw
            d.location = (d.location.x, d.location.y, d.location.z + SH*(k-1))
            bpy.context.scene.collection.objects.link(d)
groups['top'].location = (0, 0, SH*4)

sc = bpy.context.scene
cam = bpy.data.objects['Cam']
views = {
  'bldg_34':   ((16, -16, 13), (math.radians(62), 0, math.radians(45))),
  'bldg_front':((0, -22, 6),  (math.radians(80), 0, 0)),
}
for name, (loc, rot) in views.items():
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = OUT_DIR + name + '.png'
    bpy.ops.render.render(write_still=True)
print('BLDG_RENDER_OK')
