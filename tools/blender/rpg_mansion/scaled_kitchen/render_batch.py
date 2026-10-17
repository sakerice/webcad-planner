"""Render current validated kitchen sources without modifying geometry or sources."""
from pathlib import Path
import sys,json,math
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parent.parent)]
import bpy,exterior_build
from png_metadata import strip_metadata
from render_config import configure
from build import studio
configure()
items=json.loads((HERE/'descriptors.json').read_text())['items']
only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
for item in items:
 if only and item['id'] not in only:continue
 if '--missing' in sys.argv and all((ROOT/item[k]).exists() for k in ['thumb','top','front','rear']):continue
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']))
 ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
 exterior_build.render_top(ob,str(ROOT/item['top']));exterior_build.render_thumb(ob,str(ROOT/item['thumb']))
 for k in ['thumb','top']:strip_metadata(ROOT/item[k])
 studio(ob,ROOT/item['front']);studio(ob,ROOT/item['rear'],True)
 print('KITCHEN_RENDERED '+item['id'],flush=True)
