"""Exact replay and margins of installed/section/pair/exported-glass proof images."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
H=Path(__file__).resolve().parent;R=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
rows=[]
def compare(name,source,delivered,replay):
 a=np.array(Image.open(delivered).convert('RGBA'));b=np.array(Image.open(replay).convert('RGBA'));same=np.array_equal(a,b);mask=a[:,:,3]>0;ys,xs=np.where(mask);margin=min(xs.min(),ys.min(),a.shape[1]-1-xs.max(),a.shape[0]-1-ys.max())if len(xs)else -1;errs=[]
 if not same:errs.append('Proof pixel replay differs')
 if margin<12:errs.append('Proof image clipped or margin below12px')
 rows.append({'name':name,'sourceSha256':sha(source),'path':str(delivered.relative_to(R)),'imageSha256':sha(delivered),'replaySha256':sha(replay),'exactRGBApixelReplay':bool(same),'minimumAlphaMarginPixels':int(margin),'size':[a.shape[1],a.shape[0]],'errors':errs})
for it in json.loads((H/'descriptors.json').read_text())['items']:
 for view in ['installation','section']:
  name=it['id']+'-'+view+'.png';compare(name,R/it['sourceBlend'],H/'evidence'/name,H/'qa/install-pixel-replay'/name)
for view in ['thumb','top','front','rear']:
 name='qa-slipper-bath-filler-pair-'+view+'.png';compare(name,H/'sources/qa-slipper-bath-filler-pair.blend',H/'evidence'/name,H/'qa/pair-pixel-replay'/name)
for mode in ['actual-export','no-glass-control']:
 name='qa-enclosure-glass-'+mode+'.png';compare(name,H/'sources/qa-exported-enclosure-glass-marker.blend',H/'evidence'/name,H/'qa/glass-pixel-replay'/name)
out={'method':__doc__,'images':rows,'errors':sum(len(r['errors'])for r in rows)};(H/'qa/proof-replay.json').write_text(json.dumps(out,indent=2)+'\n');print('PROOF_PIXEL_REPLAY',len(rows),out['errors']);raise SystemExit(bool(out['errors']))
