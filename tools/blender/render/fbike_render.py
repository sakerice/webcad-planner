import bpy, math
import os
OUT_DIR = os.environ.get('WEBCAD_RENDER_OUT', '/tmp/webcad-render/') 
os.makedirs(OUT_DIR, exist_ok=True)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.hide_render = not (ob.name.startswith('bk2_') or ob.name == 'PreviewGround')
sc = bpy.context.scene
cam = bpy.data.objects['Cam']
cam.location = (2.0, 0.4, 0.7); cam.rotation_euler = (math.radians(80), 0, math.radians(90))
sc.render.filepath = OUT_DIR + 'fbike_side.png'
bpy.ops.render.render(write_still=True)
print('OK')
