"""Planar native-face metric charts, compact shelf-packed without overlapping rectangles.
All faces in this architecture kit are planar. A common scalar preserves density.
"""
import math
from mathutils import Vector

def metric_atlas(ob,gap=.003):
 mesh=ob.data;mesh.update();layer=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap');charts=[]
 for p in mesh.polygons:
  pts=[ob.matrix_world@mesh.vertices[mesh.loops[k].vertex_index].co for k in p.loop_indices]
  origin=pts[0];edges=[pts[(i+1)%len(pts)]-pts[i]for i in range(len(pts))];u=max(edges,key=lambda e:e.length).normalized();n=p.normal.normalized();v=n.cross(u).normalized()
  xy=[((a-origin).dot(u),(a-origin).dot(v))for a in pts];lo=[min(t[i]for t in xy)for i in range(2)];hi=[max(t[i]for t in xy)for i in range(2)]
  assert max(abs((a-origin).dot(n))for a in pts)<2e-5,(ob.name,p.index,'nonplanar')
  w,h=hi[0]-lo[0],hi[1]-lo[1];assert w>1e-7 and h>1e-7
  charts.append(dict(indices=list(p.loop_indices),xy=[(a-lo[0],b-lo[1])for a,b in xy],w=w,h=h))
 width=max(max(c['w']for c in charts)+2*gap,math.sqrt(sum((c['w']+gap)*(c['h']+gap)for c in charts))*1.3)
 x=y=gap;row_h=0;maximum=0
 for c in sorted(charts,key=lambda a:(-a['h'],-a['w'])):
  if x+c['w']+gap>width:x=gap;y+=row_h+gap;row_h=0
  c['at']=(x,y);x+=c['w']+gap;row_h=max(row_h,c['h']);maximum=max(maximum,x)
 side=max(width,y+row_h+gap)
 for c in charts:
  for index,(a,b)in zip(c['indices'],c['xy']):layer.data[index].uv=((a+c['at'][0])/side,(b+c['at'][1])/side)
 layer.active_render=True;mesh.update();ob['metricAtlasMethod']='Compact non-overlapping rectangular shelf packing of planar metric face charts';ob['metersPerUv']=side
 return ob
