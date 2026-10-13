"""Contact sheets from final renders, for inspection, never replacement assets."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
items=json.loads((HERE/'catalogue.json').read_text())['items']
font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',11)
label_font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',12)
for view in ('thumb','front','rear','top'):
    cols=6;cellw=270;cellh=302
    sheet=Image.new('RGB',(cols*cellw,math.ceil(len(items)/cols)*cellh),'#edece7');draw=ImageDraw.Draw(sheet)
    for n,it in enumerate(items):
        mid=it['id'];x=n%cols*cellw;y=n//cols*cellh
        path=ROOT/'assets/models/packs/kominka/previews'/f'{mid}-{view}.png' if view in ('thumb','top') else HERE/'evidence'/f'{mid}-{view}.jpg'
        im=Image.open(path).convert('RGBA');im.thumbnail((260,260),Image.Resampling.LANCZOS)
        sheet.paste(im,(x+(cellw-im.width)//2,y+3),im)
        draw.text((x+7,y+265),it['stem'],font=label_font,fill='#242d29')
        draw.text((x+7,y+284),' x '.join(map(str,it['size']))+' mm',font=font,fill='#535a55')
    out=HERE/'evidence'/f'review-{view}.jpg';sheet.save(out,quality=90)
