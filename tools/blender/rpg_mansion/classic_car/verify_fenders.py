"""Inspect the repaired native end curls against the original PR89 source.

blender -b --factory-startup --python tools/blender/rpg_mansion/classic_car/verify_fenders.py
BASELINE_CAR_BLEND may point to the first PR89 authoring source from git show.
"""
import hashlib
import json
import math
import os
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE=Path(__file__).resolve().parent
ID='rpg-mansion-classic-sedan-01'
baseline=Path(os.environ.get('BASELINE_CAR_BLEND','/tmp/webcad-classic-car-fix-geometry-baseline-20261010/authoring.blend'))


def capture(path):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    result={}
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        bm=bmesh.new();bm.from_mesh(obj.data)
        nonmanifold=sum(not e.is_manifold for e in bm.edges)
        bm.free()
        result[obj.name]={
            'vertices':[tuple(obj.matrix_world@v.co)for v in obj.data.vertices],
            'faces':[tuple(p.vertices)for p in obj.data.polygons],
            'face_materials':[p.material_index for p in obj.data.polygons],
            'materials':[m.name for m in obj.data.materials],
            'nonmanifold_edges':nonmanifold,
        }
    return result


def surfaces(part):
    # Native sphere/normal operations may rotate face index loops. Compare the
    # physical face and its material, independent of vertex and face ordering.
    return sorted((mat,tuple(sorted(tuple(round(x,6)for x in part['vertices'][i])for i in face)))
                  for face,mat in zip(part['faces'],part['face_materials']))


old=capture(baseline)
new=capture(HERE/(ID+'-authoring.blend'))
assert old.keys()==new.keys()
unchanged=[];fenders=[]
for name,part in new.items():
    if 'swept fender' not in name:
        assert len(part['vertices'])==len(old[name]['vertices'])
        assert surfaces(part)==surfaces(old[name]),('unrequested surface changed',name)
        assert part['materials']==old[name]['materials'] and part['nonmanifold_edges']==old[name]['nonmanifold_edges']
        unchanged.append(name)
        continue
    front=name.startswith('Front')
    points=[Vector(p)for p in part['vertices']]
    rings=[points[i:i+8]for i in range(0,len(points),8)]
    assert part['nonmanifold_edges']==0 and part['materials']==['CarBody_ClassicGreen']
    previous=[Vector(p)for p in old[name]['vertices']]
    original_core=previous[16:] if front else previous[:160]
    current_core=points[40:] if front else points[:160]
    assert len(original_core)==len(current_core)
    assert max((a-b).length for a,b in zip(original_core,current_core))<1e-7
    # Highest crown vertex (cross-section index 2) follows a downward path
    # from the retained shoulder toward the curled terminal underside.
    tip_rings=list(reversed(rings[:6])) if front else rings[-5:]
    heights=[r[2].z for r in tip_rings]
    assert all(a>b for a,b in zip(heights,heights[1:])),heights
    end_center=sum(tip_rings[-1],Vector())/8
    shoulder_center=sum(tip_rings[0],Vector())/8
    inward=end_center.y>sum(tip_rings[-3],Vector()).y/8 if front else end_center.y<sum(tip_rings[-3],Vector()).y/8
    assert inward,'terminal does not roll inward after turning downward'
    lo=[min(p[i]for p in points)for i in range(3)]
    hi=[max(p[i]for p in points)for i in range(3)]
    assert max(abs(lo[0]),abs(hi[0]))<=.875001
    assert lo[1]>-2.10 if front else hi[1]<2.10
    terminal=tip_rings[-1]
    depth=max(p.y for p in terminal)-min(p.y for p in terminal)
    height=max(p.z for p in terminal)-min(p.z for p in terminal)
    assert depth>.020 and height>.020,'terminal is a flat sheet'
    fenders.append({'part':name,'closed_manifold':True,'original_arch_and_step_vertices_preserved':True,
                    'bounds_blender_m':[lo,hi],'crown_heights_toward_terminal_m':heights,
                    'end_rolls_down_and_inward':inward,'terminal_yz_extent_mm':[depth*1000,height*1000],
                    'longitudinal_clearance_to_bumper_extreme_mm':(2.2996456623077393-(abs(lo[1])if front else hi[1]))*1000})
report={'status':'passed','baseline_commit':'5c9b70bdf42a41b901cb0bed76001b1d8ce02d6e',
        'method':'reopened named native parts; per-material non-fender surfaces at 1 micrometre and measured terminal ring coordinates',
        'unmodified_other_parts':len(unchanged),'fenders':fenders,
        'visual_review':'See final GLB front-left, front-right and rear PNGs; numeric checks supplement visual review'}
(HERE/'fender-checks.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
