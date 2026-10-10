"""Check every rendered PNG and its recorded binding to a shipped GLB."""
from pathlib import Path
import json,hashlib
from PIL import Image
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];PACK=ROOT/'assets/models/packs/rpg-mansion'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
rows=json.loads((HERE/'reports/render-bindings.json').read_text())
assert len(rows)==32
expected={'thumb':(1,1),'top':(1,1),'front':(1,1),'rear':(1,1),'stretch-w120-h80':(1.2,.8),'stretch-w80-h120':(.8,1.2),'stretch-w130-h70':(1.3,.7),'stretch-w70-h130':(.7,1.3)}
ledger={r['id']:r for r in json.loads((HERE/'reports/asset-ledger.json').read_text())}
seen=set();checks=[]
for r in rows:
 key=(r['id'],r['view']);assert key not in seen;seen.add(key)
 assert tuple(r['scaleWidthHeight'])==expected[r['view']]
 source=PACK/r['source'];assert sha(source)==r['sourceSha256']
 p=(PACK if r['view']in ['thumb','top']else HERE)/r['image'];assert sha(p)==r['imageSha256']
 im=Image.open(p);assert im.mode=='RGBA'
 res=512 if r['view']in ['thumb','top']else 768
 assert im.size==(res,res)==tuple(r['resolution'])
 alpha=im.getchannel('A');bb=alpha.getbbox();assert bb
 assert min(bb[0],bb[1],res-bb[2],res-bb[3])>=3,(p,bb)
 hist=alpha.histogram();assert hist[0]>0 and hist[255]>0
 assert all(im.getpixel(xy)[3]==0 for xy in [(0,0),(res-1,0),(0,res-1),(res-1,res-1)])
 lo,hi=r['boundsBlenderM'];size=ledger[r['id']]['dimensions_mm'];sw,sh=r['scaleWidthHeight']
 target=[size[0]*sw,size[1],size[2]*sh]
 assert max(abs((hi[i]-lo[i])*1000-target[i])for i in range(3))<.001
 checks.append({'id':r['id'],'view':r['view'],'resolution':list(im.size),'rgba':True,'transparentBackground':True,'unclippedPixelBounds':list(bb),'transparentPixels':hist[0],'opaquePixels':hist[255],'shippedGlbHashMatchesBinding':True,'imageHashMatchesBinding':True,'measuredStretchedDimensionsMm':[(hi[i]-lo[i])*1000 for i in range(3)]})
assert seen=={(i,v)for i in ledger for v in expected}
(HERE/'reports/image-validation.json').write_text(json.dumps(checks,indent=2)+'\n')
print('PASS: 32 RGBA renders, correct sizes and stretch bounds, unclipped, matched to shipped GLB hashes.')
