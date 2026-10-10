"""Reexport all mystery .blend files and compare the shipped GLB bytes.

Blender --background --factory-startup --python tools/blender/rpg_mansion/mystery_props/validate_sources.py
"""
import hashlib
import json
import sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from build import ENTRIES,ROOT,kit
from shape_kit import export


if __name__=='__main__':
    out=Path('/tmp/webcad-mystery-reexports');out.mkdir(exist_ok=True)
    results=[]
    for stem,*_ in ENTRIES:
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(stem+'.blend')))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==1
        obj=objects[0]
        assert len(obj.data.uv_layers)==1 and not obj.modifiers
        assert kit.uv_report(obj)['excluded_triangles']==0
        assert all(n.type!='TEX_IMAGE' for m in obj.data.materials for n in m.node_tree.nodes)
        path=out/(stem+'.glb');export(obj,str(path))
        shipped=ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb')
        sha=hashlib.sha256(shipped.read_bytes()).hexdigest()
        assert hashlib.sha256(path.read_bytes()).hexdigest()==sha,stem
        results.append(dict(id=stem,sha256=sha,reexport_byte_identical=True,single_mesh=True,uv_layers=1))
    (HERE/'source-validation.json').write_text(json.dumps(dict(status='pass',blender=bpy.app.version_string,
        sources=results),indent=2)+'\n')
    print('PASS: every mystery source reexport byte-identical',flush=True)
