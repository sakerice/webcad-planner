"""Reexport every editable source and compare the shipped GLB byte-for-byte.

Blender --background --factory-startup --python tools/blender/rpg_mansion/doors/validate_sources.py
"""
import hashlib
import json
import sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from build import IDS,ROOT,kit
from shape_kit import export


if __name__=='__main__':
    results=[]
    out=Path('/tmp/webcad-door-reexports');out.mkdir(exist_ok=True)
    for stem in IDS:
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(stem+'.blend')))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
        assert len(objects)==1
        obj=objects[0]
        assert obj.location.length<1e-7 and all(abs(v-1)<1e-7 for v in obj.scale)
        assert len(obj.data.uv_layers)==1 and not obj.modifiers
        assert all(n.type!='TEX_IMAGE' for m in obj.data.materials for n in m.node_tree.nodes)
        assert kit.uv_report(obj)['excluded_triangles']==0
        path=out/(stem+'.glb')
        export(obj,str(path))
        shipped=ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb')
        original=hashlib.sha256(shipped.read_bytes()).hexdigest()
        replay=hashlib.sha256(path.read_bytes()).hexdigest()
        assert original==replay,(stem,'Source and GLB differ',original,replay)
        results.append(dict(id=stem,sha256=original,reexport_byte_identical=True,
                            single_mesh=True,uv_layers=1,unapplied_modifiers=0,image_textures=0))
    (HERE/'source-validation.json').write_text(json.dumps(dict(blender=bpy.app.version_string,
        sources=results,status='pass'),indent=2)+'\n')
    print('ALL FIVE SOURCE REEXPORTS BYTE IDENTICAL',flush=True)
