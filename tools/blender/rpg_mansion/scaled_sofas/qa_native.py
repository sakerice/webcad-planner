"""Read-only reopened native gates and exact triangle/containment contacts.

Contact test follows the prior independent world triangle BVH and three-ray
containment method at 20 micrometres. This is static modeled support evidence.
"""
from pathlib import Path
import sys,json,collections,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from native_utils import positive_winding,export_active
import qa_asset_delivery as qa
import model_kit as kit
EPS=.00002
DIRECTIONS=[Vector(v).normalized()for v in [(1,.371,.213),(.217,1,.419),(.311,.247,1)]]
def inside(tree,point):
    nearest=tree.find_nearest(point)
    if nearest[0]is not None and nearest[3]<=EPS:return True
    decisions=[]
    for direction in DIRECTIONS:
        origin=point.copy();hits=0
        for _ in range(100):
            hit,_,_,_=tree.ray_cast(origin,direction)
            if hit is None:break
            hits+=1;origin=hit+direction*(EPS*4)
        decisions.append(hits%2)
    return sum(decisions)>=2

def contacts(scene):
    parts=[]
    for ob in scene.objects:
        if ob.type!='MESH':continue
        ob.data.calc_loop_triangles();points=[ob.matrix_world@v.co for v in ob.data.vertices];faces=[tuple(t.vertices)for t in ob.data.loop_triangles]
        lo=[min(v[i]for v in points)for i in range(3)];hi=[max(v[i]for v in points)for i in range(3)]
        parts.append(dict(name=ob.name,role=ob.get('functionalRole'),points=points,lo=lo,hi=hi,tree=BVHTree.FromPolygons(points,faces,all_triangles=True,epsilon=EPS)))
    graph=[set()for _ in parts];edges=[]
    for i,p in enumerate(parts):
        for j in range(i):
            q=parts[j]
            if any(p['lo'][a]>q['hi'][a]+EPS or q['lo'][a]>p['hi'][a]+EPS for a in range(3)):continue
            hit=bool(p['tree'].overlap(q['tree']))
            if not hit:
                for points,tree in [(p['points'],q['tree']),(q['points'],p['tree'])]:
                    if any(inside(tree,v)for v in points):hit=True;break
            if hit:graph[i].add(j);graph[j].add(i);edges.append([p['name'],q['name']])
    unseen=set(range(len(parts)));groups=[]
    while unseen:
        seed=unseen.pop();stack=[seed];ids=[]
        while stack:
            i=stack.pop();ids.append(i)
            for j in graph[i]&unseen:unseen.remove(j);stack.append(j)
        g=dict(parts=[parts[i]['name']for i in ids],ground_contact=any(parts[i]['lo'][2]<=EPS for i in ids),lowest_mm=min(parts[i]['lo'][2]for i in ids)*1000)
        if not g['ground_contact']:
            best=float('inf');pair=None
            for i in ids:
                p=parts[i]
                for j,q in enumerate(parts):
                    if j in ids:continue
                    lower=sum(max(0,p['lo'][a]-q['hi'][a],q['lo'][a]-p['hi'][a])**2 for a in range(3))**.5
                    if lower>best:continue
                    ds=[q['tree'].find_nearest(v)[3]for v in p['points']]+[p['tree'].find_nearest(v)[3]for v in q['points']]
                    distance=min(d for d in ds if d is not None)
                    if distance<best:best=distance;pair=[p['name'],q['name']]
            g.update(nearest_pair=pair,nearest_vertex_surface_distance_mm=best*1000)
        groups.append(g)
    loadpaths=[];ground={i for i,p in enumerate(parts)if p['lo'][2]<=EPS}
    for i,p in enumerate(parts):
        if p['role']!='seat-cushion':continue
        pending=collections.deque([(i,[p['name']])]);seen={i};found=None
        while pending:
            k,path=pending.popleft()
            if k in ground:found=path;break
            for j in graph[k]-seen:seen.add(j);pending.append((j,path+[parts[j]['name']]))
        loadpaths.append(dict(seat_part=p['name'],actual_top_mm=p['hi'][2]*1000,actual_width_mm=(p['hi'][0]-p['lo'][0])*1000,actual_depth_mm=(p['hi'][1]-p['lo'][1])*1000,modeled_contact_path_to_floor=found))
    return dict(native_parts=len(parts),groups=groups,contact_edges=edges,seat_load_paths=loadpaths,floating_groups=sum(not g['ground_contact']for g in groups))

