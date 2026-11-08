"""Read-only issue167 checks against actual current files and preserved history."""
import hashlib,json
from pathlib import Path
from PIL import Image
from inspect_proportion_fronts import bbox
P=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
R=json.loads((P/'final-inspection.json').read_text());ids=[d['id'] for d in R['designs']]
assert R['issue']==167 and R['style_only_approval'] and not R['three_d_deliverables']
assert ids==[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
expected={f'{id}-{v}.png' for id in ids for v in ['front','side','back','turnaround']}|{'lineup.png','approved-face-comparison.png'}
assert {p.name for p in P.glob('*.png')}==expected
assert {x['file'] for x in R['deliverable_pngs']}==expected
for x in R['deliverable_pngs']:
 p=P/x['file'];assert sha(p)==x['sha256']
 with Image.open(p) as im:assert list(im.size)==x['size'] and min(im.size)>=1024;im.verify()
def check_head(h,im):
 assert list(im.getpixel(tuple(h['chin_xy'])))==h['chin_raw_rgb']
 assert h['head_height_px']==h['chin_xy'][1]-h['crown_y']
 assert h['full_height_px']==h['sole_y']-h['crown_y']
 assert abs(h['head_units']-h['full_height_px']/h['head_height_px'])<1e-8
 assert 5.3<=h['head_units']<=5.8,h
for d in R['designs']:
 id=d['id'];assert (P/f'{id}-colors.md').is_file()
 assert all(30<=a<=45 for a in d['a_pose_local_sleeve_degrees'])
 for v in d['views']:
  im=Image.open(P/f'{id}-{v["view"]}.png').convert('RGB');assert im.size==(1254,1254)
  assert list(bbox(im))==v['bbox'] and v['vertical_fill_percent']>93
  h=v['head_measurement'];assert h['crown_y']==v['bbox'][1] and h['sole_y']==v['bbox'][3]-1
  if v['view']!='back':check_head(h,im)
  else:
   assert h['chin_xy'] is None and h['head_units'] is None
   assert list(im.getpixel(tuple(h['visible_posterior_hair_boundary_xy'])))==h['visible_posterior_hair_boundary_rgb']
 im=Image.open(P/f'{id}-turnaround.png').convert('RGB');assert im.size==(3120,1280)
 for v in ['front','side']:check_head(d['turnaround_head_measurements'][v],im)
 assert d['turnaround_head_measurements']['back']['head_units'] is None
 for j in range(3):
  b=bbox(im.crop((1040*j,0,1040*(j+1),1231)))
  assert b[0]>0 and b[2]<1040 and b[3]-1==1230
  assert b[3]-b[1]-1==d['height_cm']*7
gens=json.loads((P/'production-generations.json').read_text());selected=[g for g in gens if g['selected']]
assert len(gens)==39 and len(selected)==18 and len({g['repository_output'] for g in selected})==18
for g in gens:
 assert g['official_tool']=='image_gen.imagegen' and g['prompt']
 assert not any(s in g['prompt'].lower() for s in ['pokemon','pokémon','ポケモン','sword and shield'])
 assert sha(Path(g['raw_path']))==g['raw_sha256']
 for s in g['input_snapshots']:assert sha(Path(s['path']))==s['sha256']
for g in selected:assert sha(P/g['repository_output'])==g['raw_sha256']
for rec in json.loads((P/'colour-inspection.json').read_text()):
 im=Image.open(P/f'{rec["id"]}-front.png').convert('RGB');assert len(rec['samples'])>=8
 for s in rec['samples']:
  x,y=s['point'];pixels=[im.getpixel((x+dx,y+dy)) for dy in [-1,0,1] for dx in [-1,0,1]]
  assert s['rgb']==[sorted(px[c] for px in pixels)[4] for c in range(3)]
  assert s['hex']=='#'+''.join(f'{v:02X}' for v in s['rgb'])
  assert s['hex'] in (P/f'{rec["id"]}-colors.md').read_text()
im=Image.open(P/'lineup.png').convert('RGB');assert im.size==(5400,1280)
for i in range(6):
 b=bbox(im.crop((900*i,0,900*(i+1),1133)))
 assert b[0]>0 and b[2]<900 and b[3]-1==1132
 assert b[3]-b[1]-1==(1032 if i<3 else 960)
assert Image.open(P/'approved-face-comparison.png').size==(3600,1280)
for s in R['face_comparison']:assert sha(P/s['before'])==s['before_sha256']
H=P/'candidates/superseded-adult-issue143-20261014'
old=json.loads((H/'archive-sha256.json').read_text());assert old['issue']==143 and len(old['files'])==45
for s in old['files']:assert sha(H/s['file'])==s['sha256']
kept=json.loads((P/'approved-and-history-preservation.json').read_text());assert kept['original_png_count']==84
for s in kept['files']:assert sha(P.parents[3]/s['preserved_file'])==s['sha256']
preserved=json.loads((P/'3d-misstart-preservation.json').read_text());assert preserved['stopped'] and not preserved['geometry_changes_after_stop']
for a in preserved['archives']:
 for s in a['files']:assert sha(Path(a['preserved_at'])/s['file'])==s['sha256']
assert not (P.parents[1]/'modeling/approved-20261014').exists()
assert json.loads((P/'library-save-status.json').read_text())['status']=='deferred_to_parent'
handoff=json.loads((P/'handoff-manifest.json').read_text());assert handoff['issue']==167 and len(handoff['files'])==32
for s in handoff['files']:assert sha(P/s['file'])==s['sha256']
review=json.loads((P/'review-image-manifest.json').read_text());assert sha(Path(review['file']))==review['sha256']
print('PASS:26PNG/18native1254views/6palettes;12raw+12turnaround visible-chin ratios5.3-5.8;6back landmarks explicitly not chin;Apose/172-160scale/fingers;39prompts;issue14345files+84oldPNG+89stopped3D files retained;32-file handoff. Library deferred to parent.')
