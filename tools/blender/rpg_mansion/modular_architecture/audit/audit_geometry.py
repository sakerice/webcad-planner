"""Read-only independent geometry audit, run with Blender 4.3+.
This never saves production .blend files, mutates mesh data, or imports build.py.
All written files are beneath this audit/ directory.
"""
import bpy, sys, json, math, struct, hashlib, itertools, collections, time, re
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import closest_point_on_tri
import numpy as np

HERE=Path(__file__).resolve().parent
HOME=HERE.parent
ROOT=HOME.parents[3]
EPS=2e-6 # 0.002 mm plane/weld tolerance; float32 error is smaller at these scales.
PROBE=5e-5 # 0.05 mm exterior classification offset, smaller than all designed features.
AREA_EPS=1e-10
REFERENCE={}
REPORT={'auditVersion':3,'method':{},'assets':[],'assemblies':[],'findings':[]}
REPORT['method']={
 'readOnly':True,'writesRestrictedTo':'audit/',
 'geometry':'Actual native authoring meshes, active canonical source meshes, and decoded GLB POSITION/NORMAL/index accessors with accumulated node transforms.',
 'topology':'Native part partitions determine GLB solid identity; actual GLB triangles must bijectively match native triangles before this partition is accepted. Each welded solid is then independently checked for two oppositely directed uses of every edge, finite coordinates, nondegenerate triangles, nonadjacent triangle self-intersections, and independently positive signed volume for every closed component.',
 'normalCheck':'Actual per-corner native/source normals and decoded GLB normals compared to geometric triangle normals. Flat faces must align; smoothed column corners must lie in the outward hemisphere.',
 'contacts':'Independent BVH surface intersections, actual coplanar triangle overlap, and containment establish native contact graph. Contact and local bearing areas are geometric; this is not structural engineering certification.',
 'duplicateSurfaces':'All cross-part coplanar triangle intersections are clipped in their dominant 2D projection. Opposite normals identify internal contact. Same-direction overlaps are probed on their outward side against all closed parts; visible duplicates and buried overlaps are separately reported. Probe sampling is dense within each overlap polygon, not an exact polyhedral-union proof.',
 'toleranceMetres':EPS,'outwardProbeMetres':PROBE,'minimumOverlapAreaM2':AREA_EPS,'minimumOverlapAreaToPerimeterRatioM':EPS,
 'opening':'Actual ray intersections with all GLB triangles at many portal heights and depths; continuous clearance is further checked by triangle/AABB overlap against the inset clearance prism.',
 'limits':['No physics/collision or structural load certification.','Exposure classification is geometric sampling with explicit tolerance; extremely thin regions below tolerance can evade classification.']}


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def vec(v):return [float(x) for x in v]
def key(v):return tuple(round(float(x)/EPS) for x in v)
def triangle_key(t):
 ids=[key(v) for v in t];return min(tuple(ids[i:]+ids[:i]) for i in range(3))
def native_data(ob):
 m=ob.data;m.calc_loop_triangles();M=ob.matrix_world.copy();N=M.to_3x3().inverted().transposed()
 verts=[M@v.co for v in m.vertices]
 cn=m.corner_normals
 tris=[];normals=[];smooth=[]
 for t in m.loop_triangles:
  tris.append([verts[i].copy() for i in t.vertices]);normals.append([(N@cn[i].vector) for i in t.loops]);smooth.append(m.polygons[t.polygon_index].use_smooth)
 return Solid(ob.name,tris,normals,smooth)

