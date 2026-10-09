"""Fast per-face source atlas; final delivery still uses the packed combined atlas.

Each native part has separate uniformly scaled planar face islands. This keeps
small closed brass sweeps editable without Smart-UV curved-island distortion.
"""
def planar_face_atlas(ob):
 mesh=ob.data;layer=mesh.uv_layers.active
 if layer is None:layer=mesh.uv_layers.new(name='UVMap')
 offset=0;max_height=0;raw=[]
 for poly in mesh.polygons:
  coords=[ob.matrix_world@mesh.vertices[mesh.loops[i].vertex_index].co for i in poly.loop_indices]
  edges=[coords[(i+1)%len(coords)]-coords[i] for i in range(len(coords))]
  u=max(edges,key=lambda p:p.length).normalized();normal=(ob.matrix_world.to_3x3().inverted().transposed()@poly.normal).normalized();v=normal.cross(u).normalized()
  q=[(p.dot(u),p.dot(v)) for p in coords];lo=(min(p[0] for p in q),min(p[1] for p in q));width=max(p[0] for p in q)-lo[0];height=max(p[1] for p in q)-lo[1]
  for index,(a,b) in zip(poly.loop_indices,q):raw.append((index,a-lo[0]+offset,b-lo[1]))
  offset+=width+.0005;max_height=max(max_height,height)
 scale=max(offset,max_height)
 for index,u,v in raw:layer.data[index].uv=(u/scale,v/scale)
 layer.active_render=True;mesh.update()

