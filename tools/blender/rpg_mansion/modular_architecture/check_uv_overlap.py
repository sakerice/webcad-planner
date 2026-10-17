"""Audit actual GLB UV triangle intersections, allowing shared edges only.

Independent grid broadphase plus convex clipping. Significant intersections
exceed 1e-9 UV-squared and 1e-5 of the smaller triangle's area.
"""
import collections,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent));import qa_asset_delivery as qa

def signed(poly):return sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1]for i in range(len(poly)))/2
def area(poly):return abs(signed(poly))if len(poly)>2 else 0
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def clip(first,second):
    output=[list(p)for p in first];second=list(second)
    if signed(second)<0:second.reverse()
    for i,point in enumerate(second):
        nxt=second[(i+1)%3];edge=[nxt[0]-point[0],nxt[1]-point[1]];old=output;output=[]
        if not old:return 0
        previous=old[-1];pd=cross(edge,[previous[0]-point[0],previous[1]-point[1]])
        for current in old:
            cd=cross(edge,[current[0]-point[0],current[1]-point[1]])
            if(cd>=0)!=(pd>=0):
                t=pd/(pd-cd);output.append([previous[0]+t*(current[0]-previous[0]),previous[1]+t*(current[1]-previous[1])])
            if cd>=0:output.append(current)
            previous=current;pd=cd
    return area(output)

reports=[]
for item in json.loads((HERE/'descriptors.json').read_text())['items']:
    doc,binary=qa.load_glb(ROOT/item['model']);rows=qa.scene_geometry(doc,binary)
    triangles=np.concatenate([row['uv'][row['indices']]for row in rows]);lo=triangles.min(1);hi=triangles.max(1)
    triangles=triangles.tolist();areas=[area(triangle)for triangle in triangles];grid=collections.defaultdict(list)
    overlaps=[];total_area=0;worst_fraction=0
    for i,triangle in enumerate(triangles):
        xmin,ymin=np.floor(lo[i]*24).astype(int);xmax,ymax=np.floor(hi[i]*24).astype(int);candidates=set()
        for x in range(xmin,xmax+1):
            for y in range(ymin,ymax+1):candidates.update(grid[(x,y)])
        for j in candidates:
            if np.any(lo[i]>=hi[j])or np.any(lo[j]>=hi[i]):continue
            overlap=clip(triangle,triangles[j]);small=min(areas[i],areas[j]);fraction=overlap/small if small else 0
            if overlap>1e-9 and fraction>1e-5:
                total_area+=overlap;worst_fraction=max(worst_fraction,fraction)
                if len(overlaps)<20:overlaps.append({'triangles':[j,i],'area':overlap,'fraction':fraction})
        for x in range(xmin,xmax+1):
            for y in range(ymin,ymax+1):grid[(x,y)].append(i)
    reports.append({'id':item['id'],'modelSha256':qa.sha256(ROOT/item['model']),
                    'significantOverlapExamples':overlaps,'totalSignificantOverlapArea':total_area,
                    'worstTriangleFraction':worst_fraction})
    print('PACKED_UV_OVERLAP',item['id'],total_area,worst_fraction,flush=True)
errors=[row['id']+' overlapping packed UV triangles'for row in reports if row['totalSignificantOverlapArea']]
(HERE/'packed-uv-overlap-qa.json').write_text(json.dumps({'items':reports,'errors':errors},indent=2)+'\n')
assert not errors,errors
