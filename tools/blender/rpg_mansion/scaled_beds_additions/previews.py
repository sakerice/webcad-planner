from pathlib import Path
import sys,json
H=Path(__file__).resolve().parent;sys.path.insert(0,str(H));import build,bpy
for i in json.loads((H/'bed-items.json').read_text())['items']:
 bpy.ops.wm.open_mainfile(filepath=str(build.ROOT/i['exportBlend']));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
 for view in ['thumb','top','front','rear']:build.B.render(ob,build.ROOT/i[view],view)
 print('BED_ADDITION_RENDERED',i['id'],flush=True)
