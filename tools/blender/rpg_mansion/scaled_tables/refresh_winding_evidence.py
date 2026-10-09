"""Re-export and rerender only the four corrected production assets."""
import json
import math
import shutil
import sys
from pathlib import Path

import bpy

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE))
from repair_winding import TARGETS, repair_mesh_winding
from build import export_active,stamp_contract,configure_render,kit
from png_metadata import strip_metadata

configure_render()
items=json.loads((HERE/'descriptors.json').read_text())
for item in items:
    if item['id'] not in TARGETS:continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']),load_ui=False)
    obj=next(ob for ob in bpy.context.scene.objects if ob.type=='MESH')
    assert all(row['signedVolumeAfterM3']>0 for row in repair_mesh_winding(obj,repair=False)['components'])
    export_active(obj,ROOT/item['model']);stamp_contract(ROOT/item['model'],item['id'])
    mesh=obj.data;mesh.calc_loop_triangles()
    points=[obj.matrix_world@v.co for v in mesh.vertices]
    lo=[min(p[i]for p in points)for i in range(3)];hi=[max(p[i]for p in points)for i in range(3)]
    report=json.loads((ROOT/item['validation']).read_text())
    report.update(dimensions_mm=[(hi[i]-lo[i])*1000 for i in range(3)],bounds_m=[lo,hi],
                  triangles=len(mesh.loop_triangles),uv=kit.uv_report(obj),
                  materials={mat.name:mat.get('finishChannel')for mat in mesh.materials},
                  outwardWinding=True,glb_bytes=(ROOT/item['model']).stat().st_size)
    (ROOT/item['validation']).write_text(json.dumps(report,indent=2)+'\n')
    print('CORRECTED_EXPORT',item['id'],flush=True)
    kit.render_top(obj,str(ROOT/item['top']))
    kit.render_thumb(obj,str(ROOT/item['thumb']))
    shutil.copy2(ROOT/item['thumb'],ROOT/item['front'])
    obj.rotation_euler.z=math.pi;bpy.context.view_layer.update()
    kit.render_thumb(obj,str(ROOT/item['rear']))
    for field in ['top','thumb','front','rear']:strip_metadata(ROOT/item[field])
    print('CORRECTED_EVIDENCE',item['id'],flush=True)
