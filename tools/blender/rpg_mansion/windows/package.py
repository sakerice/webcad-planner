"""Make labelled evidence sheets and a self-contained, hash-verified delivery ZIP."""
from pathlib import Path
import json,hashlib,zipfile
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
PACK=ROOT/'assets/models/packs/rpg-mansion'
LEDGER=json.loads((HERE/'reports/asset-ledger.json').read_text())
FONT='/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc'

def font(size):
    return ImageFont.truetype(FONT,size)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cell(src,size=(620,620)):
    im=Image.open(src).convert('RGBA');im.thumbnail((size[0]-48,size[1]-48),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',size,'#48545e');out.alpha_composite(im,((size[0]-im.width)//2,(size[1]-im.height)//2));return out.convert('RGB')
def overview():
    sheet=Image.new('RGB',(1400,1540),'#f2eee7');dr=ImageDraw.Draw(sheet)
    dr.text((45,30),'洋館の窓  |  4 Original Blender Assets',font=font(36),fill='#29353c')
    dr.text((45,84),'Closed windows · Exterior +Z · Glass alpha 0.25',font=font(22),fill='#576269')
    for i,it in enumerate(LEDGER):
        x=45+(i%2)*680;y=140+(i//2)*690
        sheet.paste(cell(PACK/'previews'/(it['id']+'-thumb.png')),(x,y))
        dr.text((x,y+630),it['name']+'  '+str(it['triangles'])+' tris',font=font(24),fill='#29353c')
        dr.text((x,y+664),' × '.join(str(round(v))for v in it['dimensions_mm'])+' mm',font=font(19),fill='#576269')
    path=HERE/'evidence/overview.png';sheet.save(path)
    for it in LEDGER:
        views=[('front','屋外正面'),('rear','屋内正面'),('stretch-w120-h80','幅120% / 高さ80%'),('stretch-w80-h120','幅80% / 高さ120%'),('stretch-w130-h70','幅130% / 高さ70%'),('stretch-w70-h130','幅70% / 高さ130%')]
        proof=Image.new('RGB',(1920,1420),'#f2eee7');d=ImageDraw.Draw(proof)
        d.text((20,18),it['name']+'  |  '+it['id'],font=font(28),fill='#29353c')
        for j,(v,title)in enumerate(views):
            x=10+(j%3)*640;y=70+(j//3)*675
            proof.paste(cell(HERE/'evidence'/(it['id']+'-'+v+'.png')),(x,y))
            d.text((x,y+628),title,font=font(24),fill='#29353c')
        proof.save(HERE/'evidence'/(it['id']+'-review-sheet.jpg'),quality=94)

def package():
    delivery=HERE/'delivery';delivery.mkdir(exist_ok=True)
    # Dependencies are unchanged copies from the source main revision, included only in ZIP.
    dependencies=[ROOT/p for p in ['tools/blender/model_kit.py','tools/blender/shape_kit.py','tools/blender/exterior_build.py','assets/js/model-quality.js']]
    paths=[]
    for it in LEDGER:
        paths.append(PACK/'models'/(it['id']+'.glb'))
        paths.extend(PACK/'previews'/(it['id']+'-'+v+'.png')for v in ['thumb','top'])
    paths.extend(p for p in HERE.rglob('*')if p.is_file()and not {'__pycache__','delivery'}.intersection(p.relative_to(HERE).parts)and p.suffix not in ['.log','.blend1'])
    paths+=dependencies
    for p in paths:assert p.is_file(),p
    manifest={str(p.relative_to(ROOT)):sha(p)for p in sorted(set(paths))}
    zp=delivery/'mansion-windows-20261011.zip'
    with zipfile.ZipFile(zp,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
        for rel in manifest:z.write(ROOT/rel,rel)
        z.writestr('delivery-sha256.json',json.dumps(manifest,indent=2)+'\n')
    with zipfile.ZipFile(zp)as z:
        assert z.testzip()is None
        for rel,h in manifest.items():assert hashlib.sha256(z.read(rel)).hexdigest()==h,rel
    summary={'zipName':zp.name,'bytes':zp.stat().st_size,'sha256':sha(zp),'files':len(manifest),'allArchivedFilesHashVerified':True,'dependenciesIncludedUnchanged':{str(p.relative_to(ROOT)):sha(p)for p in dependencies},'sourceMainCommit':'a06d6db104c11114bc3e62a74f4dc37eae60216e'}
    (delivery/'package-verification.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
if __name__=='__main__':overview();package()
