"""Package review metadata and sheets. Does not install or change any repository."""
from pathlib import Path
import json,hashlib,shutil,zipfile
from PIL import Image,ImageOps,ImageDraw,ImageFont
H=Path(__file__).resolve().parent;ID='rpg-mansion-fitted-six-panel-door-1200-01'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def sheet(name,title,cells,subtitle):
    canvas=Image.new('RGB',(1920,1120),'#eee9df');d=ImageDraw.Draw(canvas);font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';f=ImageFont.truetype(font,29);small=ImageFont.truetype(font,21);d.text((40,22),title,font=f,fill='#272e2f');d.text((40,67),subtitle,font=small,fill='#4a504c')
    for i,(path,label)in enumerate(cells):
        x=30+(i%len(cells))*(1860//len(cells));w=1840//len(cells);im=Image.open(H/path).convert('RGBA');bbox=im.getchannel('A').getbbox();im=im.crop(bbox)if bbox else im;fit=ImageOps.contain(im,(w-30,870));bg=Image.new('RGBA',(w,900),'#ded9ce');bg.alpha_composite(fit,((w-fit.width)//2,(900-fit.height)//2));canvas.paste(bg.convert('RGB'),(x,110));d.text((x+12,1030),label,font=small,fill='#272e2f')
    p=H/'evidence'/name;canvas.save(p);return p
def main():
    d=json.loads((H/'descriptors.json').read_text());it=d['items'][0]
    for key in ['model','sourceBlend','exportBlend','authoringBlend','validation','thumb','top','front','rear','left','right']:it['hashes'][key]=sha(H/it[key])
    d['releaseStage']='Producer final candidate, independent certificate governs acceptance';(H/'descriptors.json').write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
    rows={r['image']:r for r in json.loads((H/'reports/render-bindings.json').read_text())}
    for p in (H/'reports/binding-rows').glob('*.json'):
        r=json.loads(p.read_text());rows[r['image']]=r
    for r in rows.values():assert sha(H/r['source'])==r['sourceSha256'];assert sha(H/r['image'])==r['imageSha256']
    (H/'reports/render-bindings.json').write_text(json.dumps(list(rows.values()),indent=2)+'\n')
    sheet('review-door-product.png','ONE fitted six-panel timber door',[(it['front'],'Front / brass rim latch'),(it['rear'],'Rear / attached knob'),(it['thumb'],'Static closed product'),(it['top'],'Plan / hardware projection')],'Timber leaf 1192 × 44 × 2384mm • Complete envelope 1343 × 220 × 2384mm • One ID / no frame or pose variants')
    sheet('review-door-installation.png','Actual accepted doorway + original fitted door',[('evidence/installed-front.png','Closed / actual GLB'),('evidence/installed-rear.png','Closed rear / actual GLB'),('evidence/manual-open-plan.png','QA-only manual 90° pose')],'Opening 1200 × 2400mm • Gaps 4 mm sides/head, 12 mm floor • Sampled pose check 0–90° / 5° increments • No native opening behavior')
    sheet('review-door-hardware.png','Hardware contact and manual pose evidence',[('evidence/hinge-contact-detail.png','Retained hinge / fixed & moving parts'),('evidence/latch-contact-detail.png','Surface keep / no jamb cut'),('evidence/manual-open-front.png','QA-only retracted bolt + leaf')],'Stationary host pieces remain fixed • Bolt retracts 35 mm before manual pose •90° passage 1060 mm • No continuous-sweep certification')
    sheet('review-door-finish-channels.png','Actual final GLB / isolated finish channels',[(f'evidence/actual-glb-finish-{k}.png',k.title())for k in ['baseline','wood','trim','metal']],'Each witness edits only the named channel after reimporting actual final GLB • Unselected material values remain identical')
    rights=dict(productIds=[ID],originalConstructionCount=1,additionalFramesAccessoriesPoses=0,externalGeometry=False,externalImages=False,externalTextureFiles=False,rightsBasis='Original procedural Blender geometry and materials created for this project',acceptedProofInputs='Existing project originals reused byte-identically; not counted as new products',sourceSnapshotHashes=json.loads((H/'inputs/accepted-input-manifest.json').read_text()))
    (H/'rights-and-provenance.json').write_text(json.dumps(rights,indent=2)+'\n')
    proof=json.loads((H/'reports/installation-proof.json').read_text());assert all(proof['checks'].values())
    files=[]
    for p in sorted(H.rglob('*')):
        rel=p.relative_to(H);parts=rel.parts
        if not p.is_file()or parts[0]in ['checkpoints','process','final-candidate']or '__pycache__'in parts or str(rel)in ['delivery-files.json','integration-copy-map.json','integration-descriptors.json']:continue
        files.append(dict(path=str(rel),sha256=sha(p),bytes=p.stat().st_size))
    prefix='tools/blender/rpg_mansion/fitted_door_closure/'
    mapping=[]
    for f in files:
        dst='assets/models/packs/rpg-mansion/'+f['path']if f['path'].startswith(('models/','previews/'))else prefix+f['path'];mapping.append(dict(source=f['path'],destination=dst,sha256=f['sha256'],bytes=f['bytes']))
    mapped=json.loads(json.dumps(d))
    for mi in mapped['items']:
        for k in ['model','thumb','top','front','rear','left','right','sourceBlend','exportBlend','authoringBlend','validation','builder']:
            mi[k]=next(r['destination']for r in mapping if r['source']==mi[k])
    (H/'integration-descriptors.json').write_text(json.dumps(mapped,indent=2,ensure_ascii=False)+'\n')
    (H/'integration-copy-map.json').write_text(json.dumps(dict(sourceRoot='Self-contained fitted-door candidate directory',destinationRoot='Repository selected by integrator',doesNotChangeFiles=True,appIntegrationAuthorized=False,files=mapping),indent=2)+'\n')
    for name in ['integration-descriptors.json','integration-copy-map.json']:
        p=H/name;files.append(dict(path=name,sha256=sha(p),bytes=p.stat().st_size))
    (H/'delivery-files.json').write_text(json.dumps(dict(schema=1,productIds=[ID],count=1,stage='Producer final candidate; awaiting external acceptance',files=files),indent=2)+'\n')
    print('FINAL_ALLOWLIST',len(files),'files')
if __name__=='__main__':main()
