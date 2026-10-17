"""Re-export editable .blend originals without modifying them or delivery files."""
import argparse,json,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]))
from shape_kit import export
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output_dir.mkdir(parents=True,exist_ok=True)
for it in json.loads((HERE/'catalogue.json').read_text())['items']:
    mid=it['id'];bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/f'{mid}.blend'))
    obj=bpy.data.objects[mid]
    assert obj.type=='MESH' and len(obj.data.uv_layers)==1,mid
    assert obj['frontAxis']=='+Z' and obj['upAxis']=='+Y' and obj['pivot']=='bottom-center',mid
    export(obj,str(a.output_dir/f'{mid}.glb'));print('REEXPORTED '+mid,flush=True)
