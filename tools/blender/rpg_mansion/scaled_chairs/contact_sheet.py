"""Produce actual rendered-view contact sheets for review, without changing PNGs."""
from pathlib import Path
import json,math
from PIL import Image,ImageDraw,ImageFont
H=Path(__file__).resolve().parent;ROOT=H.parents[3];items=json.loads((H/'descriptors.json').read_text())['items']
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
for view in ['thumb','top','front','rear']:
 w=260;h=290;columns=6;out=Image.new('RGB',(columns*w,math.ceil(len(items)/columns)*h),'#f3f0e9');draw=ImageDraw.Draw(out)
 for n,item in enumerate(items):
  x=(n%columns)*w;y=(n//columns)*h;im=Image.open(ROOT/item[view]).convert('RGBA');im.thumbnail((248,248));out.paste(im,(x+(w-im.width)//2,y+2),im)
  label=item['id'].replace('rpg-mansion-','').removesuffix('-01');draw.text((x+8,y+253),label,font=font,fill='#3e342b');draw.text((x+8,y+272),f"{item['w']} x {item['d']} x {item['h']} mm",font=font,fill='#665b50')
 out.save(H/('family-'+view+'-contact-sheet.png'))
