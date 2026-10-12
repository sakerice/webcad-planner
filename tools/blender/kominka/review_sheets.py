"""Small review sheets composed exclusively from the delivered renders."""
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
items=json.loads((HERE/'catalogue.json').read_text())['items']
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',14)
evidence=HERE/'evidence'

def panel(path):
    im=Image.open(path).convert('RGBA')
    bg=Image.new('RGBA',im.size,'#edece7');bg.alpha_composite(im)
    return bg.convert('RGB')

for group,start,end in [('openings',0,7),('furniture',7,20),('interior',20,32)]:
    chosen=items[start:end]
    columns=4;cell=284;rows=(len(chosen)+columns-1)//columns
    sheet=Image.new('RGB',(columns*cell,rows*(cell+32)),'#edece7');draw=ImageDraw.Draw(sheet)
    for i,it in enumerate(chosen):
        mid='kominka-'+it['stem']+'-01';x=i%columns*cell;y=i//columns*(cell+32)
        sheet.paste(panel(ROOT/'assets/models/packs/kominka/previews'/f'{mid}-thumb.png').resize((cell,cell)),(x,y+25))
        draw.text((x+8,y+6),it['stem'],font=font,fill='#242a27')
    sheet.save(evidence/f'review-{group}.jpg',quality=88)

for page,start,end in [('a',0,16),('b',16,32)]:
    sheet=Image.new('RGB',(4*250,8*272),'#edece7');draw=ImageDraw.Draw(sheet)
    for i,it in enumerate(items[start:end]):
        mid='kominka-'+it['stem']+'-01'
        for j,view in enumerate(('front','rear')):
            k=i*2+j;x=k%4*250;y=k//4*272
            sheet.paste(panel(evidence/f'{mid}-{view}.jpg').resize((250,250)),(x,y+22))
            draw.text((x+5,y+3),it['stem']+' / '+view,font=font,fill='#242a27')
    sheet.save(evidence/f'review-front-rear-{page}.jpg',quality=88)

sheet=Image.new('RGB',(3*300,7*330),'#edece7');draw=ImageDraw.Draw(sheet)
for i,it in enumerate(items[:7]):
    mid='kominka-'+it['stem']+'-01'
    for j,view in enumerate(('front','w120-h80','w80-h120')):
        x=j*300;y=i*330
        sheet.paste(panel(evidence/f'{mid}-{view}.jpg').resize((300,300)),(x,y+28))
        draw.text((x+8,y+6),it['stem']+' / '+view,font=font,fill='#242a27')
sheet.save(evidence/'review-openings-stretch.jpg',quality=88)

sheet=Image.new('RGB',(8*192,4*218),'#edece7');draw=ImageDraw.Draw(sheet)
for i,it in enumerate(items):
    mid='kominka-'+it['stem']+'-01';x=i%8*192;y=i//8*218
    sheet.paste(panel(ROOT/'assets/models/packs/kominka/previews'/f'{mid}-top.png').resize((192,192)),(x,y+24))
    draw.text((x+4,y+4),it['stem'],font=font,fill='#242a27')
sheet.save(evidence/'review-tops.jpg',quality=88)
