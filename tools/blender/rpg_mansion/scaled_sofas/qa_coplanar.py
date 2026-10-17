"""Find positive-area co-oriented coplanar surface overlap from decoded GLB triangles.

Coincident coplanar outward faces can z-fight even with valid winding/normals.
Triangle pairs merely sharing edges are allowed. Bottom-plane overlaps are listed
separately; visibility is a normal-direction ray observation, not complete CSG.
"""
import json,sys,collections
from pathlib import Path
import numpy as np
H=Path(__file__).resolve().parent;R=H.parents[3];sys.path.insert(0,str(H.parent));import qa_asset_delivery as qa
import hashlib

def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def signed(p):return sum(cross(p[i],p[(i+1)%len(p)])for i in range(len(p)))/2

def intersection(a,b):
 out=list(a);b=list(b)
 if signed(b)<0:b.reverse()
 for i,cp in enumerate(b):
  nxt=b[(i+1)%3];edge=nxt-cp;old=out;out=[]
  if not old:return out
  prev=old[-1];pd=cross(edge,prev-cp)
  for cur in old:
   cd=cross(edge,cur-cp)
   if (cd>=0)!=(pd>=0):out.append(prev+(cur-prev)*(pd/(pd-cd)))
   if cd>=0:out.append(cur)
   prev=cur;pd=cd
 return out

def blocked(point,direction,triangles):
 orig=point+direction*.00001;v0=triangles[:,0];e1=triangles[:,1]-v0;e2=triangles[:,2]-v0;h=np.cross(np.broadcast_to(direction,e2.shape),e2);a=np.sum(e1*h,axis=1);ok=abs(a)>1e-12;f=np.divide(1,a,out=np.zeros_like(a),where=ok);s=orig-v0;u=f*np.sum(s*h,axis=1);q=np.cross(s,e1);v=f*np.sum(direction*q,axis=1);t=f*np.sum(e2*q,axis=1);return bool(np.any(ok&(u>=0)&(v>=0)&(u+v<=1)&(t>.00001)))

def inspect(path):
 d,b=qa.load_glb(path);rows=qa.scene_geometry(d,b);tri=np.concatenate([r['positions'][r['indices']]for r in rows]);mats=np.concatenate([np.full(len(r['indices']),r['material'])for r in rows]);crosses=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);norms=np.linalg.norm(crosses,axis=1);ns=crosses/np.maximum(norms[:,None],1e-30);planes=np.sum(ns*tri[:,0],axis=1);groups=collections.defaultdict(list)
 for i,(n,plane)in enumerate(zip(ns,planes)):groups[tuple(np.round(n,6))+ (round(float(plane),6),)].append(i)
 count=visible=bottom=0;area=visiblearea=0;examples=[]
 for ids in groups.values():
  if len(ids)<2:continue
  axis=int(np.argmax(abs(ns[ids[0]])));axes=[x for x in range(3)if x!=axis];ts=tri[ids][:,:,axes];lo=ts.min(1);hi=ts.max(1)
  for ii,i in enumerate(ids):
   for jj in np.where(np.all(lo[:ii]<hi[ii],axis=1)&np.all(hi[:ii]>lo[ii],axis=1))[0]:
    j=ids[jj]
    if np.max(abs((tri[j]-tri[i,0])@ns[i]))>1e-6:continue
    poly=intersection(ts[ii],ts[jj]);a=abs(signed(poly))/abs(ns[i,axis])if len(poly)>2 else 0
    if a<1e-8:continue
    count+=1;area+=a;mid=np.mean(poly,axis=0);point=np.zeros(3);point[axes]=mid;point[axis]=(planes[i]-np.dot(ns[i,axes],mid))/ns[i,axis];floor=bool(abs(point[1])<.00002);clear=not blocked(point,ns[i],tri)
    if floor:bottom+=1
    elif clear:visible+=1;visiblearea+=a
    if len(examples)<40 or(clear and not floor):
     examples.append({'triangles':[i,j],'overlap_area_m2':a,'intersection_center_m':point.tolist(),'outward_normal':ns[i].tolist(),'bottom_plane':floor,'normal_ray_unobstructed':clear,'materials':[d['materials'][int(mats[i])]['name'],d['materials'][int(mats[j])]['name']]})
 return {'coplanar_overlap_pairs':count,'total_pairwise_area_m2':area,'bottom_plane_pairs':bottom,'externally_visible_pairs':visible,'externally_visible_pairwise_area_m2':visiblearea,'examples':examples[:120]}


if __name__=='__main__':
 items=json.loads((H/'descriptors.json').read_text())['items'];records=[]
 for it in items:
  r={'id':it['id'],'model_sha256':qa.sha256(R/it['model']),**inspect(R/it['model'])};records.append(r)
  print('SOFA_COPLANAR',it['id'],r['externally_visible_pairs'],r['externally_visible_pairwise_area_m2'],flush=True)
 report={'method':__doc__,'items':records,'errors':sum(r['externally_visible_pairs']>0 for r in records),'bottom_floor_contacts_excluded_from_visibility_gate':True}
 (H/'qa/coplanar.json').write_text(json.dumps(report,indent=2)+'\n')
 raise SystemExit(bool(report['errors']))
