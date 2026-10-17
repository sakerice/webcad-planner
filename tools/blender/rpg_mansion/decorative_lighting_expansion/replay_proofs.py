"""Re-render only reopened proof source scenes, with deterministic mesh ordering."""
import sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path.insert(0,str(HERE))
import bpy
from build import render
from build_installation_proofs import combined,remove_glass
only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
for row in json.loads((HERE/'qa/installation-proofs.json').read_text())['items']:
    if only and row['id']not in only:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/row['proofSource']),load_ui=False);ob=combined()
    for view in ['thumb','side','underside']:
        render(ob,HERE/'qa/proof-pixel-replay'/Path(row['images'][view]['path']).name,view)
    print('INSTALLED_REPLAY_READY',row['id'],flush=True)
for row in json.loads((HERE/'qa/glass-marker.json').read_text())['items']:
    if only and row['id']not in only:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/row['proofSource']),load_ui=False);ob=combined()
    for mode,target in [('actual-export',ob),('no-glass-control',remove_glass(ob))]:render(target,HERE/'qa/proof-pixel-replay'/Path(row['images'][mode]['path']).name,'front')
    print('GLASS_REPLAY_READY',row['id'],flush=True)
