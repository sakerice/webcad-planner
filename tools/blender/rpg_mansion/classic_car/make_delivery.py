"""Compose the requested overview and a minimal reusable ZIP. No render edits.

python3 tools/blender/rpg_mansion/classic_car/make_delivery.py
ZIP goes to gitignored output/classic-car/. Cache and intermediates are excluded.
"""
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
ID='rpg-mansion-classic-sedan-01'
PACK=ROOT/'assets/models/packs/rpg-mansion'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    checks=json.loads((HERE/'checks.json').read_text())
    native=json.loads((HERE/'source-checks.json').read_text())
    assert checks['status']=='passed' and native['status']=='passed'
    assert checks['source_reexport']['same_glb_sha256']
    relative=lambda path:str(path.relative_to(ROOT))
    record={
        'id':ID,'name':'洋館用クラシックセダン','packId':'rpg-mansion','provenance':'original',
        'model':relative(PACK/'models'/(ID+'.glb')),
        'thumb':relative(PACK/'previews'/(ID+'-thumb.png')),
        'top':relative(PACK/'previews'/(ID+'-top.png')),
        'sourceBlend':relative(HERE/(ID+'.blend')),
        'authoringBlend':relative(HERE/(ID+'-authoring.blend')),
        'builder':relative(HERE/'build.py'),'validation':relative(HERE/'checks.json'),
        'w':1750,'d':4600,'h':1650,'actualMeasuredDimensionsMm':checks['dimensions_mm_wdh'],
        'units':'meters','dimensionUnits':'millimeters','frontAxis':'+Z','upAxis':'+Y',
        'origin':'ground-center','defaultElevation':0,'staticProp':True,
        'finishChannels':[{'key':'body','label':'車体塗装','default':'#28493c'}],
        'triangleBudget':12000,'measuredTriangles':checks['triangles'],
        'glbBytes':checks['glb_bytes'],'nativePartCount':native['authoring_source']['mesh_parts'],
        'sha256':checks['glb_sha256'],'sourceSha256':sha(HERE/(ID+'.blend')),
        'authoringSha256':sha(HERE/(ID+'-authoring.blend')),
        'rights':{'status':'original','externalGeometry':False,'externalImages':False,'sources':[],
                  'creator':'OpenAI assistant using native Blender procedural authoring for this project',
                  'basis':'Original fictional geometry; existing repository helpers; no manufacturer logo or blueprint reproduction',
                  'attributionRequiredForExternalAssets':False},
        'deliveryStatus':'new candidate asset delivered for Draft PR review; not registered in editor',
        'placementHint':'Static passenger car on mansion driveway; front +Z; contact datum ground center',
        'browserValidation':'not performed; browser operation prohibited',
        'regeneration':checks['regeneration'],'sourceReexport':checks['source_reexport'],
        'revision':{'date':'2026-10-10','scope':'Front/rear fender terminal curls only',
                    'validation':relative(HERE/'fender-checks.json')},
    }
    (HERE/'asset-record.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n')
    font_path='/System/Library/Fonts/Avenir Next.ttc'
    def font(n):return ImageFont.truetype(font_path,n)
    canvas=Image.new('RGB',(1600,1060),'#eeeae0')
    draw=ImageDraw.Draw(canvas)
    draw.rectangle((0,0,1600,128),fill='#233e34')
    draw.text((54,27),'MANSION CLASSIC SEDAN',font=font(45),fill='#f5f0e5')
    draw.text((57,83),'Original fictional 1930s-style passenger car  /  rpg-mansion-classic-sedan-01',font=font(22),fill='#cad2c6')
    draw.line((54,597,1546,597),fill='#c7c6b9',width=2)
    def place(path,rect):
        image=Image.open(path).convert('RGBA')
        alpha=image.getchannel('A')
        box=alpha.point(lambda n:255 if n>16 else 0).getbbox()
        assert box
        image=image.crop(box)
        ratio=min((rect[2]-rect[0])/image.width,(rect[3]-rect[1])/image.height)
        image=image.resize((round(image.width*ratio),round(image.height*ratio)),Image.Resampling.LANCZOS)
        x=rect[0]+(rect[2]-rect[0]-image.width)//2
        y=rect[1]+(rect[3]-rect[1]-image.height)//2
        canvas.paste(image,(x,y),image)
    place(PACK/'previews'/(ID+'-thumb.png'),(56,154,939,565))
    draw.text((1030,167),'4.599 m  /  1.750 m  /  1.650 m',font=font(26),fill='#233e34')
    draw.text((1030,205),'LENGTH        WIDTH          HEIGHT',font=font(16),fill='#687369')
    draw.text((1030,267),f"{checks['triangles']:,} triangles",font=font(35),fill='#233e34')
    draw.text((1030,318),f"GLB {checks['glb_bytes']/1024:.0f} KiB  /  10 materials",font=font(25),fill='#4c5b50')
    draw.rectangle((1032,383,1109,438),fill='#28493c')
    draw.text((1130,384),'Recolorable body',font=font(24),fill='#233e34')
    draw.text((1130,416),'#28493c',font=font(21),fill='#687369')
    draw.text((1030,486),'FRONT +Z   /   UP +Y',font=font(23),fill='#233e34')
    draw.text((1030,529),'Ground-center origin',font=font(23),fill='#687369')
    views=[('FRONT','front',(54,650,489,922)),('SIDE','side',(535,650,1065,922)),
           ('REAR','rear',(1110,650,1546,922))]
    for label,view,rect in views:
        draw.text((rect[0],617),label,font=font(21),fill='#233e34')
        place(HERE/'evidence'/(ID+'-'+view+'.png'),rect)
    draw.line((54,963,1546,963),fill='#c7c6b9',width=2)
    draw.text((54,983),'Fender ends revised 2026-10-10  |  GLB, UV and source/replay checks passed',font=font(22),fill='#44564a')
    draw.text((54,1016),'Browser / WebGL placement test: not performed',font=font(19),fill='#687369')
    overview=HERE/'overview.png'
    canvas.save(overview,optimize=True)
    # All authored delivery files plus the exact existing helper dependencies.
    generated=[path for path in HERE.rglob('*') if path.is_file() and '__pycache__' not in path.parts]
    generated+=list((PACK/'models').glob(ID+'.glb'))
    generated+=list((PACK/'previews').glob(ID+'-*.png'))
    dependencies=[ROOT/'tools/blender'/name for name in ['model_kit.py','shape_kit.py','exterior_build.py']]
    dependencies+=[ROOT/'tools/blender/rpg_mansion/qa_asset_delivery.py',ROOT/'assets/js/model-quality.js',
                   ROOT/'assets/vendor/three/build/three.module.js',
                   ROOT/'assets/vendor/three/examples/jsm/loaders/GLTFLoader.js',
                   ROOT/'assets/vendor/three/examples/jsm/utils/BufferGeometryUtils.js']
    files=sorted(set(generated+dependencies))
    assert all(p.is_file() for p in files)
    destination=ROOT/'output/classic-car'
    destination.mkdir(parents=True,exist_ok=True)
    archive=destination/(ID+'-delivery.zip')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
        for path in files:
            bundle.write(path,relative(path))
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert not any('__pycache__' in n or n.endswith(('.blend1','.pyc')) for n in bundle.namelist())
    receipt={'overview':str(overview),'overview_bytes':overview.stat().st_size,'overview_sha256':sha(overview),
             'zip':str(archive),'zip_bytes':archive.stat().st_size,'zip_sha256':sha(archive),
             'zip_files':len(files),'zip_crc_test':'passed'}
    (destination/'local-delivery.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))


if __name__=='__main__':main()
