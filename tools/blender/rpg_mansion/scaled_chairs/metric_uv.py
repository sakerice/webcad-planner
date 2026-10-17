"""Metric per-face charts, with warped quads unfolded about actual tessellation.
All chart coordinates use physical metres and a uniform final island pack.
Mesh topology, normals, smoothing and face materials remain unmodified.
"""
import math
import bpy
from mathutils import Vector

def unfold_pack(ob,margin=.0025):
 mesh=ob.data;mesh.calc_loop_triangles();layer=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
 tris={}
 for tri in mesh.loop_triangles:tris.setdefault(tri.polygon_index,[]).append(tuple(tri.vertices))
 for chart,p in enumerate(mesh.polygons):
  pts=[ob.matrix_world@mesh.vertices[mesh.loops[i].vertex_index].co for i in p.loop_indices];pair=tris[p.index]
  if len(p.vertices)==4 and len(pair)==2:
   shared=set(pair[0])&set(pair[1]);a,b=sorted(shared);c=next(v for v in pair[0]if v not in shared);d=next(v for v in pair[1]if v not in shared)
   point={i:ob.matrix_world@mesh.vertices[i].co for i in p.vertices};length=(point[b]-point[a]).length;assert length>1e-12
   sign=1 if any(tuple(pair[0][k:]+pair[0][:k])==(a,b,c)for k in range(3))else -1
   coords={a:(0.,0.),b:(length,0.)}
   for index,direction in [(c,sign),(d,-sign)]:
    ac=(point[index]-point[a]).length;bc=(point[index]-point[b]).length;x=(ac*ac+length*length-bc*bc)/(2*length);height=math.sqrt(max(0.,ac*ac-x*x));assert height>1e-12,(ob.name,p.index)
    coords[index]=(x,direction*height)
   xy=[coords[mesh.loops[i].vertex_index]for i in p.loop_indices]
  else:
   edges=[pts[(i+1)%len(pts)]-pts[i]for i in range(len(pts))];u=max(edges,key=lambda e:e.length).normalized();normal=(ob.matrix_world.to_3x3().inverted().transposed()@p.normal).normalized();v=normal.cross(u).normalized();xy=[(q.dot(u),q.dot(v))for q in pts]
  lo=[min(q[i]for q in xy)for i in range(2)]
  for index,(a,b)in zip(p.loop_indices,xy):layer.data[index].uv=(a-lo[0]+3*(chart+1),b-lo[1])
 layer.active_render=True
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.select_all(action='SELECT');bpy.ops.uv.pack_islands(rotate=True,margin=margin);bpy.ops.object.mode_set(mode='OBJECT')
 mesh.update();ob['metricQuadUnfoldAtlas']=True
 return ob
