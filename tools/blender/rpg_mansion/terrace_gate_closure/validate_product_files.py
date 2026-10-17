"""Validate byte-bound candidate GLBs and512 RGBA product views without app writes."""
from pathlib import Path
import json,struct,hashlib
from PIL import Image
HERE=Path(__file__).resolve().parent
results=[]
for it in json.loads((HERE/'descriptors.json').read_text())['items']:
    raw=(HERE/it['model']).read_bytes();g=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    assert hashlib.sha256(raw).hexdigest()==it['sha256']
    assert len(g['meshes'])==1 and len(g['scenes'])==1
    channels=sorted({m.get('extras',{}).get('finishChannel')for m in g['materials']});assert channels==it['finishChannels']
    primitives=g['meshes'][0]['primitives'];positions=[g['accessors'][pr['attributes']['POSITION']]for pr in primitives]
    lo=[min(a['min'][axis]for a in positions)for axis in range(3)];hi=[max(a['max'][axis]for a in positions)for axis in range(3)]
    actual=[(hi[0]-lo[0])*1000,(hi[2]-lo[2])*1000,(hi[1]-lo[1])*1000]
    assert all(abs(a-b)<.01 for a,b in zip(actual,it['actualMeasuredDimensionsMm']))
    assert abs(lo[1])<1e-6 and max(abs(lo[x]+hi[x])for x in [0,2])<1e-6
    tris=sum(g['accessors'][pr['indices']]['count']//3 for pr in primitives);assert tris==it['triangles'] and tris<=it['triangleBudget']
    views=[]
    for v in ['thumb','top','front','rear']:
        p=HERE/it[v];img=Image.open(p);assert img.size==(512,512)and img.mode=='RGBA';a=img.getchannel('A');assert a.getextrema()[0]==0 and a.getextrema()[1]>0;bb=a.getbbox();assert all(x>0 for x in bb[:2])and all(x<512 for x in bb[2:]);views.append(dict(view=v,size=list(img.size),mode=img.mode,alphaBounds=list(bb),sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    results.append(dict(id=it['id'],glbSha256=it['sha256'],actualMeasuredDimensionsMm=actual,triangles=tris,materialChannels=channels,views=views,passed=True))
(HERE/'reports/product-file-validation.json').write_text(json.dumps(dict(passed=True,assets=results,runtimeAppChecks='Not run here; require integrated review copy and independent QA.'),indent=2)+'\n')
print('All three GLBs and twelve512 RGBA product views pass.')
