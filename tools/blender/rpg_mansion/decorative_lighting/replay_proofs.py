"""Replay proof pixels from saved actual-GLB proof source scenes only."""
import sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path[:0]=[str(HERE),str(HERE.parents[1])]
import bpy,bmesh
import model_kit as kit
from build import render
for row in json.loads((HERE/'qa/installation-proofs.json').read_text())['items']:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/row['proofSource']),load_ui=False)
    ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH'])
    for view in ['thumb','side','underside']:
        render(ob,HERE/'qa/proof-pixel-replay'/('qa-installed-'+row['id']+'-'+view+'.png'),view)
row=json.loads((HERE/'qa/glass-marker.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(ROOT/row['proofSource']),load_ui=False)
ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH'])
render(ob,HERE/'qa/proof-pixel-replay/qa-lantern-glass-actual-export.png','front')
control=ob.copy();control.data=ob.data.copy();bpy.context.collection.objects.link(control)
bm=bmesh.new();bm.from_mesh(control.data)
faces=[f for f in bm.faces if control.data.materials[f.material_index].name.startswith('Clear lightly tinted glass')]
bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(control.data);bm.free()
render(control,HERE/'qa/proof-pixel-replay/qa-lantern-glass-no-glass-control.png','front')
print('PROOF_REPLAY_RENDERED',flush=True)
