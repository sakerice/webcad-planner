"""Reopen both editable sources, inspect them, and re-export final UV mesh.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/classic_car/reexport_source.py
Compare /tmp/webcad-classic-car-source-reexport with verify.py --compare afterwards.
"""
import json
import os
import sys
from pathlib import Path

import bpy
import bmesh

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]))
from shape_kit import export
ID='rpg-mansion-classic-sedan-01'
out=Path(os.environ.get('WEBCAD_CAR_SOURCE_REEXPORT','/tmp/webcad-classic-car-source-reexport')).resolve()
bpy.ops.wm.open_mainfile(filepath=str(HERE/(ID+'.blend')))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(objects)==1
obj=objects[0]
assert obj.name==ID and len(obj.data.uv_layers)==1
assert len(obj.modifiers)==0 and obj.location.length<1e-8
bm=bmesh.new();bm.from_mesh(obj.data)
nonmanifold=sum(not e.is_manifold for e in bm.edges)
bm.free()
assert nonmanifold==0
source={'mesh_count':1,'modifiers':0,'uv_layers':1,'nonmanifold_edges':nonmanifold,
        'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),
        'finish_channels':sorted({m.get('finishChannel') for m in obj.data.materials if m.get('finishChannel')})}
export(obj,str(out/'assets/models/packs/rpg-mansion/models'/(ID+'.glb')))
bpy.ops.wm.open_mainfile(filepath=str(HERE/(ID+'-authoring.blend')))
parts=[o for o in bpy.context.scene.objects if o.type=='MESH']
def count(prefix):return sum(o.name.split('.')[0]==prefix for o in parts)
assert count('Rounded tire')==4
assert count('Front swept fender')==2 and count('Rear swept fender')==2
assert count('Leather bench cushion')==2 and count('Leather bench back')==2
report={'status':'passed','blender':bpy.app.version_string,'export_source':source,
        'authoring_source':{'mesh_parts':len(parts),'tires':4,'front_fenders':2,'rear_fenders':2,
                            'bench_seats':2,'named_parts':sorted(o.name for o in parts)},
        'reexport_output':'temporary output; not included in delivery'}
(HERE/'source-checks.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k]for k in ['status','blender','export_source']},indent=2))
