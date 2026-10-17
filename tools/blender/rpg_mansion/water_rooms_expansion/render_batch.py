"""Render product images from reopened final canonical sources only."""
import sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import bpy
from build import render,ROOT
items=json.loads((HERE/'descriptors.json').read_text())['items']
only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
for item in items:
    if only and item['id']not in only:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']),load_ui=False)
    assert bpy.context.scene.name=='Validated export'
    ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    for view in ['thumb','top','front','rear']:
        target=(HERE/'qa/pixel-replay'/(item['id']+'-'+view+'.png'))if '--replay'in sys.argv else ROOT/item[view]
        render(ob,target,view)
    print('WATER_RENDERED '+item['id'],flush=True)
