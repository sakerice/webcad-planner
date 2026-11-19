#!/usr/bin/env python3
"""Read-only integrity/coverage check of the actual delivered image set."""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageChops
P=Path(__file__).resolve().parent
R=json.loads((P/'final-inspection.json').read_text())
ids=[d['id'] for d in R['designs']]
assert len(ids)==6 and len(set(ids))==6
expected={i+'-'+v+'.png' for i in ids for v in ('front','side','back','turnaround')}|{'lineup.png'}
actual={p.name for p in P.glob('*.png')}
assert actual==expected,(expected-actual,actual-expected)
assert {p['file'] for p in R['deliverable_pngs']}==expected
for rec in R['deliverable_pngs']:
    p=P/rec['file']
    assert hashlib.sha256(p.read_bytes()).hexdigest()==rec['sha256'],p.name
    with Image.open(p) as im:im.verify()
    with Image.open(p) as im:assert list(im.size)==rec['size'] and min(im.size)>=1024
for d in R['designs']:
    assert (P/(d['id']+'-colors.md')).is_file()
    h=d['front_head_measurement']
    with Image.open(P/(d['id']+'-front.png')) as im:
        assert list(im.convert('RGB').getpixel(tuple(h['chin_xy'])))==h['chin_raw_rgb']
    assert h['head_height_px']==h['chin_xy'][1]-h['crown_y']
    assert h['full_height_px']==h['sole_y']-h['crown_y']
    assert abs(h['head_units']-h['full_height_px']/h['head_height_px'])<0.000001
    assert all(30<=a<=45 for a in d['a_pose_sleeve_outer_edge']['degrees_from_vertical'])
with Image.open(P/'lineup.png') as source:
    source=source.convert('RGB')
    for i in range(6):
        r,g,b=source.crop((700*i,0,700*(i+1),1133)).split()
        hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b)
        m=ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda x:255 if x>20 else 0),hi.point(lambda x:255 if x<140 else 0))
        box=m.getbbox();distance=box[3]-box[1]-1
        assert distance==(1032 if i<3 else 960) and box[3]-1==1132
gens=json.loads((P/'production-generations.json').read_text())
assert len(gens)==26 and sum(x['selected'] for x in gens)==18
for g in gens:
    assert hashlib.sha256((P/g['repository_output']).read_bytes()).hexdigest()==g['raw_sha256']
    assert g['prompt'] and g['official_tool']=='image_gen.imagegen'
library=json.loads((P/'library-save-status.json').read_text())
assert library['status']=='succeeded' and library['library_file_id']==R['library']['library_file_id']
assert (P/'lineup.png').stat().st_size==library['file_size_bytes']
print('PASS:25 PNGs,18 raw official outputs,6 color tables,6 pixel head measurements,A-pose slopes,172/160cm exact lineup,26 production-call provenance records,Library identity record.')
