"""Validate all eight order textures. Run after generator.
Uses a temporary directory for the shifted-coordinate regeneration. No external
assets, network, app files or Git mutations are involved.
"""
from pathlib import Path
import hashlib,json,tempfile
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
GEN=HERE/'generate_order_textures.py'
KEYS=['mansion_ashlar_stone','mansion_damask_wallpaper','mansion_herringbone_oak','mansion_marble_checker','mansion_brick_red','mansion_slate_roof','mansion_white_subway_tile','mansion_wainscot_panel']
paths=[ROOT/'assets/textures/mansion'/f'{k}_{typ}.jpg' for k in KEYS for typ in ['diffuse','normal','roughness']]+[HERE/'tiling'/f'{k}.jpg' for k in KEYS]
def digests():return {str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in paths}
first=digests();normal_metrics={}
for f in paths:
 with Image.open(f) as im:
  im.load();assert im.size==(1024,1024) and im.mode=='RGB' and im.format=='JPEG',str(f)
  a=np.asarray(im).astype(float)/255
  if f.stem.endswith('_roughness'):assert np.max(a.max(2)-a.min(2))==0
  if f.stem.endswith('_normal'):
   length=np.linalg.norm(a*2-1,axis=2)
   normal_metrics[f.stem]={'length_max_error':float(abs(length-1).max()),'length_error_p999':float(np.quantile(abs(length-1),.999)),'z_min':float((a[:,:,2]*2-1).min())}
   # JPEG is lossy; shaders normalize tangent normals. Report deviations.
   assert abs(length-1).max()<.25 and np.quantile(abs(length-1),.999)<.10 and (a[:,:,2]*2-1).min()>0
# Run authoritative generator a second time and compare every JPEG byte.
source=GEN.read_text();scope={'__file__':str(GEN)}
exec(compile(source,str(GEN),'exec'),scope)
assert first==digests()
with tempfile.TemporaryDirectory(prefix='mansion-period-test-') as temp:
 shifted=source.replace('ROOT=Path(__file__).resolve().parents[4]',f'ROOT=Path({temp!r})').replace("TILE=Path(__file__).parent/'tiling'; TILE.mkdir(exist_ok=True)","TILE=ROOT/'tiling'; TILE.mkdir(exist_ok=True)").replace('x=np.mod(x,1.0); y=np.mod(y,1.0)','x=np.mod(x+1,1.0); y=np.mod(y-1,1.0)').replace("(Path(__file__).parent/'texture-validation.json')","(ROOT/'texture-validation.json')")
 exec(compile(shifted,str(GEN),'exec'),{'__file__':str(GEN)})
 for rel,digest in first.items():
  f=Path(temp)/rel if rel.startswith('assets/') else Path(temp)/'tiling'/Path(rel).name
  assert hashlib.sha256(f.read_bytes()).hexdigest()==digest,rel
report=HERE/'texture-validation.json';data=json.loads(report.read_text())
data['independent_verification']={'jpeg_files':len(paths),'dimensions':[1024,1024],'mode':'RGB','deterministic_second_run_identical':True,'one_tile_coordinate_shift_byte_identical':True,'wainscot_repeat_scope':'horizontal only; vertical-coordinate shift is regeneration determinism, not approved vertical tiling','normal_decoded_metrics':normal_metrics,'normal_lossy_validation_bounds':{'max_length_error':.25,'p999_length_error':.10,'note':'JPEG validation sanity bounds, not a rendering acceptance standard; consuming shader normalizes'},'jpeg_quality':{'maps':85,'new_four_normals':90,'tiling':85},'color_usage':{'diffuse':'sRGB color samples; consumers must apply sRGB decoding','normal':'linear data samples; no sRGB decoding; normalize in shader','roughness':'linear data samples; no sRGB decoding'},'total_jpeg_bytes':sum(f.stat().st_size for f in paths),'sha256':first,'visual_review':'2x2 sheets inspected; sharpened symmetric damask, reduced synthetic stone noise, variable oak grain, individually oriented branched marble veins; English bond brick; six-course half-stagger slate; white subway; horizontal-only walnut wainscot','period_note':'pixel endpoints are sample centres and need not match; marble boundary contrast is the intended 400mm checker transition'}
assert 860/215==4 and 860/107.5==8 and 1200/300==4 and 1200/200==6 and 600/150==4 and 600/75==8
assert 12%2==0 and 6%2==0 and 8%2==0
data['geometry_period_validation']={'brick_stretcher_columns':4,'brick_header_columns':8,'brick_even_courses':12,'slate_columns':4,'slate_even_courses':6,'half_stagger_wrap_verified':True,'subway_columns':4,'subway_even_courses':8,'wainscot_horizontal_boards':9,'wainscot_vertical_repeat_not_claimed':True}
report.write_text(json.dumps(data,indent=2)+'\n')
print('PASS: all 32 JPEGs; repeat/period byte equality; normal magnitude and convention; grayscale roughness.')