items=json.loads((HERE/'descriptors.json').read_text())['items'];reports=[]
only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
for item in items:
 if only and item['id']not in only:continue
 path=ROOT/item['sourceBlend'];before=qa.sha256(path);bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False);active=bpy.context.scene
 assert active.name=='Validated export';meshes=[o for o in active.objects if o.type=='MESH'];assert len(meshes)==1;ob=meshes[0]
 native=bpy.data.scenes['Native authoring parts'];a=qa.native_scene_signature(native);b=qa.native_scene_signature(active)
 errs=[]
 if a['point_support']!=b['point_support'] or a['triangle_counts']!=b['triangle_counts']:errs.append('Native parts differ from canonical geometry/material point support')
 seat=qa.native_seat_component_measurement(ob)
 expected=item.get('seatCushionCount',item['seatingCapacity'])
 if seat['cushion_count']!=expected or any(abs(s['seat_surface_top_mm']-460)>.01 for s in seat['cushions']):errs.append('Actual seat component count/height differs')
 volumes=positive_winding(ob,repair=False);partvol={p.name:positive_winding(p,repair=False)for p in native.objects if p.type=='MESH'}
 support=contacts(native)
 if support['floating_groups']:errs.append('Actual native contact groups detached from floor')
 if any(p['modeled_contact_path_to_floor'] is None for p in support['seat_load_paths']):errs.append('Seat has no modeled contact path to floor')
 if any(abs(p['actual_top_mm']-460)>.01 for p in support['seat_load_paths']):errs.append('Named seat component top disagrees with actual 460 mm height')
 if len(support['seat_load_paths'])!=expected:errs.append('Native seat parts capacity differs')
 if len(ob.data.uv_layers)!=1 or ob.modifiers:errs.append('Canonical mesh UV/modifier contract fails')
 if len(bpy.data.scenes)!=2 or any(s.render.filepath[:2]!='//' for s in bpy.data.scenes):errs.append('Scene/render path contract fails')
 if bpy.data.libraries or any(getattr(block,'library_weak_reference',None)for block in bpy.data.user_map()):errs.append('Library dependency or weakref retained')
 if any(im.source=='FILE' and im.filepath for im in bpy.data.images):errs.append('External image retained')
 export=HERE/'qa'/'regenerated'/(item['id']+'.glb');export_active(ob,export)
 reports.append(dict(id=item['id'],source_sha256=before,source_unchanged=before==qa.sha256(path),scene_count=2,native_parts_geometry_material_support_matches_export=(a['point_support']==b['point_support'] and a['triangle_counts']==b['triangle_counts']),actual_seat_measurement=seat,positive_signed_component_volumes_m3=volumes,positive_native_part_volumes_m3=partvol,actual_support=support,uv=kit.uv_report(ob),source_reexport=str(export.relative_to(ROOT)),errors=errs))
 authoring_path=ROOT/item['authoringBlend'];authoring_before=qa.sha256(authoring_path)
 bpy.ops.wm.open_mainfile(filepath=str(authoring_path),load_ui=False)
 authored=qa.native_scene_signature(bpy.context.scene)
 authoring_matches=authored['point_support']==a['point_support'] and authored['triangle_counts']==a['triangle_counts']
 if not authoring_matches:errs.append('Standalone editable authoring source differs from canonical native parts')
 if len(bpy.data.scenes)!=1 or bpy.context.scene.name!='Native authoring parts':errs.append('Standalone authoring scene contract fails')
 if bpy.data.libraries or any(getattr(block,'library_weak_reference',None)for block in bpy.data.user_map()):errs.append('Standalone authoring retains library dependency')
 if any(s.render.filepath[:2]!='//' for s in bpy.data.scenes):errs.append('Standalone authoring contains absolute render path')
 if any(im.source=='FILE' and im.filepath for im in bpy.data.images):errs.append('Standalone authoring retains external image')
 reports[-1].update(authoring_sha256=authoring_before,authoring_source_unchanged=authoring_before==qa.sha256(authoring_path),standalone_authoring_matches_canonical_parts=authoring_matches)
 (HERE/'qa').mkdir(exist_ok=True);(HERE/'qa/native.json').write_text(json.dumps(dict(items=reports,errors=sum(len(r['errors'])for r in reports)),indent=2)+'\n')
 print('SOFA_NATIVE_QA',item['id'],errs,flush=True)

raise SystemExit(any(r['errors']for r in reports))
