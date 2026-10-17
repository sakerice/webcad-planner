import sys,json,hashlib
from pathlib import Path
import bpy
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path[:0]=[str(H),str(H.parent)]
from render import render
p=H/'assemblies/joined-mansard-room.json';d=json.loads(p.read_text());src=ROOT/d['source'];before=hashlib.sha256(src.read_bytes()).hexdigest();assert before==d['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(src),load_ui=False);obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];visible=[o for o in obs if o.get('moduleCategory')=='ceiling']
for o in obs:o.hide_render=o not in visible
image=H/'assemblies/joined-mansard-room-ceiling-array.png';camera=render(visible,image,(5,-7,-6),resolution=1024,samples=48);d['views']['ceiling-array']=dict(path=str(image.relative_to(ROOT)),sha256=hashlib.sha256(image.read_bytes()).hexdigest(),camera=camera,visibleCategories=['ceiling'],omittedInstances=[o.name for o in obs if o not in visible],note='Whole-module visibility cutaway only; all geometry and placement unchanged.')
assert before==hashlib.sha256(src.read_bytes()).hexdigest();p.write_text(json.dumps(d,indent=2)+'\n')