class Solid:
 def __init__(self,name,triangles,normals=None,smooth=None):
  self.name=name;self.tris=triangles;self.normals=normals;self.smooth=smooth;self.children=None
  self.array=np.array([[vec(v) for v in t] for t in triangles],dtype=float)
  self.lo=self.array.min(axis=(0,1));self.hi=self.array.max(axis=(0,1))
  self.gnorm=[];self.areas=[]
  for a,b,c in triangles:
   cross=(b-a).cross(c-a);self.areas.append(cross.length/2);self.gnorm.append(cross.normalized())
  self.bvh=BVHTree.FromPolygons([v for t in triangles for v in t],[(3*i,3*i+1,3*i+2) for i in range(len(triangles))],all_triangles=True,epsilon=EPS)
 def inside(self,p):
  if self.children is not None:return any(c.inside(p) for c in self.children)
  if any(p[i]<=self.lo[i]+EPS*.1 or p[i]>=self.hi[i]-EPS*.1 for i in range(3)):return False
  # A closest boundary normal determines membership of an oriented closed polyhedron
  # away from ambiguous edges. Three ray parities adjudicate edge proximity.
  hit,n,idx,d=self.bvh.find_nearest(p)
  if hit is None or d<EPS*.1:return False
  if abs((p-hit).dot(n))>EPS*.2:return (p-hit).dot(n)<0
  votes=[]
  for raw in [(1,.371,.129),(.217,1,.423),(.391,.213,1)]:
   dr=Vector(raw).normalized();origin=p.copy();count=0
   for unused in range(200):
    q,n,idx,dist=self.bvh.ray_cast(origin,dr,100)
    if q is None:break
    count+=1;origin=q+dr*EPS*2
   votes.append(count%2)
  return sum(votes)>=2
 def topology(self):
  vertices={};edges=collections.defaultdict(list);edgefaces=collections.defaultdict(list);trivolumes=[];degenerate=0;finite=bool(np.isfinite(self.array).all());vol=0.
  origin=Vector(((self.lo+self.hi)/2).tolist())
  for ti,t in enumerate(self.tris):
   ids=[]
   for v in t:
    k=key(v)
    if k not in vertices:vertices[k]=len(vertices)
    ids.append(vertices[k])
   if self.areas[ti]<1e-12:degenerate+=1
   for a,b in zip(ids,ids[1:]+ids[:1]):
    edge=tuple(sorted((a,b)));edges[edge].append(1 if a<b else -1);edgefaces[edge].append(ti)
   a,b,c=[v-origin for v in t];tv=a.dot(b.cross(c))/6;vol+=tv;trivolumes.append(tv)
  boundary=sum(len(x)==1 for x in edges.values());nonman=sum(len(x)>2 for x in edges.values());badwinding=sum(len(x)==2 and sum(x)!=0 for x in edges.values())
  adjacent=[set() for t in self.tris]
  for fs in edgefaces.values():
   for a in fs:adjacent[a].update(fs)
  unseen=set(range(len(self.tris)));components=[]
  while unseen:
   seed=unseen.pop();queue=[seed];group={seed}
   while queue:
    for neighbor in adjacent[queue.pop()]:
     if neighbor in unseen:unseen.remove(neighbor);group.add(neighbor);queue.append(neighbor)
   components.append(dict(triangles=len(group),signedVolumeM3=sum(trivolumes[i] for i in group)))
  ndots=[];flatbad=0;normalbad=0;normalunitbad=0
  if self.normals:
   for ti,ns in enumerate(self.normals):
    for n in ns:
     dot=n.dot(self.gnorm[ti]);ndots.append(dot)
     if not all(math.isfinite(x) for x in n) or dot<=0:normalbad+=1
     if abs(n.length-1)>1e-4:normalunitbad+=1
     if self.smooth is not None and not self.smooth[ti] and dot<.9999:flatbad+=1
  self_intersections=[]
  for i,j in self.bvh.overlap(self.bvh):
   if i>=j:continue
   a=self.tris[i];b=self.tris[j]
   if set(key(v) for v in a)&set(key(v) for v in b):continue
   na=self.gnorm[i];nb=self.gnorm[j]
   if abs(abs(na.dot(nb))-1)<1e-6:
    overlap=coplanar_overlap(a,na,b,nb)
    intersect=overlap is not None
   else:
    aa=self.array[i];bb=self.array[j];ea=[aa[(k+1)%3]-aa[k] for k in range(3)];eb=[bb[(k+1)%3]-bb[k] for k in range(3)];axes=[np.array(vec(na)),np.array(vec(nb))]+[np.cross(x,y) for x in ea for y in eb];intersect=True
    for axis in axes:
     length=np.linalg.norm(axis)
     if length<1e-12:continue
     pa=aa@axis;pb=bb@axis
     if pa.max()<pb.min()-EPS*length or pb.max()<pa.min()-EPS*length:intersect=False;break
   if intersect:self_intersections.append([i,j])
  return dict(name=self.name,selfIntersectionsBetweenNonAdjacentTriangles=self_intersections,triangles=len(self.tris),weldedVertices=len(vertices),signedVolumeM3=vol,connectedClosedComponents=components,boundaryEdges=boundary,nonmanifoldEdges=nonman,inconsistentEdges=badwinding,degenerateTriangles=degenerate,finite=finite,minimumCornerNormalDot=min(ndots) if ndots else None,minimumStoredCornerNormalLength=min(n.length for ns in self.normals for n in ns) if self.normals else None,maximumStoredCornerNormalLength=max(n.length for ns in self.normals for n in ns) if self.normals else None,inwardOrInvalidCornerNormals=normalbad,nonUnitCornerNormals=normalunitbad,misalignedFlatCornerNormals=flatbad,closedPositivePass=finite and not(boundary or nonman or badwinding or degenerate or self_intersections) and all(c['signedVolumeM3']>1e-12 for c in components),cornerNormalsPass=not(normalbad or flatbad or normalunitbad))


