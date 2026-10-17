"""Exact fresh-source product-render pixel replay with final file hashes."""
from pathlib import Path
import json,hashlib
from PIL import Image
import numpy as np
H=Path(__file__).resolve().parent;R=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
reports=[]
for it in json.loads((H/'descriptors.json').read_text())['items']:
 for view in ['thumb','top','front','rear']:
  delivered=R/it[view];replay=H/'qa/pixel-replay'/(it['id']+'-'+view+'.png');a=np.array(Image.open(delivered).convert('RGBA'));b=np.array(Image.open(replay).convert('RGBA'));same=bool(np.array_equal(a,b))
  reports.append({'id':it['id'],'view':view,'sourceSha256':sha(R/it['sourceBlend']),'imageSha256':sha(delivered),'replaySha256':sha(replay),'exactRGBApixelReplay':same,'maxChannelDelta':int(abs(a.astype(int)-b.astype(int)).max()),'errors':[]if same else['Fresh source render differs']})
out={'method':__doc__,'items':reports,'errors':sum(len(r['errors'])for r in reports)};(H/'qa/image-replay.json').write_text(json.dumps(out,indent=2)+'\n');print('WATER_IMAGE_REPLAY',len(reports),out['errors']);raise SystemExit(bool(out['errors']))
