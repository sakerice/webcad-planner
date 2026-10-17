"""Deterministic in-memory regression checks of the read-only geometry auditor."""
import sys,json
sys.dont_write_bytecode=True
from pathlib import Path
from mathutils import Vector
H=Path(__file__).resolve().parent
sys.path.insert(0,str(H))
from audit_geometry import Solid,contact_and_duplicates,ray_hits,triangle_box
import numpy as np

def cube(name,lo=(0,0,0),hi=(1,1,1)):
 v=[Vector((x,y,z)) for z in [lo[2],hi[2]] for y in [lo[1],hi[1]] for x in [lo[0],hi[0]]]
 faces=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
 t=[]
 for a,b,c,d in faces:t.extend([[v[a],v[b],v[c]],[v[a],v[c],v[d]]])
 return Solid(name,t)

results=[]
def check(name,condition,details=None):
 results.append(dict(test=name,pass_=bool(condition),details=details))
 assert condition,(name,details)

a=cube('a');b=cube('b',(1,0,0),(2,1,1));c=cube('exact duplicate')
r=a.topology();check('Positive closed unit cube',r['closedPositivePass'] and abs(r['signedVolumeM3']-1)<1e-8,r)
r=Solid('reversed',[[t[0],t[2],t[1]] for t in a.tris]).topology();check('Reversed winding is rejected',not r['closedPositivePass'],r)
other=cube('other',(2,0,0),(3,1,1));bneg=Solid('two disjoint solids one reversed',a.tris+[[t[0],t[2],t[1]] for t in other.tris]);r=bneg.topology();check('Mixed component winding is rejected',not r['closedPositivePass'],r)
badnormal=Solid('bad normals',a.tris,[[-n,-n,-n] for n in a.gnorm],[False]*len(a.tris));r=badnormal.topology();check('Stored inward corner normals are rejected',not r['cornerNormalsPass'],r)
crossed=Solid('intersecting shells',a.tris+cube('crossed',(.5,.5,.5),(1.5,1.5,1.5)).tris);r=crossed.topology();check('Nonadjacent self-intersections are rejected',bool(r['selfIntersectionsBetweenNonAdjacentTriangles']) and not r['closedPositivePass'],r)
r=contact_and_duplicates([a,b]);check('Opposite butt faces are internal contacts',r['allPartsConnected'] and not r['exposedDuplicatePairs'] and abs(r['contacts'][0]['coplanarAreaM2']['opposedInternalContact']-1)<1e-8,r)
r=contact_and_duplicates([a,c]);check('Duplicate exposed shell is detected',len(r['exposedDuplicatePairs'])==1 and abs(r['exposedDuplicatePairs'][0]['areaM2']-6)<1e-8,r)
outer=cube('outer',(-1,-1,-1),(2,2,2));r=contact_and_duplicates([a,c,outer]);check('Buried duplicate shell is not exposed',not r['exposedDuplicatePairs'],r)
bnear=cube('float32 seam sliver',(1-1e-7,0,0),(2,1,1));r=contact_and_duplicates([a,bnear]);check('Sub-tolerance seam slivers do not trigger exposed overlap',not r['exposedDuplicatePairs'],r)
far=cube('separated',(1.01,0,0),(2,1,1));r=contact_and_duplicates([a,far]);check('Separated bodies do not make contact',not r['allPartsConnected'],r)
h=ray_hits([a],(.5,.000008,.000008),(1,0,0));check('Near-edge rays have exact dimensions',abs(h[0][0]-.5)<1e-9,h)
lo=np.array([.2,.2,.2]);hi=np.array([.8,.8,.8]);check('Triangle outside clearance prism is rejected',not triangle_box(np.array([[0,0,0],[1,0,0],[1,1,0]],float),lo,hi))
check('Triangle intersecting clearance prism is found',triangle_box(np.array([[0,0,.5],[1,0,.5],[.5,1,.5]],float),lo,hi))
(H/'audit-selftest.json').write_text(json.dumps(dict(allPass=True,tests=results),indent=2)+'\n')
print('SELFTEST_PASS',len(results))
