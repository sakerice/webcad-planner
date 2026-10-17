from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
for it in json.loads((HERE/'reports/installation-proofs.json').read_text())['items']:
    path=HERE/it['scene'];bpy.ops.wm.open_mainfile(filepath=str(path));objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    render(objects,HERE/'evidence'/(path.stem+'-exterior-front.png'),'front',768)
