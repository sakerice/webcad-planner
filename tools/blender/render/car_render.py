import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.hide_render = not (ob.name.startswith('car_') or ob.name == 'PreviewGround')
sc = bpy.context.scene
cam = bpy.data.objects['Cam']
views = {
  'car_34front': ((4.6, 5.4, 2.1), (math.radians(72), 0, math.radians(140))),
  'car_34rear':  ((4.9, -5.2, 2.2), (math.radians(71), 0, math.radians(43))),
  'car_side':    ((6.8, 0, 1.15),   (math.radians(83), 0, math.radians(90))),
  'car_rq_high': ((5.2, -4.4, 3.2), (math.radians(60), 0, math.radians(50))),
}
for name, (loc, rot) in views.items():
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = OUT_DIR + name + '.png'
    bpy.ops.render.render(write_still=True)
print('OK')
