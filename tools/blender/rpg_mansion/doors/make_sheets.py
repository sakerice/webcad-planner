"""Assemble the final concise review sheets from headless renders (Pillow).

python tools/blender/rpg_mansion/doors/make_sheets.py
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
IDS=['rpg-mansion-door-six-panel-01','rpg-mansion-door-glazed-01',
     'rpg-mansion-door-ledged-01','rpg-mansion-entrance-door-01','rpg-mansion-entrance-door-glazed-01']
NAMES=['6枚パネルの室内ドア','格子ガラスの室内ドア','板張りの納戸の扉','重厚な玄関ドア','ステンドグラス玄関ドア']


def sheet(path,columns,rows,files,labels,cell=(360,400)):
    w,h=cell
    out=Image.new('RGB',(columns*w,rows*h),'#e7e6e2')
    d=ImageDraw.Draw(out)
    font_path=Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    font=ImageFont.truetype(str(font_path),17) if font_path.exists() else ImageFont.load_default()
    for i,(file,label) in enumerate(zip(files,labels)):
        im=Image.open(file).convert('RGBA')
        im.thumbnail((w,h-28))
        x=(i%columns)*w;y=(i//columns)*h
        out.paste(im,(x+(w-im.width)//2,y+28),im)
        d.text((x+7,y+5),label,font=font,fill='#222222')
    path.parent.mkdir(parents=True,exist_ok=True)
    out.save(path,quality=90,subsampling=0)


if __name__=='__main__':
    files=[];labels=[]
    for side in ('front','rear'):
        for stem,name in zip(IDS,NAMES):
            files.append(HERE/'evidence'/(stem+'-'+side+'.jpg'))
            labels.append(name+' / '+('正面' if side=='front' else '背面'))
    sheet(HERE/'evidence'/'doors-front-rear.jpg',5,2,files,labels)
    files=[];labels=[]
    for variation in ('glb-front','wide-short','narrow-tall'):
        for stem,name in zip(IDS,NAMES):
            files.append(Path('/tmp/webcad-door-proofs')/(stem+'-'+variation+'.jpg'))
            labels.append(name+' / '+{'glb-front':'GLB','wide-short':'幅120% 丈80%','narrow-tall':'幅80% 丈120%'}[variation])
    sheet(HERE/'evidence'/'doors-glb-stretch.jpg',5,3,files,labels)
    roof=HERE.parents[1]/'roof_textures'
    keys=['roof_kawara_ibushi','roof_s_tile_terracotta','roof_flat_tile_charcoal',
          'roof_colonial_gray','roof_standing_seam_silver','roof_copper_patina','roof_asphalt_shingle_brown']
    sheet(roof/'pbr-review.jpg',2,4,[Path('/tmp/webcad-roof-proofs')/(k+'.jpg') for k in keys],keys,(600,630))
