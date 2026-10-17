"""Re-export the saved .blend unchanged into an isolated directory."""
import argparse
import sys
from pathlib import Path
import bpy
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from shape_kit import export
ID = 'kominka-kitchen-run-2560-01'
p = argparse.ArgumentParser()
p.add_argument('--output-dir', type=Path, required=True)
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=str(HERE/f'sources/{ID}.blend'))
obj = bpy.data.objects[ID]
assert obj.type == 'MESH' and len(obj.data.uv_layers) == 1
export(obj, str(a.output_dir/f'{ID}.glb'))