def plane_key(n,p):
 if next((x for x in n if abs(x)>1e-6),1)<0:n=-n
 return tuple(0.0 if abs(x)<.000005 else round(float(x),5) for x in n)+(round(float(n.dot(p))/EPS),)
def cross2(a,b):return a[0]*b[1]-a[1]*b[0]
def clip_tri(a,b):
 # Sutherland-Hodgman clipping of convex triangles.
 orient=1 if cross2(b[1]-b[0],b[2]-b[0])>=0 else -1
 out=list(a)
 for i in range(3):
  p=b[i];q=b[(i+1)%3];old=out;out=[]
  if not old:break
  for j,e in enumerate(old):
   s=old[j-1];ds=orient*cross2(q-p,s-p);de=orient*cross2(q-p,e-p)
   if de>=-1e-12:
    if ds< -1e-12:out.append(s+(e-s)*ds/(ds-de))
    out.append(e)
   elif ds>=-1e-12:out.append(s+(e-s)*ds/(ds-de))
 return out

def coplanar_overlap(a,na,b,nb):
 if abs(abs(na.dot(nb))-1)>1e-6 or max(abs(na.dot(v-a[0])) for v in b)>EPS:return None
 drop=max(range(3),key=lambda i:abs(na[i]));axes=[i for i in range(3) if i!=drop]
 aa=[np.array([v[i] for i in axes]) for v in a];bb=[np.array([v[i] for i in axes]) for v in b]
 poly=clip_tri(aa,bb)
 if len(poly)<3:return None
 area=abs(sum(cross2(poly[i],poly[(i+1)%len(poly)]) for i in range(len(poly))))/2/abs(na[drop])
 if area<AREA_EPS:return None
 restored=[]
 for p in poly:
  x=Vector((0,0,0));x[axes[0]]=p[0];x[axes[1]]=p[1];x[drop]=(na.dot(a[0])-sum(na[i]*x[i] for i in axes))/na[drop];restored.append(x)
 perimeter=sum((restored[i]-restored[(i+1)%len(restored)]).length for i in range(len(restored)))
 if area/max(perimeter,1e-20)<EPS:return None # Float32 seam slivers are within positional tolerance.
 return area,restored

