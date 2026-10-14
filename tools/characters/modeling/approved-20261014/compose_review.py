"""Layout native GLB-readback renders and approved own 2D references; no repainting."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
REF=REPO/'tools/characters/design/v2/candidates/attachment-style-review-20261014'
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'

def main():
    canvas=Image.new('RGB',(4000,3450),'#F4F3EE');draw=ImageDraw.Draw(canvas);inputs=[]
    def text(x,y,value,size=38,bold=False):
        draw.text((x,y),value,font=ImageFont.truetype(BOLD if bold else FONT,size),fill='#283A35')
    def place(path,box,crop=None):
        im=Image.open(path).convert('RGB');inputs.append({'file':str(path.relative_to(REPO)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'crop':crop})
        if crop:im=im.crop(crop)
        x,y,w,h=box;scale=min(w/im.width,h/im.height);im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
        canvas.paste(im,(round(x+(w-im.width)/2),round(y+h-im.height)))
    text(65,40,'WALK CHARACTERS / FIRST 3D FORM REVIEW',60,True)
    text(65,115,'Approved A designs as provisional bases. Editable local Blender meshes; static GLB readback, not animated.',36)
    for column,sex in enumerate(['male','female']):
        x=column*2000+45;id=f'walker-{sex}-home-a-preview'
        qa=json.loads((ROOT/'qa'/(id+'-glb-validation.json')).read_text())
        text(x,188,('MALE A / 172 cm' if sex=='male' else 'FEMALE A / 160 cm'),48,True)
        text(x+15,264,'Approved 2D',36);text(x+530,264,'GLB front',36);text(x+1260,264,'GLB quarter',36)
        original=REF/f'attached-{sex}-a-front.png'
        box=(275,15,950,1227) if sex=='male' else (300,23,936,1217)
        place(original,(x,310,460,970 if sex=='male' else 902),box)
        for offset,view in [(490,'front'),(1230,'three-quarter')]:
            place(ROOT/'qa/reimport'/f'{id}-{view}.png',(x+offset,300,725,970))
        text(x,1300,f"Actual mesh: {qa['height_m']:.3f} m / {qa['triangle_count']:,} triangles / {qa['head_ratio_measured']:.4f} heads",34,True)
        text(x,1370,'FACE / approved 2D',34);text(x+500,1370,'FACE / actual GLB',34)
        crop=(490,0,740,245) if sex=='male' else (500,10,745,245)
        place(original,(x+35,1420,410,570),crop)
        place(ROOT/'qa/reimport'/f'{id}-face.png',(x+500,1420,600,600))
        text(x+1140,1450,'Retained features',34,True)
        for i,line in enumerate((['Brown swept hair','Soft oval green eyes','Yellow roomy sweatshirt','White inner hem','Dark green wide trousers','Teal watch / brown mules'] if sex=='male' else ['Brown side-swept bob','Soft oval teal eyes','Ivory temple hair clip','Green roomy sweatshirt','Cream three-panel skirt','Lavender house mules'])):
            text(x+1140,1520+i*66,line,31)
    text(65,2070,'GLB SIDE / BACK - same orthographic scale and floor baseline for both heights',40,True)
    for column,(sex,view) in enumerate([('male','side'),('male','back'),('female','side'),('female','back')]):
        x=column*1000+40;text(x,2150,f'{sex.upper()} A / {view.upper()}',36,True)
        place(ROOT/'qa/reimport'/f'walker-{sex}-home-a-preview-{view}.png',(x,2205,920,1120))
    text(65,3360,'Static form only. Rig, deformation, idle/walk, animated skirt collisions and app/browser checks have not been done.',32)
    dest=ROOT/'first-3d-review.png';canvas.save(dest,optimize=True)
    result={'file':str(dest.relative_to(REPO)),'size':list(canvas.size),'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'inputs':inputs,
       'operations':['crop approved own 2D references','isotropic resize','place unpainted native GLB-readback renders','text labels'],
       'camera':'readback full-body views share 2.01m ortho scale and 1.72m framing target; face closeups have 0.46m ortho scale',
       'selection':'A/A provisional; B references remain preserved'}
    (ROOT/'qa/review-composition.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['file','size','bytes','sha256']}))

if __name__=='__main__':main()
