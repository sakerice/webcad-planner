import sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build
import bpy
only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
for item in json.loads((HERE/'storage-items.json').read_text())['items']:
 if only and item['id'].replace('rpg-mansion-','').removesuffix('-01') not in only:continue
 bpy.ops.wm.open_mainfile(filepath=str(build.ROOT/item['exportBlend']))
 obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
 for view,key in [('thumb','thumb'),('top','top'),('front','front'),('rear','rear')]:build.render(obj,build.ROOT/item[key],view)
 print('RENDERED '+item['id'],flush=True)