def contact_and_duplicates(parts,scan_exposure=True):
 contacts=[];dups=[];coplanar=[];adj=[set() for p in parts]
 for ia,a in enumerate(parts):
  for ib in range(ia+1,len(parts)):
   b=parts[ib]
   if np.any(a.hi<b.lo-EPS) or np.any(b.hi<a.lo-EPS):continue
   pairs=a.bvh.overlap(b.bvh);areas={'opposedInternalContact':0.,'buriedSameFacingOverlap':0.,'exposedSameFacingOverlap':0.}
   sample_examples=[];planes={}
   # Plane matching is required in addition to BVH overlap: coplanar surfaces
   # can be omitted by a strict triangle-intersection kernel.
   # Do not hash plane constants: short sloped edges can perturb normals enough
   # to straddle a plane hash bin even when the actual surfaces touch.
   amin=a.array.min(axis=1);amax=a.array.max(axis=1);bmin=b.array.min(axis=1);bmax=b.array.max(axis=1)
   bounds_match=np.all(amax[:,None,:]>=bmin[None,:,:]-EPS,axis=2)&np.all(bmax[None,:,:]>=amin[:,None,:]-EPS,axis=2)
   an=np.array([vec(n) for n in a.gnorm]);bn=np.array([vec(n) for n in b.gnorm]);parallel=np.abs(an@bn.T)>1-1e-6
   ii,jj=np.where(bounds_match&parallel);copairs=set(pairs);copairs.update(zip(ii.tolist(),jj.tolist()))
   for i,j in sorted(copairs):
    overlap=coplanar_overlap(a.tris[i],a.gnorm[i],b.tris[j],b.gnorm[j])
    if overlap is None:continue
    area,poly=overlap
    if a.gnorm[i].dot(b.gnorm[j])<0:tag='opposedInternalContact'
    elif scan_exposure:
     c=sum(poly,Vector())/len(poly);probes=[c]+[c*.02+p*.98 for p in poly]+[(c+poly[k]+poly[(k+1)%len(poly)])/3 for k in range(len(poly))]
     exposed=[p for p in probes if not any(o.inside(p+a.gnorm[i]*PROBE) for o in parts)]
     tag='exposedSameFacingOverlap' if exposed else 'buriedSameFacingOverlap'
     if exposed and len(sample_examples)<6:sample_examples.append(dict(pointM=vec(exposed[0]),normal=vec(a.gnorm[i]),triangleA=i,triangleB=j,overlapAreaM2=area))
    else:tag='buriedSameFacingOverlap'
    areas[tag]+=area
    pk=str(plane_key(a.gnorm[i],a.tris[i][0]))
    if pk not in planes:planes[pk]=dict(normal=vec(a.gnorm[i]),pointM=vec(poly[0]),opposedContactAreaM2=0.,buriedDuplicateAreaM2=0.,exposedDuplicateAreaM2=0.,lo=[float('inf')]*3,hi=[-float('inf')]*3)
    pr=planes[pk];pr[{'opposedInternalContact':'opposedContactAreaM2','buriedSameFacingOverlap':'buriedDuplicateAreaM2','exposedSameFacingOverlap':'exposedDuplicateAreaM2'}[tag]]+=area
    for q in poly:
     for axis in range(3):pr['lo'][axis]=min(pr['lo'][axis],float(q[axis]));pr['hi'][axis]=max(pr['hi'][axis],float(q[axis]))
   contained=any(b.inside(sum(t,Vector())/3) for t in a.tris[:20]) or any(a.inside(sum(t,Vector())/3) for t in b.tris[:20])
   touching=bool(pairs) or sum(areas.values())>AREA_EPS or contained
   if touching:
    adj[ia].add(ib);adj[ib].add(ia)
    contacts.append(dict(a=a.name,b=b.name,intersectingTrianglePairs=len(pairs),containedSurfaceSample=contained,coplanarAreaM2=areas,measuredContactPlanes=list(planes.values())))
   if areas['exposedSameFacingOverlap']>AREA_EPS:dups.append(dict(a=a.name,b=b.name,areaM2=areas['exposedSameFacingOverlap'],examples=sample_examples,measuredPlanes=list(planes.values())))
   if sum(areas.values())>AREA_EPS:coplanar.append(dict(a=a.name,b=b.name,areaM2=areas))
 unseen=set(range(len(parts)));groups=[]
 while unseen:
  root=unseen.pop();group={root};queue=[root]
  while queue:
   for nb in adj[queue.pop()]:
    if nb in unseen:unseen.remove(nb);group.add(nb);queue.append(nb)
  groups.append([parts[i].name for i in sorted(group)])
 return dict(contacts=contacts,connectedGroups=groups,allPartsConnected=len(groups)==1,coplanarPairs=coplanar,exposedDuplicatePairs=dups)


def read_glb(path):
 raw=path.read_bytes();assert raw[:4]==b'glTF';length,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+length]);at=20+length;blob=None
 while at<len(raw):
  n,k=struct.unpack_from('<II',raw,at)
  if k==0x004e4942:blob=raw[at+8:at+8+n]
  at+=8+n
 assert blob is not None
 types={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)};sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
 def access(i):
  ac=doc['accessors'][i];bv=doc['bufferViews'][ac['bufferView']];fmt,width=types[ac['componentType']];n=sizes[ac['type']];offset=bv.get('byteOffset',0)+ac.get('byteOffset',0);stride=bv.get('byteStride',n*width)
  assert not ac.get('sparse'),'Sparse accessors need explicit handling'
  return [struct.unpack_from('<'+fmt*n,blob,offset+j*stride) for j in range(ac['count'])]
 C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
 triangles=[];normals=[]
 def walk(index,parent):
  node=doc['nodes'][index]
  if 'matrix' in node:local=Matrix([node['matrix'][i:i+4] for i in range(0,16,4)]).transposed()
  else:
   from mathutils import Quaternion
   t=Matrix.Translation(node.get('translation',[0,0,0]));q=node.get('rotation',[0,0,0,1]);r=Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4();s=Matrix.Diagonal(node.get('scale',[1,1,1])+[1]);local=t@r@s
  M=parent@local
  if 'mesh'in node:
   for prim in doc['meshes'][node['mesh']]['primitives']:
    assert prim.get('mode',4)==4;pos=access(prim['attributes']['POSITION']);nor=access(prim['attributes']['NORMAL']);ix=[x[0] for x in access(prim['indices'])] if 'indices'in prim else list(range(len(pos)));N=(C@M).to_3x3().inverted().transposed()
    for k in range(0,len(ix),3):
     ids=ix[k:k+3];triangles.append([(C@M)@Vector(pos[j]) for j in ids]);normals.append([(N@Vector(nor[j])) for j in ids])
  for child in node.get('children',[]):walk(child,M)
 for node in doc['scenes'][doc.get('scene',0)]['nodes']:walk(node,Matrix.Identity(4))
 return triangles,normals

