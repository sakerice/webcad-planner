import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
SH = 2.7
# group under empties
def ensure_empty(name):
    e = bpy.data.objects.get(name)
    if not e:
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
    return e
groups = {'base': ensure_empty('nh_base'), 'mid': ensure_empty('nh_mid'), 'roof': ensure_empty('nh_roof')}
for ob in bpy.data.objects:
    if ob.type in ('MESH',) and ob.name.startswith('nh_'):
        for key, e in groups.items():
            if ob.name.startswith('nh_' + key + '_'):
                if ob.parent != e:
                    ob.parent = e
# stack: 2F house = base + 1 mid + roof
groups['base'].location = (0, 0, 0)
groups['mid'].location = (0, 0, SH)
groups['roof'].location = (0, 0, SH*2)
# hide car for these shots
for ob in bpy.data.objects:
    if ob.name.startswith(('car_', 'bd_', 'bdprev_')):
        ob.hide_render = True
    elif ob.name.startswith('nh_'):
        ob.hide_render = False

sc = bpy.context.scene
cam = bpy.data.objects['Cam']
views = {
  'house_34':   ((13.5, -13.5, 9.0), (math.radians(64), 0, math.radians(45))),
  'house_front':((0, -17.5, 4.0),  (math.radians(80), 0, 0)),
  'house_34b':  ((-13.5, 13.5, 9.0), (math.radians(64), 0, math.radians(225))),
}
for name, (loc, rot) in views.items():
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = OUT_DIR + name + '.png'
    bpy.ops.render.render(write_still=True)
print('HOUSE_RENDER_OK')
