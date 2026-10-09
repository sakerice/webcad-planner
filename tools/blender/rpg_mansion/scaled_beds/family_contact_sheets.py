"""Family review pages; original approved three-prototype sheet remains unchanged."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,textwrap
H=Path(__file__).resolve().parent;R=H.parents[3]
data=json.loads((H/'bed-items.json').read_text());plan=json.loads((H/'production-plan.json').read_text());order={q['slug']:i for i,q in enumerate(plan['profiles'])};items=sorted(data['items'],key=lambda q:order[q['id'].removeprefix('rpg-mansion-').removesuffix('-01')]);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
def sheet(batch,keys,path,cols):
 font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16 if cols<=3 else 12);cell=384 if cols<=3 else 278;pad=14;rowh=cell+(80 if cols<=3 else 64);rows=(len(batch)+cols-1)//cols*len(keys);im=Image.new('RGB',(pad+cols*(cell+pad),pad+rows*rowh),(238,234,226));dr=ImageDraw.Draw(im)
 for n,item in enumerate(batch):
  title=item['id'].removeprefix('rpg-mansion-').removesuffix('-01')
  for k,key in enumerate(keys):
   x=pad+(n%cols)*(cell+pad);y=pad+((n//cols)*len(keys)+k)*rowh;p=Image.open(R/item[key]).convert('RGBA');p.thumbnail((cell,cell));im.paste(p,(x,y),p)
   lines=[];line=''
   for word in title.split('-'):
    candidate=line+'-'+word if line else word
    if dr.textlength(candidate,font=font)>cell-6:lines.append(line);line=word
    else:line=candidate
   if line:lines.append(line)
   assert len(lines)<=2 and all(dr.textlength(t,font=font)<=cell-6 for t in lines)
   dr.text((x,y+cell+2),'\n'.join(lines),font=font,fill=(45,40,35));label=f"{key} | {item['w']} x {item['d']} x {item['h']} mm";assert dr.textlength(label,font=font)<=cell-6;dr.text((x,y+cell+44),label,font=font,fill=(70,62,55))
 im.save(path,quality=95);print(path)
sheet(items,['thumb'],H/'evidence/bed18-overview.jpg',6)
for i in range(2):sheet(items[6*i:6*(i+1)],['thumb','top','front','rear'],H/f'evidence/bed18-detail-page-{i+1}.jpg',6)
sheet(items[12:15],['thumb','top','front','rear'],H/'evidence/bed18-detail-page-3a.jpg',3)
sheet(items[15:18],['thumb','top','front','rear'],H/'evidence/bed18-detail-page-3b.jpg',3)