def match_partition(native,triangles,normals):
 buckets=collections.defaultdict(list)
 for i,p in enumerate(native):
  for j,t in enumerate(p.tris):buckets[triangle_key(t)].append((i,j))
 result=[[] for p in native];ns=[[] for p in native];sm=[[] for p in native];unmatched=[]
 for k,t in enumerate(triangles):
  key_=triangle_key(t)
  if not buckets[key_]:unmatched.append(k);continue
  i,j=buckets[key_].pop();result[i].append(t);ns[i].append(normals[k]);sm[i].append(native[i].smooth[j])
 missing=sum(len(x) for x in buckets.values())
 parts=[Solid(p.name,result[i],ns[i],sm[i]) for i,p in enumerate(native) if result[i]]
 return parts,dict(actualTriangles=len(triangles),referenceTriangles=sum(len(p.tris) for p in native),unmatchedActualTriangles=len(unmatched),missingReferenceTriangles=missing,geometricTriangleMultisetMatchWithinTolerance=not unmatched and not missing)


def ray_hits(parts,origin,direction,maxdistance=100):
 # Exact double-precision ray/actual-triangle tests. BVH epsilon broadening must
 # not be used to measure opening dimensions near triangle edges.
 o=np.array(vec(Vector(origin)));d=np.array(vec(Vector(direction).normalized()));hits=[]
 for part in parts:
  v=part.array;e1=v[:,1]-v[:,0];e2=v[:,2]-v[:,0];p=np.cross(np.broadcast_to(d,e2.shape),e2);det=np.einsum('ij,ij->i',e1,p);valid=np.abs(det)>1e-12;inv=np.zeros_like(det);inv[valid]=1/det[valid];tv=o-v[:,0];u=np.einsum('ij,ij->i',tv,p)*inv;q=np.cross(tv,e1);w=q@d*inv;t=np.einsum('ij,ij->i',e2,q)*inv
  good=valid&(u>=-1e-10)&(w>=-1e-10)&(u+w<=1+1e-10)&(t>=-1e-10)&(t<=maxdistance)
  for distance in t[good]:hits.append((float(distance),(o+d*distance).tolist(),part.name))
 return sorted(hits)

def clearance(parts,translation=(0,0,0),front=-.164,back=.125):
 off=Vector(translation);rows=[];obstructions=[]
 # Whole-depth and full-height rays demonstrate clear volume, rather than a
 # silhouette at a single front plane.
 for y in np.linspace(front+EPS*4,back-EPS*4,11):
  for z in np.linspace(EPS*4,2.4-EPS*4,33):
   left=ray_hits(parts,off+Vector((0,y,z)),(-1,0,0),3);right=ray_hits(parts,off+Vector((0,y,z)),(1,0,0),3)
   if left and right:rows.append(dict(yM=float(y),zM=float(z),widthMm=(left[0][0]+right[0][0])*1000,leftX=left[0][1][0]-off.x,rightX=right[0][1][0]-off.x))
 for x in np.linspace(-.6+EPS*4,.6-EPS*4,33):
  for z in np.linspace(EPS*4,2.4-EPS*4,33):
   hits=ray_hits(parts,off+Vector((x,front-.01,z)),(0,1,0),back-front+.02)
   if hits:obstructions.append(dict(x=float(x),z=float(z),first=hits[0]))
 heights=[]
 for y in np.linspace(front+EPS*4,back-EPS*4,11):
  for x in np.linspace(-.6+EPS*4,.6-EPS*4,33):
   hit=ray_hits(parts,off+Vector((x,y,0)),(0,0,1),4)
   if hit:heights.append(hit[0][0]*1000)
 # Independent continuous check: every triangle vs open-clearance axis aligned
 # box using separating axes (box axes, triangle normal, all edge x axes).
 lo=np.array(vec(off+Vector((-.6+EPS*4,front,EPS*4))));hi=np.array(vec(off+Vector((.6-EPS*4,back,2.4-EPS*4))));intrusions=[]
 for part in parts:
  for i,t in enumerate(part.array):
   if triangle_box(t,lo,hi):intrusions.append(dict(part=part.name,triangle=i))
 return dict(minimumMeasuredWidthMm=min(r['widthMm'] for r in rows) if rows else None,minimumMeasuredHeightMm=min(heights) if heights else None,widthSampleCount=len(rows),heightSampleCount=len(heights),throughOpeningRayCount=33*33,blockedThroughRays=obstructions,continuousClearancePrismTriangleIntrusions=intrusions,clearancePass=not obstructions and not intrusions and abs(min(r['widthMm'] for r in rows)-1200)<.02 and abs(min(heights)-2400)<.02)

