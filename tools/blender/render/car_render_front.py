import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.hide_render = not (ob.name.startswith('car_') or ob.name == 'PreviewGround')
sc = bpy.context.scene
cam = bpy.data.objects['Cam']
cam.location = (0.0, 6.8, 1.05)
cam.rotation_euler = (math.radians(84), 0, math.radians(180))
sc.render.filepath = OUT_DIR + 'car_front.png'
bpy.ops.render.render(write_still=True)
print('OK')
