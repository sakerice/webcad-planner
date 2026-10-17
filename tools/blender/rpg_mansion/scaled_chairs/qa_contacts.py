"""Independent closed native-part contact and support inspection; read-only sources.

Conservative 20um world-space triangle contact plus full-vertex containment.
Groups are static contact evidence, not simulated joints or mechanism engineering.
"""
import sys,json
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import hashlib
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
class Audit:
    HERE=H
    @staticmethod
    def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
    @staticmethod
    def descriptors(family):
        descriptor=H/'descriptors.json'
        return ROOT,descriptor,json.loads(descriptor.read_text())['items']
    @staticmethod
    def write(path,obj): path.write_text(json.dumps(obj,indent=2)+'\n')
audit=Audit()
EPS=.00002
DIRECTIONS=[Vector(v).normalized()for v in [(1,.371,.213),(.217,1,.419),(.311,.247,1)]]

def inside(tree,point):
    nearest=tree.find_nearest(point)
    if nearest[0] is not None and nearest[3]<=EPS:return True
    decisions=[]
    for direction in DIRECTIONS:
        origin=point.copy();hits=0
        for _ in range(100):
            hit,_,_,_=tree.ray_cast(origin,direction)
            if hit is None:break
            hits+=1;origin=hit+direction*(EPS*4)
        decisions.append(hits%2)
    return sum(decisions)>=2

families=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else ['chairs']
for family in families:
    root,descriptor,items=audit.descriptors(family);reports=[]
    for item in items:
        path=root/item['sourceBlend'];before=audit.digest(path);bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
        scene=next(s for s in bpy.data.scenes if s.name.startswith('Native authoring parts'));parts=[]
        for ob in scene.objects:
            if ob.type!='MESH':continue
            ob.data.calc_loop_triangles();points=[ob.matrix_world@v.co for v in ob.data.vertices];faces=[tuple(t.vertices)for t in ob.data.loop_triangles]
            lo=[min(v[i]for v in points)for i in range(3)];hi=[max(v[i]for v in points)for i in range(3)]
            parts.append(dict(name=ob.name,points=points,lo=lo,hi=hi,tree=BVHTree.FromPolygons(points,faces,all_triangles=True,epsilon=EPS)))
        graph=[set()for _ in parts];contacts=[]
        for i,p in enumerate(parts):
            for j in range(i):
                q=parts[j]
                if any(p['lo'][a]>q['hi'][a]+EPS or q['lo'][a]>p['hi'][a]+EPS for a in range(3)):continue
                hit=bool(p['tree'].overlap(q['tree']))
                if not hit:
                    for points,tree in [(p['points'],q['tree']),(q['points'],p['tree'])]:
                        # All vertices, avoiding a sparse sample falsely missing tiny hardware.
                        if any(inside(tree,v)for v in points):hit=True;break
                if hit:graph[i].add(j);graph[j].add(i);contacts.append([p['name'],q['name']])
        unseen=set(range(len(parts)));groups=[];group_ids=[]
        while unseen:
            seed=unseen.pop();stack=[seed];ids=[]
            while stack:
                i=stack.pop();ids.append(i)
                for j in graph[i]&unseen:unseen.remove(j);stack.append(j)
            group_ids.append(ids);groups.append(dict(parts=[parts[i]['name']for i in ids],ground_contact=any(parts[i]['lo'][2]<=EPS for i in ids),lowest_mm=min(parts[i]['lo'][2]for i in ids)*1000))
        for g,ids in zip(groups,group_ids):
            if g['ground_contact']:continue
            best=float('inf');pair=None;best_bbox=None
            for i in ids:
                p=parts[i]
                for j,q in enumerate(parts):
                    if j in ids:continue
                    axis=[max(0,p['lo'][a]-q['hi'][a],q['lo'][a]-p['hi'][a])for a in range(3)];lower=sum(x*x for x in axis)**.5
                    if lower>best:continue
                    ds=[q['tree'].find_nearest(v)[3]for v in p['points']]+[p['tree'].find_nearest(v)[3]for v in q['points']]
                    distance=min(d for d in ds if d is not None)
                    if distance<best:best=distance;pair=[p['name'],q['name']];best_bbox=lower
            g.update(nearest_other_part_pair=pair,nearest_vertex_surface_distance_mm=best*1000,nearest_pair_bbox_separation_mm=best_bbox*1000 if best_bbox is not None else None)
        reports.append(dict(id=item['id'],source_sha256=before,native_parts=len(parts),groups=groups,group_count=len(groups),floating_groups=sum(not g['ground_contact']for g in groups),contact_edges=contacts,source_changed=audit.digest(path)!=before))
        audit.write(audit.HERE/'qa-namedpart-contact.json',dict(tolerance_m=EPS,method='Independent world triangle BVH contacts or majority-of-three-direction point containment',items=reports))
        print('CONTACT',family,item['id'],len(groups),[g['parts']for g in groups if not g['ground_contact']],flush=True)

errors=[r['id']+': unsupported native group' for r in reports if r['floating_groups']]
print('NATIVE_SUPPORT_ERRORS',errors,flush=True)
assert not errors