def triangle_box(t,lo,hi):
 c=(hi+lo)/2;h=(hi-lo)/2;v=t-c;edges=[v[1]-v[0],v[2]-v[1],v[0]-v[2]];basis=np.eye(3);axes=list(basis)+[np.cross(edges[0],edges[1])]+[np.cross(e,b) for e in edges for b in basis]
 for axis in axes:
  if np.linalg.norm(axis)<1e-12:continue
  p=v@axis;r=np.abs(axis)@h
  if p.min()>r+1e-10 or p.max()<-r-1e-10:return False
 return True


def audit_asset(item):
 paths={k:ROOT/item[k] for k in ('authoringBlend','sourceBlend','model')};hashes={k:sha(p) for k,p in paths.items()}
 bpy.ops.wm.open_mainfile(filepath=str(paths['authoringBlend']),load_ui=False)
 native=[native_data(o) for o in bpy.context.scene.objects if o.type=='MESH'];native.sort(key=lambda p:p.name)
 native_top=[p.topology() for p in native];contacts=contact_and_duplicates(native)
 bpy.ops.wm.open_mainfile(filepath=str(paths['sourceBlend']),load_ui=False)
 source_obs=[native_data(o) for o in bpy.context.scene.objects if o.type=='MESH'];st=[t for p in source_obs for t in p.tris];sn=[n for p in source_obs for n in p.normals];source,source_match=match_partition(native,st,sn)
 gt,gn=read_glb(paths['model']);glb,glb_match=match_partition(native,gt,gn);REFERENCE[hashes['model']]=glb
 row=dict(id=item['id'],inputPaths={k:str(p.relative_to(ROOT)) for k,p in paths.items()},inputSha256=hashes,dimensionsMm=((np.concatenate([p.array for p in glb]).max(axis=(0,1))-np.concatenate([p.array for p in glb]).min(axis=(0,1)))*1000).tolist(),nativeParts=native_top,canonicalSource=dict(match=source_match,parts=[p.topology() for p in source]),glb=dict(match=glb_match,parts=[p.topology() for p in glb]),nativeContacts=contacts)
 off=item['moduleContract']['constructionToAssetTranslationM']
 if 'doorway' in item['id']:row['opening']=clearance(glb,off)
 if 'slate-gable-span' in item['id']:
  deck=next(p for p in glb if 'weather deck'in p.name);bearing=[p for p in glb if 'bearing seat'in p.name]
  row['roofMeasurements']=dict(deckMinimumThicknessVerticalMm=min((p[2]-q[2])*1000 for t in deck.tris for p in t for u in deck.tris for q in u if abs(p.x-q.x)<EPS and abs(p.y-q.y)<EPS and p.z-q.z>EPS),bearingSeats=[dict(name=p.name,bottomMm=float((p.lo[2]-off[2])*1000),widthMm=float((p.hi[0]-p.lo[0])*1000),xCentreMm=float(((p.lo[0]+p.hi[0])/2-off[0])*1000)) for p in bearing],measuredEaveXmm=[float((deck.lo[0]-off[0])*1000),float((deck.hi[0]-off[0])*1000)],atticCavityContainsMaterial=any(p.inside(Vector(off)+Vector((0,0,.6))) for p in glb))
 if 'slate-gable-span' in item['id']:
  tiles={p.name:p for p in glb if 'slate' in p.name.lower()};courses=collections.defaultdict(list)
  for name,p in tiles.items():
   m=re.search(r'slope (-?1) course (\d+)',name)
   if m:courses[(int(m.group(1)),int(m.group(2)))].append(p)
  laprows=[]
  for c in contacts['contacts']:
   if c['a'] not in tiles or c['b'] not in tiles:continue
   ma=re.search(r'slope (-?1) course (\d+)',c['a']);mb=re.search(r'slope (-?1) course (\d+)',c['b'])
   if not ma or not mb or ma.group(1)!=mb.group(1) or abs(int(ma.group(2))-int(mb.group(2)))!=1:continue
   pa=tiles[c['a']];pb=tiles[c['b']];laprows.append(dict(a=c['a'],b=c['b'],xOverlapMm=float((min(pa.hi[0],pb.hi[0])-max(pa.lo[0],pb.lo[0]))*1000),actualOpposedContactAreaMm2=c['coplanarAreaM2']['opposedInternalContact']*1e6))
  row['roofSlateMeasurements']=dict(slateCount=len(tiles),courses=[dict(side=side,course=course,tileCount=len(ps),tileYBoundsMm=[[float((p.lo[1]-off[1])*1000),float((p.hi[1]-off[1])*1000)] for p in sorted(ps,key=lambda x:x.lo[1])]) for (side,course),ps in sorted(courses.items())],measuredAdjacentCourseLaps=laprows,allMeasuredLapsHavePositiveArea=bool(laprows) and all(x['actualOpposedContactAreaMm2']>0 for x in laprows),minimumMeasuredLapMm=min(x['xOverlapMm'] for x in laprows) if laprows else None,maximumMeasuredLapMm=max(x['xOverlapMm'] for x in laprows) if laprows else None)
 row['inputFilesUnchanged']=all(sha(p)==hashes[k] for k,p in paths.items())
 REPORT['assets'].append(row)
 for field,parts in [('native',native_top),('source',row['canonicalSource']['parts']),('glb',row['glb']['parts'])]:
  for p in parts:
   if not(p['closedPositivePass'] and p['cornerNormalsPass']):REPORT['findings'].append(dict(asset=item['id'],severity='fail',test=field+' topology/normals',detail=p))
 if not(source_match['geometricTriangleMultisetMatchWithinTolerance'] and glb_match['geometricTriangleMultisetMatchWithinTolerance']):REPORT['findings'].append(dict(asset=item['id'],severity='fail',test='source/GLB match',detail=[source_match,glb_match]))
 if not contacts['allPartsConnected']:REPORT['findings'].append(dict(asset=item['id'],severity='fail',test='native disconnected contact groups',detail=contacts['connectedGroups']))
 if contacts['exposedDuplicatePairs']:REPORT['findings'].append(dict(asset=item['id'],severity='fail',test='exposed coplanar duplicates',detail=contacts['exposedDuplicatePairs']))
 if 'opening' in row and not row['opening']['clearancePass']:REPORT['findings'].append(dict(asset=item['id'],severity='fail',test='opening clearance',detail=row['opening']))
 print('AUDITED',item['id'],'native parts',len(native),'duplicates',len(contacts['exposedDuplicatePairs']),'normals',all(p['cornerNormalsPass'] for p in native_top),flush=True)
 (HERE/'geometry-audit.json').write_text(json.dumps(REPORT,indent=2)+'\n')


