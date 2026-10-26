"""Measure current issue167 front candidates, using visually checked chin regions."""
from pathlib import Path
from PIL import Image, ImageChops
import json, math

P=Path(__file__).resolve().parent/'candidates/proportion-issue167-20261014'
IDS=[f'walker-{s}-02{v}' for s in ['male','female'] for v in ['a','b','c']]
MAX_Y=[249,238,246,233,233,233]

def bbox(im):
    r,g,b=im.convert('RGB').split()
    hi=ImageChops.lighter(ImageChops.lighter(r,g),b)
    lo=ImageChops.darker(ImageChops.darker(r,g),b)
    return ImageChops.lighter(ImageChops.subtract(hi,lo).point(lambda x:255 if x>20 else 0),hi.point(lambda x:255 if x<140 else 0)).getbbox()

def main():
    rows=[]
    for i,id in enumerate(IDS):
        im=Image.open(P/(id+'-front.png')).convert('RGB');box=bbox(im);pts=[]
        for y in range(MAX_Y[i]-10,MAX_Y[i]+1):
            for x in range(605,635):
                c=im.getpixel((x,y))
                if c[0]<170 and c[1]<110 and c[2]<85 and c[0]>c[1]*1.3:pts.append((x,y))
        cy=max(x[1] for x in pts)
        pt=min((x for x in pts if x[1]==cy),key=lambda x:abs(x[0]-618))
        h=cy-box[1];f=box[3]-1-box[1];degrees=[]
        for side in [0,1]:
            xs=[]
            for y in [400,520]:
                px=[x for x in range(im.width) if (lambda c:max(c)-min(c)>20 or max(c)<140)(im.getpixel((x,y)))]
                xs.append(min(px) if side==0 else max(px))
            degrees.append(math.degrees(math.atan(abs(xs[1]-xs[0])/120)))
        row={'id':id,'crown_y':box[1],'chin_xy':list(pt),'chin_raw_rgb':list(im.getpixel(pt)),'sole_y':box[3]-1,'head_height_px':h,'full_height_px':f,'head_units':f/h,'a_pose_local_sleeve_degrees':degrees,'bbox':list(box),'measurement':'Actual pixels in visually inspected visible chin contour; sleeve slope is local2Dedge proxy, not concealed joint angle','boundary_uncertainty_px':1}
        assert 5.3<=f/h<=5.8,(id,f/h)
        assert all(30<=a<=45 for a in degrees),(id,degrees)
        rows.append(row)
        print(id,f'{f/h:.6f}',[round(a,3) for a in degrees])
    (P/'front-inspection.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
