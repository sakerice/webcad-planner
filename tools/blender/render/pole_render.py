import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
for ob in bpy.data.objects:
    if ob.name.startswith(('car_', 'nh_', 'bd_', 'bdprev_')):
        ob.hide_render = True
    if ob.name.startswith('up_'):
        ob.hide_render = False
sc = bpy.context.scene
cam = bpy.data.objects['Cam']
cam.location = (9.5, -11.0, 5.6); cam.rotation_euler = (math.radians(75), 0, math.radians(40))
sc.render.filepath = OUT_DIR + 'pole.png'
bpy.ops.render.render(write_still=True)
print('OK')
