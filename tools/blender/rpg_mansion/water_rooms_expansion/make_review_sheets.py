"""Actual render contact sheets, grouped by construction role."""
import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
H=Path(__file__).resolve().parent;R=H.parents[3];items=json.loads((H/'descriptors.json').read_text())['items']
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
bindings=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
groups=[('baths',[i for i in items if i['kind']=='bathtub']),('basins',[i for i in items if i['kind']=='vanity']),('supply-showers-wc',[i for i in items if i['kind']not in ['bathtub','vanity']])]
for name,group in groups:
 inputs=[]
 out=Image.new('RGB',(1536,62+420*len(group)),'#dfe3e5');draw=ImageDraw.Draw(out);draw.text((18,13),'ORIGINAL WATER-ROOM EXPANSION | '+name+' | Pending final review',font=font,fill='#162932')
 for row,it in enumerate(group):
  for col,view in enumerate(['thumb','top','front','rear']):
   p=R/it[view]
   if not p.exists():continue
   inputs.append({'id':it['id'],'view':view,'path':str(p.relative_to(R)),'sha256':sha(p)})
   im=Image.open(p).convert('RGBA');im.thumbnail((372,372));x=col*384;y=62+row*420;out.paste(im,(x+(384-im.width)//2,y+28),im);draw.text((x+8,y+3),it['id'].removeprefix('rpg-mansion-').removesuffix('-01')+' | '+view,font=small,fill='#162932')
 target=H/'evidence'/('review-'+name+'.png');out.save(target);bindings.append({'sheet':str(target.relative_to(R)),'sha256':sha(target),'inputs':inputs});print(name)
(H/'qa/review-sheet-bindings.json').write_text(json.dumps({'generatorSha256':sha(Path(__file__)),'sheets':bindings,'errors':[]},indent=2)+'\n')
