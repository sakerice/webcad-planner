"""Bind labelled installed/section sheets to final actual proof images."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];items=json.loads((H/'descriptors.json').read_text())['items'];font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13);bindings=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for group in ['baths','basins','fixtures']:
 its=[i for i in items if ('baths'if i['kind']=='bathtub'else'basins'if i['kind']=='vanity'else'fixtures')==group];out=Image.new('RGB',(1280,62+460*len(its)),'#dfe3e5');draw=ImageDraw.Draw(out);draw.text((15,10),'ACTUAL INSTALLED AND CUTAWAY EVIDENCE | '+group,font=font,fill='#162932');draw.text((15,34),'Orange = cut faces. Grey wall/floor fixtures are QA-only and excluded from model counts.',font=small,fill='#162932');inputs=[]
 for row,it in enumerate(its):
  for col,view in enumerate(['installation','section']):
   p=H/'evidence'/(it['id']+'-'+view+'.png');im=Image.open(p).convert('RGBA');im.thumbnail((620,420));x=col*640;y=62+row*460;out.paste(im,(x+(640-im.width)//2,y+24),im);draw.text((x+10,y+1),it['id'].removeprefix('rpg-mansion-').removesuffix('-01')+' | '+view,font=small,fill='#162932');inputs.append({'path':str(p.relative_to(R)),'sha256':sha(p)})
 target=H/'evidence'/('review-installed-'+group+'.png');out.save(target);bindings.append({'sheet':str(target.relative_to(R)),'sha256':sha(target),'inputs':inputs})
(H/'qa/installation-sheet-bindings.json').write_text(json.dumps({'generatorSha256':sha(Path(__file__)),'sheets':bindings,'errors':[]},indent=2)+'\n')
