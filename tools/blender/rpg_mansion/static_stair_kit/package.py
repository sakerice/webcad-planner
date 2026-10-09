"""Prepare standard integration descriptors, copy map and visual evidence binding.
Does not edit the application, accepted families or a repository manifest.
"""
from pathlib import Path
import json,hashlib,copy
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
FAMILY='tools/blender/rpg_mansion/static_stair_kit'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def destination(rel):
    if rel.startswith('models/'):return 'assets/models/packs/rpg-mansion/'+rel
    if rel.startswith('previews/'):return 'assets/models/packs/rpg-mansion/'+rel
    return FAMILY+'/'+rel

d=json.loads((ROOT/'descriptors.json').read_text());items=[];binding=[]
for a in d['items']:
    it=copy.deepcopy(a)
    for key in ('model','thumb','top','front','rear','sourceBlend','authoringBlend','validation','builder'):it[key]=destination(a[key])
    for key in ('model','sourceBlend','authoringBlend','thumb','top','front','rear'):assert (ROOT/a[key]).is_file(),a[key]
    it['hashes']={key:sha(ROOT/a[key])for key in ('model','sourceBlend','authoringBlend','thumb','top','front','rear')}
    it['geometrySignature']={'flight':'closed-sawtooth-housed-stringers-closed-risers-bullnose-treads-transverse-bearers-notched-end-shoes','landing':'planked-deck-framed-aprons-cross-joists-braced-grounded-posts-and-receiver-ledges','raked-guard':'turned-spindles-continuous-raked-hand-bottom-rails-top-seated-newels-and-tread-shoes','landing-guard':'turned-spindles-horizontal-hand-bottom-rails-supported-midspan-or-corner-posts','newel':'chamfered-walnut-newel-brass-collars-four-way-hand-and-lower-rail-receiver-tenons'}[a['role']]
    items.append(it);binding.append(dict(id=a['id'],sourceSha256=it['hashes']['sourceBlend'],glbSha256=it['hashes']['model'],images=[dict(view=key,path=a[key],sha256=it['hashes'][key],source='Rendered directly from canonical source mesh; no geometry replacement')for key in ('thumb','top','front','rear')]))
integ=dict(set='rpg-mansion',name='洋館・階段と手摺',assetSet='rpg-mansion',stage='candidate-requires-independent-acceptance',counting=d['counting'],sourceDescriptorSha256=sha(ROOT/'descriptors.json'),items=items)
(ROOT/'integration-descriptors.json').write_text(json.dumps(integ,ensure_ascii=False,indent=2)+'\n')
(ROOT/'reports'/'image-source-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
# Geometry evidence contact sheet, not an extra asset.
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';title=ImageFont.truetype(font,28);label=ImageFont.truetype(font,15);small=ImageFont.truetype(font,13)
canvas=Image.new('RGB',(1600,1300),'#f0ece2');dr=ImageDraw.Draw(canvas);dr.text((35,22),'Original mansion stair kit | 10 modules',font=title,fill='#342b23');dr.text((35,62),'4 core constructions · 3 dimensional variants · 2 host-fitting variants · 1 connector accessory',font=label,fill='#655746')
for i,a in enumerate(d['items']):
    x=35+(i%4)*395;y=105+(i//4)*390;im=Image.open(ROOT/a['thumb']).convert('RGBA');im.thumbnail((350,320));canvas.paste(im,(x+(350-im.width)//2,y),im)
    short=a['id'].removeprefix('rpg-mansion-stair-').removesuffix('-01').replace('-',' ');dr.text((x,y+323),short,font=label,fill='#342b23');dr.text((x,y+347),a['countingClass'],font=small,fill='#766957')
dr.text((35,1252),'Static original Blender geometry · 3000 mm storey · 166.667 mm risers · 280 mm going · 960 mm minimum cap clearance',font=label,fill='#342b23')
canvas.save(ROOT/'evidence'/'stair-kit-contact-sheet.png')
include=[]
for p in ROOT.rglob('*'):
    rel=str(p.relative_to(ROOT))
    if not p.is_file()or rel.startswith('checkpoints/')or'__pycache__'in rel or p.suffix in ('.log','.blend1')or rel in ('integration-copy-map.json','delivery-manifest.json'):continue
    if rel.startswith('assemblies/')and p.suffix not in ('.blend','.json','.png'):continue
    include.append(dict(source=rel,destination=destination(rel),bytes=p.stat().st_size,sha256=sha(p)))
(ROOT/'integration-copy-map.json').write_text(json.dumps(dict(sourceRoot='Self-contained static stair kit delivery directory',destinationRoot='Repository root selected by integrator',doesNotChangeFiles=True,appIntegrationAuthorized=False,notes='Fresh static-stair-kit IDs and paths only. Copy explicitly when integration is authorized; no accepted file or application source is changed by this script.',files=sorted(include,key=lambda x:x['source'])),indent=2)+'\n')
print('PACKAGE_READY',len(items),'items',len(include),'files')
