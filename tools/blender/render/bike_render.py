import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.hide_render = not (ob.name.startswith('bk_') or ob.name == 'PreviewGround')
sc = bpy.context.scene
cam = bpy.data.objects['Cam']
views = {
  'bike_34':  ((2.6, 3.0, 1.5), (math.radians(70), 0, math.radians(140))),
  'bike_side':((2.6, 0, 0.75),  (math.radians(80), 0, math.radians(90))),
}
for name, (loc, rot) in views.items():
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = OUT_DIR + name + '.png'
    bpy.ops.render.render(write_still=True)
print('OK')
