"""Generate honest labeled review sheets from delivered transparent PNG bytes."""
from pathlib import Path
import json,math
from PIL import Image,ImageDraw,ImageFont
H=Path(__file__).resolve().parent;R=H.parents[3]
items=json.loads((H/'descriptors.json').read_text())['items']
plan=json.loads((H/'production-plan.json').read_text())['items']
order=['rpg-mansion-'+i['slug']+'-01' for i in plan]
items=sorted(items,key=lambda i:order.index(i['id']))
labels=['Camelback two','Leather Chesterfield','Open salon medallions','Compact salon loveseat','Asymmetric fainting couch','High settle three','Left-return corner','Right-return corner (variant)','Inward conversation','Bowed window sofa','Servants armless settee','Double-end Recamier','Three-side daybed','Channel-back divan','Spindle hall settee','Opposed tete-a-tete','Camelback three (variant)','High settle two (variant)']
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def sheet(selected,view,name,side=400):
 rows=math.ceil(len(selected)/3);height=side+78
 canvas=Image.new('RGB',(side*3,height*rows),'#e9e5dd');draw=ImageDraw.Draw(canvas)
 title=ImageFont.truetype(font,16);small=ImageFont.truetype(font,13)
 for n,it in enumerate(selected):
  x=(n%3)*side;y=(n//3)*height
  im=Image.open(R/it[view]).convert('RGBA').resize((side,side),Image.Resampling.LANCZOS)
  canvas.paste(im,(x,y+27),im)
  label=labels[order.index(it['id'])]
  draw.text((x+12,y+6),label,font=title,fill='#32291f')
  draw.text((x+12,y+side+28),'%d × %d × %d mm • %s seat%s'%(it['w'],it['d'],it['h'],it['seatingCapacity'],'s'if it['seatingCapacity']!=1 else''),font=small,fill='#32291f')
  v=json.loads((R/it['validation']).read_text())
  draw.text((x+12,y+side+49),'460 mm seat top • %d triangles • %.1f KiB'%(v['triangles'],v['glb_bytes']/1024),font=small,fill='#32291f')
 canvas.save(H/'evidence'/name,quality=95)
(H/'evidence').mkdir(exist_ok=True)
# Approved original prototype sheet is kept byte-for-byte.
for view in ['thumb','top','front','rear']:
 sheet(items,view,'family-'+view+'-contact-sheet.jpg')
for start in range(0,len(items),6):sheet(items[start:start+6],'thumb','review-%02d-%02d.jpg'%(start+1,min(start+6,len(items))),512)
print('SOFA_REVIEW_SHEETS',len(items))