def audit_assembly(path):
 before=sha(path);bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
 parts=[]
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  actual=native_data(o);ref=REFERENCE.get(o.get('sourceModelSha256'))
  if ref:
   children=[Solid(c.name,[[o.matrix_world@v for v in t] for t in c.tris],smooth=c.smooth) for c in ref]
   reference_keys=collections.Counter(triangle_key(t) for c in children for t in c.tris)
   actual_keys=collections.Counter(triangle_key(t) for t in actual.tris)
   assert reference_keys==actual_keys,(o.name,'assembly native partition mismatch')
   actual.children,partition=match_partition(children,actual.tris,actual.normals)
   assert partition['geometricTriangleMultisetMatchWithinTolerance'],(o.name,'assembly directed mesh mismatch')
  parts.append(actual)
 parts.sort(key=lambda p:p.name)
 contact=contact_and_duplicates(parts)
 matrices=[]
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  mat=o.matrix_world;scale=mat.to_scale();angle=mat.to_euler('XYZ');matrices.append(dict(name=o.name,scale=vec(scale),xAngleDegrees=math.degrees(angle.x),yAngleDegrees=math.degrees(angle.y),zAngleDegrees=math.degrees(angle.z),allowedRotationPass=abs(angle.x)<1e-5 and abs(angle.y)<1e-5 and abs(math.degrees(angle.z)/90-round(math.degrees(angle.z)/90))<1e-5,determinant=mat.to_3x3().determinant(),rigidScalePass=max(abs(s-1) for s in scale)<1e-5 and abs(mat.to_3x3().determinant()-1)<1e-5,fixture=bool(o.get('qaFixtureOnly'))))
 checks=[dict(object=p.name,parts=[c.topology() for c in (p.children if p.children is not None else [p])]) for p in parts]
 row=dict(name=path.stem,actualObjectGeometryChecks=checks,source=str(path.relative_to(ROOT)),sourceSha256=before,actualWorldBoundsM=[np.concatenate([p.array for p in parts]).min(axis=(0,1)).tolist(),np.concatenate([p.array for p in parts]).max(axis=(0,1)).tolist()],transforms=matrices,contacts=contact,inputFileUnchanged=sha(path)==before)
 if path.stem=='wall-door-corner':row['opening']=clearance(parts,(2.1,0,0))
 if path.stem=='hollow-roof-gable':
  row['roofSupportSamples']=[]
  roofparts=[p for p in parts if 'roof'in p.name.lower() or p.name=='slate-gable-span']
  wallparts=[p for p in parts if abs(p.hi[2]-3)<EPS and abs(p.lo[2])<EPS]
  for x in [-1.8,1.8]:
   for y in [.1,.6,1.2,1.8,2.1]:
    hit=ray_hits(roofparts,(x,y,2.99),(0,0,1),1);wall=ray_hits(wallparts,(x,y,3.01),(0,0,-1),.1)
    row['roofSupportSamples'].append(dict(x=x,y=y,roofBottomMm=hit[0][1][2]*1000 if hit else None,wallTopMm=wall[0][1][2]*1000 if wall else None,gapMm=(hit[0][1][2]-wall[0][1][2])*1000 if hit and wall else None))
  row['cavityCentreMaterial']=any(p.inside(Vector((0,1.2,3.6))) for p in parts)
  cavity=[];failed=[]
  for x in np.linspace(-1.5,1.5,13):
   for y in [.3,.6,1.2,1.8,2.1]:
    upper=ray_hits(roofparts,(float(x),y,3.01),(0,0,1),3)
    if not upper:failed.append(dict(x=float(x),y=y,error='missing roof boundary'));continue
    ceiling=upper[0][1][2]
    for z in np.linspace(3.02,ceiling-.02,10):
     point=Vector((float(x),y,float(z)));occupied=any(p.inside(point) for p in parts);cavity.append(occupied)
     if occupied:failed.append(vec(point))
  row['hollowCavitySampling']=dict(samples=len(cavity),occupiedSamples=sum(cavity),failures=failed)
  rooflo=min(p.lo[0] for p in roofparts);roofhi=max(p.hi[0] for p in roofparts);walllo=min(p.lo[0] for p in wallparts);wallhi=max(p.hi[0] for p in wallparts)
  row['measuredEavesMm']=dict(west=(walllo-rooflo)*1000,east=(roofhi-wallhi)*1000,roofWidth=(roofhi-rooflo)*1000,wallExteriorSpan=(wallhi-walllo)*1000)
 if path.stem=='cornice-column':
  row['columnSupportSamples']=[]
  for col in [p for p in parts if 'column'in p.name.lower()]:
   x,y=(col.lo[:2]+col.hi[:2])/2;upper=ray_hits([p for p in parts if 'cornice'in p.name.lower()],(float(x),float(y),3-EPS*4),(0,0,1),.5)
   row['columnSupportSamples'].append(dict(column=col.name,groundMm=float(col.lo[2]*1000),capitalTopMm=float(col.hi[2]*1000),corniceUndersideMm=upper[0][1][2]*1000 if upper else None,verticalGapMm=(upper[0][1][2]-col.hi[2])*1000 if upper else None))
 for obj in checks:
  for checked in obj['parts']:
   if not(checked['closedPositivePass'] and checked['cornerNormalsPass']):REPORT['findings'].append(dict(assembly=path.stem,severity='fail',test='actual assembly object topology/normals',detail=dict(object=obj['object'],part=checked)))
 if contact['exposedDuplicatePairs']:REPORT['findings'].append(dict(assembly=path.stem,severity='fail',test='exposed cross-module coplanar duplicates',detail=contact['exposedDuplicatePairs']))
 if 'opening'in row and not row['opening']['clearancePass']:REPORT['findings'].append(dict(assembly=path.stem,severity='fail',test='assembly opening',detail=row['opening']))
 REPORT['assemblies'].append(row)
 print('AUDITED_ASSEMBLY',path.stem,'duplicates',len(contact['exposedDuplicatePairs']),flush=True)


def main():
 start=time.time();items=json.loads((HOME/'descriptors.json').read_text())['items'];only=sys.argv[sys.argv.index('--only')+1] if '--only'in sys.argv else None
 for item in items:
  if not only or only in item['id']:audit_asset(item)
 if '--assets-only' not in sys.argv:
  for p in sorted((HOME/'assemblies').glob('*.blend')):audit_assembly(p)
 REPORT['elapsedSeconds']=time.time()-start
 REPORT['summary']=dict(acceptance='Production evidence only; independent acceptance remains separate.',assetCount=len(REPORT['assets']),assemblyCount=len(REPORT['assemblies']),allInputFilesUnchanged=all(a['inputFilesUnchanged'] for a in REPORT['assets']) and all(a['inputFileUnchanged'] for a in REPORT['assemblies']),hardFailureCount=sum(f['severity']=='fail' for f in REPORT['findings']),exposedDuplicateAssetCount=sum(bool(a['nativeContacts']['exposedDuplicatePairs']) for a in REPORT['assets']))
 (HERE/'geometry-audit.json').write_text(json.dumps(REPORT,indent=2)+'\n');print('FINAL_SUMMARY',json.dumps(REPORT['summary']),flush=True)
if __name__=='__main__':main()
