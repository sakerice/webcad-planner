"""Fresh Blender process: import only the final GLB and inspect its mesh."""
import json
import sys
from pathlib import Path
import bpy
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1]))
import model_kit as kit
ID = 'kominka-kitchen-run-2560-01'
kit.clear_scene()
bpy.ops.import_scene.gltf(filepath=str(ROOT/f'assets/models/packs/kominka/models/{ID}.glb'))
parts = [o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(parts)==1
obj = parts[0]
points = [obj.matrix_world@v.co for v in obj.data.vertices]
lo = [min(p[i] for p in points) for i in range(3)]
hi = [max(p[i] for p in points) for i in range(3)]
dims = [(hi[i]-lo[i])*1000 for i in range(3)]
assert max(abs(got-want) for got,want in zip(dims,[2560,650,850]))<1
assert abs(lo[2])<1e-6 and max(abs(lo[i]+hi[i]) for i in (0,1))<1e-6
assert len(obj.data.uv_layers)==1
channels = {m.get('finishChannel') for m in obj.data.materials}
assert channels=={'wood','stone','plaster','metal'}
triangles = kit.tri_count(obj)
assert triangles<=20000
uv = kit.uv_report(obj)
assert uv['excluded_triangles']==0
report = dict(dimensionsBlenderMm=dims,boundsBlenderM=[lo,hi],triangles=triangles,
    uv=uv,channels=sorted(channels),frontAxis=obj.get('frontAxis'),upAxis=obj.get('upAxis'),
    pivot=obj.get('pivot'),blenderVersion=bpy.app.version_string,
    importedObjectTransform=dict(location=list(obj.location),scale=list(obj.scale),
        rotation=list(obj.rotation_euler)))
assert report['frontAxis']=='+Z' and report['upAxis']=='+Y' and report['pivot']=='bottom-center'
(HERE/'glb-reimport-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
