"""Actual-byte sofa validation, packed-UV clipping and source replay checks.

This family-local wrapper reuses the unchanged shared GLB/PNG reader; overlap
is independently tested on actual exported UV triangles using convex clipping.
"""
from pathlib import Path
import sys,json,collections,math,re,hashlib,io,gzip
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path.insert(0,str(HERE.parent))
import qa_asset_delivery as qa
qa.ROOT=ROOT
PRIVATE=re.compile(rb'/(?:workspace|root|home|tmp)(?:/[^\x00\s]*)?(?=[\x00\s]|$)')
def signed(p):return sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1]for i in range(len(p)))/2
def area(p):return abs(signed(p))if len(p)>2 else 0
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def clip(a,b):
 out=[list(p)for p in a];b=list(b)
 if signed(b)<0:b.reverse()
 for i,cp in enumerate(b):
  nxt=b[(i+1)%3];edge=[nxt[0]-cp[0],nxt[1]-cp[1]];old=out;out=[]
  if not old:return 0
  prev=old[-1];pd=cross(edge,[prev[0]-cp[0],prev[1]-cp[1]])
  for cur in old:
   cd=cross(edge,[cur[0]-cp[0],cur[1]-cp[1]])
   if (cd>=0)!=(pd>=0):
    t=pd/(pd-cd);out.append([prev[0]+t*(cur[0]-prev[0]),prev[1]+t*(cur[1]-prev[1])])
   if cd>=0:out.append(cur)
   prev=cur;pd=cd
 return area(out)
def overlap(geometry):
 tri=np.concatenate([r['uv'][r['indices']]for r in geometry]);lo=tri.min(1);hi=tri.max(1);tri=tri.tolist();ar=[area(t)for t in tri];grid=collections.defaultdict(list);count=0;total=0;worst=0;examples=[]
 for i,t in enumerate(tri):
  xmin,ymin=np.floor(lo[i]*24).astype(int);xmax,ymax=np.floor(hi[i]*24).astype(int);candidates=set()
  for x in range(xmin,xmax+1):
   for y in range(ymin,ymax+1):candidates.update(grid[(x,y)])
  for j in candidates:
   if np.any(lo[i]>=hi[j])or np.any(lo[j]>=hi[i]):continue
   a=clip(t,tri[j]);small=min(ar[i],ar[j]);fraction=a/small if small else 0
   if a>1e-9 and fraction>1e-5:
    count+=1;total+=a;worst=max(worst,fraction)
    if len(examples)<10:examples.append(dict(triangles=[j,i],area=a,fraction=fraction))
  for x in range(xmin,xmax+1):
   for y in range(ymin,ymax+1):grid[(x,y)].append(i)
 return dict(significant_overlap_pairs=count,total_overlap_area=total,worst_fraction=worst,examples=examples)
def privacy(path):
 raw=path.read_bytes();encoding='plain';native=raw
 if raw[:4]==bytes.fromhex('28b52ffd'):
  import subprocess
  native=subprocess.run(['zstd','-d','-c','--quiet',str(path)],check=True,stdout=subprocess.PIPE).stdout
  encoding='zstd'
 elif raw[:2]==bytes.fromhex('1f8b'):native=gzip.decompress(raw);encoding='gzip'
 return dict(sha256=qa.sha256(path),bytes=len(raw),encoding=encoding,private_absolute_path_occurrences=len(PRIVATE.findall(native)))
items=json.loads((HERE/'descriptors.json').read_text())['items'];rows=[]
for item in items:
 row=qa.audit_item(item);doc,buf=qa.load_glb(ROOT/item['model']);geo=qa.scene_geometry(doc,buf);ov=overlap(geo);row['packed_uv_overlap']=ov
 if len(doc.get('scenes',[]))!=1:row['errors'].append('GLB contains more than one scene')
 if ov['significant_overlap_pairs']:row['errors'].append('Actual packed UV self overlap')
 if row['bytes']>1000000:row['errors'].append('GLB exceeds 1 MB')
 budget=6000
 if row['triangles']>budget:row['errors'].append('Asset exceeds declared family triangle budget')
 row['triangle_budget']=budget
 row['all_view_margins']={}
 for field in ['thumb','top','front','rear']:
  preview=qa.png_report(ROOT/item[field])
  if preview['mode']!='RGBA' or preview['alpha_min']!=0 or preview['edge_nontransparent_pixels']:row['errors'].append('Evidence transparency/clipping failure')
  if preview['size']!=[512,512] or any(k in preview['chunks']for k in ['tEXt','zTXt','iTXt','eXIf']):row['errors'].append('Image dimensions/metadata failure')
  bbox=preview['pixel_bbox_alpha_gt_0'];margin=min(bbox[0],bbox[1],512-bbox[2],512-bbox[3])if bbox else -1
  row['all_view_margins'][field]=dict(sha256=preview['sha256'],minimum_alpha_margin_pixels=margin)
  if margin<12:row['errors'].append('Less than 12px transparent alpha margin: '+field)
 row['source_privacy']={field:privacy(ROOT/item[field])for field in ['sourceBlend','authoringBlend']}
 if any(v['private_absolute_path_occurrences'] or v['encoding']!='zstd'for v in row['source_privacy'].values()):row['errors'].append('Source privacy/compression failure')
 regenerated=HERE/'qa/regenerated'/(item['id']+'.glb')
 if regenerated.exists():
  rd,rb=qa.load_glb(regenerated);rg=qa.scene_geometry(rd,rb);sig=qa.shape_signature(doc,geo);rsig=qa.shape_signature(rd,rg);row['source_reexport_matches_geometry_material_uv']=sig==rsig;row['source_reexport_matches_full_materials']=doc.get('materials')==rd.get('materials')
  if sig!=rsig or doc.get('materials')!=rd.get('materials'):row['errors'].append('Native replay does not reproduce delivered geometry/UV/full PBR')
 else:row['errors'].append('Reopened native replay not run')
 if item.get('sha256')!=row['sha256'] or item.get('sourceSha256')!=qa.sha256(ROOT/item['sourceBlend']):row['errors'].append('Stale descriptor hashes')
 rows.append(row);print('SOFA_BYTES_QA',item['id'],row['errors'],flush=True)
(HERE/'qa').mkdir(exist_ok=True);(HERE/'qa/bytes.json').write_text(json.dumps(dict(descriptor_sha256=qa.sha256(HERE/'descriptors.json'),items=rows,errors=sum(len(r['errors'])for r in rows),model_bytes=sum(r['bytes']for r in rows),triangles=sum(r['triangles']for r in rows)),indent=2)+'\n')
raise SystemExit(any(r['errors']for r in rows))
