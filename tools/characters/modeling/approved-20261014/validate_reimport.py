"""Blender GLB readback, topology diagnostics and static garment clearance."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('character_build',ROOT/'build_characters.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)

def evaluated(o):
    e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();m.calc_loop_triangles()
    points=[e.matrix_world@v.co for v in m.vertices];faces=[tuple(t.vertices) for t in m.loop_triangles]
    e.to_mesh_clear();return points,faces

def triangle_crossings(a,b):
    va,fa=evaluated(a);vb,fb=evaluated(b)
    pairs=BVHTree.FromPolygons(va,fa,all_triangles=True).overlap(BVHTree.FromPolygons(vb,fb,all_triangles=True))
    crossed=[]
    for ai,bi in pairs:
        ta=[va[i] for i in fa[ai]];tb=[vb[i] for i in fb[bi]];hit=False
        for source,target in [(ta,tb),(tb,ta)]:
            for j in range(3):
                start=source[j];delta=source[(j+1)%3]-start
                if delta.length<1e-8:continue
                p=intersect_ray_tri(*target,delta.normalized(),start,True)
                if p is not None and (p-start).dot(delta)>1e-8 and (p-start).length<delta.length-1e-6:hit=True
        if hit:crossed.append([ai,bi])
    return {'bvh_candidate_pairs':len(pairs),'actual_edge_triangle_crossings':len(crossed),'examples':crossed[:8]}

def main():
    out=ROOT/'qa/reimport';out.mkdir(exist_ok=True)
    for path in sorted((ROOT/'models').glob('*.glb')):
        bpy.ops.wm.read_factory_settings(use_empty=False)
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(path))
        models=[o for o in bpy.context.scene.objects if o.type=='MESH'];lo,hi=build.bounds(models)
        source=json.loads((ROOT/'qa'/(path.stem+'-source-validation.json')).read_text())
        target=source['height_m'];assert abs(hi[2]-lo[2]-target)<1e-6 and abs(lo[2])<1e-6
        topology=[];triangles=0
        for o in models:
            vs,fs=evaluated(o);triangles+=len(fs)
            bm=bmesh.new();bm.from_mesh(o.data)
            topology.append({'part':o.name,'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'loose_vertices':sum(not v.link_edges for v in bm.verts),'zero_area_faces':sum(f.calc_area()<1e-12 for f in bm.faces)})
            bm.free()
        assert triangles==source['triangles'] and all(x['loose_vertices']==0 for x in topology)
        skirt=next((o for o in models if o.name.startswith('Outfit.LongSkirt.')),None)
        collision=[]
        if skirt:
            for o in models:
                if o.name.startswith('Body.Leg.') or o.name.startswith('Foot.Sock.'):
                    collision.append({'part':o.name,**triangle_crossings(skirt,o)})
            assert all(x['actual_edge_triangle_crossings']==0 for x in collision),collision
        build.MATERIALS={};cam=build.setup_stage(target)
        renders=[]
        for name,angle in [('front',0),('three-quarter',25),('side',90),('back',180),('face',0)]:
            build.camera_view(cam,angle,target if name=='face' else 1.72,name=='face');scene=bpy.context.scene
            scene.render.resolution_x=1024 if name=='face' else 1152;scene.render.resolution_y=1024 if name=='face' else 1536
            dest=out/(path.stem+'-'+name+'.png');scene.render.filepath=str(dest);bpy.ops.render.render(write_still=True)
            renders.append({'file':str(dest.relative_to(ROOT)),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
        result={'id':path.stem,'input_glb_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'Blender':'5.1.2','readback_succeeded':True,'native_bounds_m':[lo,hi],'height_m':hi[2]-lo[2],'triangles':triangles,'topology':topology,
                'topology_limits':'GLB splits vertices at UV/material seams; raw boundary counts are diagnostic, not an animation-ready or watertight certification. Hair has an intentional hairline cut. Closed assembled submeshes overlap at body/clothing joints.',
                'skirt_static_edge_triangle_intersections':collision,'animated_skirt_collision_tested':False,'renders':renders,'not_tested':source['not_tested']}
        (out/(path.stem+'-validation.json')).write_text(json.dumps(result,indent=2)+'\n');print('REIMPORT_DONE',path.stem,triangles,flush=True)

if __name__=='__main__':main()
