"""Re-export every saved .blend into an isolated directory; originals untouched.
Blender -b --factory-startup -P reexport.py -- --output-dir /tmp/kominka-source
"""
import argparse,json,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from shape_kit import export
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output_dir.mkdir(parents=True,exist_ok=True)
for it in json.loads((HERE/'catalogue.json').read_text())['items']:
    mid='kominka-'+it['stem']+'-01'
    bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/f'{mid}.blend'))
    mesh=bpy.data.objects[mid]
    assert mesh.type=='MESH' and len(mesh.data.uv_layers)==1,mid
    export(mesh,str(a.output_dir/f'{mid}.glb'))
    print('REEXPORTED '+mid,flush=True)
