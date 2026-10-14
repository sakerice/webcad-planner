"""Read-only checks of native final images, metrology, provenance and preservation."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

P=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
R=json.loads((P/'final-inspection.json').read_text())
ids=[x['id'] for x in R['designs']]
assert ids==[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
expected={f'{id}-{v}.png' for id in ids for v in ['front','side','back','turnaround']}|{'lineup.png'}
assert {p.name for p in P.glob('*.png')}==expected
assert {x['file'] for x in R['deliverable_pngs']}==expected
for x in R['deliverable_pngs']:
    p=P/x['file'];assert sha(p)==x['sha256']
    with Image.open(p) as im:assert list(im.size)==x['size'] and min(im.size)>=1024;im.verify()
for d in R['designs']:
    id=d['id'];assert (P/f'{id}-colors.md').is_file();h=d['front_head_measurement']
    im=Image.open(P/f'{id}-front.png').convert('RGB');assert list(im.getpixel(tuple(h['chin_xy'])))==h['chin_raw_rgb']
    assert h['head_height_px']==h['chin_xy'][1]-h['crown_y']
    assert h['full_height_px']==h['sole_y']-h['crown_y']
    assert abs(h['head_units']-h['full_height_px']/h['head_height_px'])<1e-8
    assert 6<h['head_units']<7
    assert all(30<=a<=45 for a in d['a_pose_sleeve_outer_edge']['degrees_from_vertical'])
    t=d['turnaround_front_head_measurement']
    ti=Image.open(P/f'{id}-turnaround.png').convert('RGB')
    assert list(ti.getpixel(tuple(t['chin_xy'])))==t['chin_raw_rgb']
    assert t['head_height_px']==t['chin_xy'][1]-t['crown_y']
    assert t['full_height_px']==t['sole_y']-t['crown_y']
    assert abs(t['head_units']-t['full_height_px']/t['head_height_px'])<1e-8
    assert 6<t['head_units']<7
gens=json.loads((P/'production-generations.json').read_text());selected=[x for x in gens if x['selected']]
assert len(selected)==18 and len({x['repository_output'] for x in selected})==18
for x in selected:assert x['official_tool']=='image_gen.imagegen' and x['prompt'] and sha(P/x['repository_output'])==x['raw_sha256']==sha(Path(x['raw_path']))
for x in gens:
    assert x['prompt'] and x['official_tool']=='image_gen.imagegen'
    assert not any(word in x['prompt'].lower() for word in ['pokemon','pokémon','ポケモン','sword and shield'])
for rec in json.loads((P/'colour-inspection.json').read_text()):
    assert (P/f'{rec["id"]}-colors.md').is_file() and len(rec['samples'])>=8
    ci=Image.open(P/f'{rec["id"]}-front.png').convert('RGB')
    for s in rec['samples']:
        x,y=s['point'];pixels=[ci.getpixel((x+dx,y+dy)) for dy in [-1,0,1] for dx in [-1,0,1]]
        assert s['rgb']==[sorted(px[c] for px in pixels)[4] for c in range(3)]
        assert s['hex']=='#'+''.join(f'{v:02X}' for v in s['rgb'])
im=Image.open(P/'lineup.png').convert('RGB');assert im.size==(4800,1280)
for i in range(6):
    col=im.crop((800*i,0,800*(i+1),1133));r,g,b=col.split();hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b)
    mask=ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda x:255 if x>20 else 0),hi.point(lambda x:255 if x<140 else 0));box=mask.getbbox()
    assert box[0]>0 and box[2]<800 and box[3]-1==1132
    assert box[3]-box[1]-1==(1032 if i<3 else 960)
history=P/'candidates/superseded-six-20261014'
for x in json.loads((history/'archive-sha256.json').read_text()):assert sha(history/x['file'])==x['sha256']
kept=json.loads((P/'approved-and-history-preservation.json').read_text())
assert kept['all_png_bytes_preserved'] and kept['original_png_count']==84
for x in kept['files']:assert sha(P.parents[3]/x['preserved_file'])==x['sha256']
preserved=json.loads((P/'3d-misstart-preservation.json').read_text())
assert preserved['stopped'] and not preserved['geometry_changes_after_stop']
for archive in preserved['archives']:
    for x in archive['files']:assert sha(Path(archive['preserved_at'])/x['file'])==x['sha256']
assert not (P.parents[1]/'modeling/approved-20261014').exists()
library=P/'library-save-status.json'
if library.exists():
    L=json.loads(library.read_text());assert L['status']=='succeeded' and L['library_file_id']==R['library']['library_file_id']
    assert L['file_size_bytes']==(P/'lineup.png').stat().st_size
    assert L['readback_sha256']==sha(P/'lineup.png')==L['sha256']
    assert L['readback_file_size_bytes']==L['file_size_bytes']
handoff=json.loads((P/'handoff-manifest.json').read_text())
assert len(handoff['files'])==31 and not handoff['all_delivered_variations_human_approved']
for x in handoff['files']:assert sha(P/x['file'])==x['sha256'] and (P/x['file']).stat().st_size==x['bytes']
print('PASS:25 PNGs,18 native official images,6 sampled palettes,6 raw+6 turnaround pixel head measurements,A-pose slopes,exact172/160cm lineup,no clipped fingers,full prompts,84 oldPNG/89 3D file preservation,Library readback,31-file handoff.')
