"""Reproduce the four-route visual evidence sheet from delivered proof renders."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
r=Path(__file__).resolve().parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
big=ImageFont.truetype(font,29);normal=ImageFont.truetype(font,18);small=ImageFont.truetype(font,15)
im=Image.new('RGB',(1800,1970),'#f0ece2');d=ImageDraw.Draw(im)
d.text((35,20),'Four joined proofs from actual delivered GLBs',font=big,fill='#342b23')
layouts=[('straight','Straight with intermediate landing','Stair/landing proof; opening-edge guards still required'),('quarter','Quarter-turn arrangement','Stair/landing proof; opening-edge guards still required'),('return','Return arrangement','Stair/landing proof; opening-edge guards still required'),('full-straight-guarded-opening','Full flight with guarded floor opening','Actual edge guards, receiver connections and stair egress')]
for i,(slug,label,note)in enumerate(layouts):
    x=30+(i%2)*890;y=85+(i//2)*935;pic=Image.open(r/'assemblies'/slug/'assembly.png').convert('RGBA');pic.thumbnail((850,835));im.paste(pic,(x+(850-pic.width)//2,y),pic)
    d.text((x,y+845),label,font=normal,fill='#342b23');d.text((x,y+875),note,font=small,fill='#665849')
im.save(r/'evidence'/'stair-assembly-proof-sheet.png')
