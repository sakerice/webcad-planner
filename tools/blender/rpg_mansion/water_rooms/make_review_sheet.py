"""Assemble labelled review contact sheets from actual rendered evidence."""
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont
H=Path(__file__).resolve().parent;R=H.parents[3]
items=json.loads((H/'descriptors.json').read_text())['items'];order=['bathtub','vanity','toilet'];items.sort(key=lambda i:order.index(i['kind']))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
short={'bathtub':'Hollow slipper bath','vanity':'Bracketed wall basin','toilet':'High-cistern pull-chain WC'}
for outname,views,columns,rowh in [('prototype-review-sheet.png',['thumb','top','front','rear'],4,440),('installation-section-review.png',['installation','section'],2,570)]:
 width=1536;cw=width//columns;out=Image.new('RGB',(width,80+3*rowh),'#dfe3e5');draw=ImageDraw.Draw(out)
 draw.text((22,14),'THREE ORIGINAL WATER-ROOM PROTOTYPES | Pending independent and root review',font=font,fill='#182b33')
 draw.text((22,42),'Static models. Cut faces are orange. Grey installation walls/floors are QA fixtures and are excluded from the model count.',font=small,fill='#35444c')
 for row,item in enumerate(items):
  for col,view in enumerate(views):
   p=R/item[view]if view in item else H/'evidence'/(item['id']+'-'+view+'.png');im=Image.open(p).convert('RGBA');im.thumbnail((cw-20,rowh-66));x=col*cw;y=80+row*rowh
   out.paste(im,(x+(cw-im.width)//2,y+42),im);draw.text((x+12,y+8),short[item['kind']]+' | '+view,font=small,fill='#182b33')
   if view=='section':
    text={'bathtub':'Rim crests 622 / 862 mm; floor 225 mm; clear opening 1650 × 690 mm','vanity':'Installed rim 870 mm; cavity depth 140 mm; bottom elevation 530 mm','toilet':'Seat 460 mm; bowl depth 150 mm; independently bracketed tank 2130 mm'}[item['kind']]
    draw.text((x+12,y+rowh-20),text,font=small,fill='#182b33')
 out.save(H/'evidence'/outname)
 print(outname)
