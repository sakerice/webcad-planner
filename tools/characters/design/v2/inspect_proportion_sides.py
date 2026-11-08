"""Profile metrology; regions are selected from displayed visible chin contours."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from inspect_proportion_fronts import bbox
import json

P=Path(__file__).resolve().parent/'candidates/proportion-issue167-20261014'
IDS=[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
REGIONS=[(535,577,234,245),(662,697,208,223),(536,580,225,240),(535,571,218,231),(545,585,232,245),(547,575,212,235)]

def main():
    canvas=Image.new('RGB',(1800,1300),'#EEEEEE');draw=ImageDraw.Draw(canvas)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',24);rows=[]
    for i,(id,reg) in enumerate(zip(IDS,REGIONS)):
        im=Image.open(P/(id+'-side.png')).convert('RGB');box=bbox(im);pts=[]
        for y in range(reg[2],reg[3]):
            for x in range(reg[0],reg[1]):
                if max(im.getpixel((x,y)))<180:pts.append((x,y))
        assert pts,id
        cy=max(y for x,y in pts)
        pt=min((t for t in pts if t[1]==cy),key=lambda t:abs(t[0]-(reg[0]+reg[1])/2))
        head=cy-box[1];full=box[3]-1-box[1]
        row={'id':id,'view':'side','crown_y':box[1],'chin_xy':list(pt),'chin_raw_rgb':list(im.getpixel(pt)),'sole_y':box[3]-1,'head_height_px':head,'full_height_px':full,'head_units':full/head,'head_in_range':5.3<=full/head<=5.8,'measurement':'Actual visible profile jaw contour pixel displayed with red marker and visually checked; one-pixel boundary uncertainty','boundary_uncertainty_px':1}
        rows.append(row);print(id,pt,full/head,row['head_in_range'])
        crop=im.crop((480,0,780,300)).resize((600,600));x=(i%3)*600;y=(i//3)*650
        canvas.paste(crop,(x,y));xx=x+(pt[0]-480)*2;yy=y+pt[1]*2
        draw.ellipse((xx-4,yy-4,xx+4,yy+4),fill='red')
        draw.text((x+10,y+605),id+' '+f'{full/head:.5f}',font=font,fill='black')
    (P/'side-inspection.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    canvas.save(P/'side-head-check.png')

if __name__=='__main__':main()
