"""Regenerate only pack previews using the existing renderer, never geometry."""
import sys,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sys.path.insert(0,str(HERE.parent))
import bpy
from exterior_build import render_top,render_thumb
sys.path.insert(0,str(HERE))
from render_config import configure
configure()
manifest=json.loads((ROOT/'assets/models/packs/rpg-mansion/manifest.json').read_text())
for item in manifest['items']:
    if '--only' in sys.argv and item['id'] not in ['rpg-mansion-'+s+'-01' for s in sys.argv[sys.argv.index('--only')+1].split(',')]:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']))
    obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    (ROOT/item['thumb']).parent.mkdir(parents=True,exist_ok=True)
    render_top(obj,str(ROOT/item['top']))
    render_thumb(obj,str(ROOT/item['thumb']))
    obj.rotation_euler.z=math.pi
    bpy.context.view_layer.update()
    render_thumb(obj,str(ROOT/item['rear']))
    print('PREVIEW_COMPLETE '+item['id'],flush=True)
