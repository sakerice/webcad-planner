"""Finalize local review package without touching any accepted asset or app tree."""
from pathlib import Path
import json,hashlib,copy,shutil
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11)

def sheet(rows,columns,name,cell=240):
    im=Image.new('RGB',(len(columns)*cell,len(rows)*(cell+45)+50),'#eeebe4');d=ImageDraw.Draw(im)
    for i,title in enumerate(columns):d.text((i*cell+10,12),title,font=font,fill='#3f423f')
    for r,(title,paths)in enumerate(rows):
        for c,path in enumerate(paths):
            image=Image.open(HERE/path).convert('RGBA');image.thumbnail((cell-10,cell-10))
            xy=(c*cell+(cell-image.width)//2,50+r*(cell+45)+(cell-image.height)//2);im.paste(image,xy,image)
            d.text((c*cell+8,50+r*(cell+45)+cell),title,font=small,fill='#252b29')
    im.save(HERE/'evidence'/name)

D=json.load(open(HERE/'descriptors.json'))
ORDER=['short-paired-curtain','full-height-traverse-drape','roman-batten-shade','timber-venetian-blind','narrow-roller-screen']
D['items'].sort(key=lambda it:ORDER.index(it['id'].removeprefix('rpg-mansion-').removesuffix('-01')))
for it in D['items']:
    it['glbBytes']=(HERE/it['model']).stat().st_size
    it['triangleBudget']=12000 if it['kind']=='curtain' else 6000
    it['triangleBudgetRationale']='Thick pleated fabric with modeled sewn hems and native attachment hardware;12000 cap preserves meaningful folds/rings.'if it['kind']=='curtain'else'Screen hardware and repeated slats fit the standard6000-triangle envelope.'
    # Report measured hardware envelope separately from nominal cloth coverage.
    dt=it['installationDatums'];lo,hi=dt['originalInstalledBoundsBlenderM'];dt['fit'].pop('coverageHeightRangeMm',None);dt['fit']['measuredHardwareEnvelopeHeightRangeMm']=[round(lo[2]*1000,3),round(hi[2]*1000,3)]
    it['hashes']={f:sha(HERE/it[f])for f in ['model','sourceBlend','authoringBlend','validation','builder','thumb','top','front','rear','left','right']}
    it['rights']=dict(status='original',creator='Original native Blender procedural construction for this project',externalGeometry=False,externalImages=False,paidGeneration=False,sources=[])
    it['dimensionBasis']='Measured final exported envelope, not a nominal product name or a legacy substitution.'
    it['finishIsolationEvidence']='Exported material primitives carry separate finishChannel values; numeric and visual checks are in reports and evidence.'
(HERE/'descriptors.json').write_text(json.dumps(D,indent=2)+'\n')
rights=dict(status='original',authoring='All five dressings constructed in Blender from project-authored procedural geometry.',thirdPartyModels=False,thirdPartyTextures=False,paidGeneration=False,existingInputs='Only byte-identical accepted project window/curtain GLBs are imported in installation proof scenes; these are not new products.',licenseBasis='Original work produced for this project; no additional public reuse license stated.',newConstructionCount=5,variantCount=0,accessoryOnlyCount=0,excludedFixtureCount=2)
(HERE/'rights-and-provenance.json').write_text(json.dumps(rights,indent=2)+'\n')
rows=[(it['name'],[it[v]for v in ['thumb','front','rear','left','right','top']])for it in D['items']]
sheet(rows,['Three-quarter','Front','Rear / supports','Left','Right','Top'],'window-dressings-all-sides.png',220)
P=json.load(open(HERE/'reports/installation-proofs.json'))
rows=[]
for it in P['items']:
    stem=Path(it['scene']).stem;label='Existing curtain / QA1900mm'if it['id']=='existing-curtain-reuse'else it['id'].removeprefix('rpg-mansion-').removesuffix('-01')
    if it.get('hostExcludedFromProductCount'):label+=' / QA640mm'
    rows.append((label,['evidence/'+stem+'-'+v+'.png'for v in ['interior-front','interior-side','exterior-front']]))
sheet(rows,['Interior closed/deployed','Interior support/clearance','Accepted exterior / QA fixture'],'window-dressings-installation-proofs.png',290)
base='tools/blender/rpg_mansion/window_dressings/'
def dest(p):
    if p.startswith('models/'):return 'assets/models/packs/rpg-mansion/'+p
    if p.startswith('previews/'):return 'assets/models/packs/rpg-mansion/'+p
    return base+p
I=copy.deepcopy(D);I.update(name='洋館・窓まわり',sourceDescriptorSha256=sha(HERE/'descriptors.json'))
for it in I['items']:
    for f in ['model','sourceBlend','authoringBlend','validation','builder','thumb','top','front','rear','left','right']:it[f]=dest(it[f])
(HERE/'integration-descriptors.json').write_text(json.dumps(I,indent=2)+'\n')
files=[]
for p in sorted(HERE.rglob('*')):
    if not p.is_file():continue
    rel=p.relative_to(HERE)
    if 'checkpoints'in rel.parts or '__pycache__'in rel.parts or p.suffix=='.log'or p.name in ['integration-copy-map.json','CHECKSUMS.json']:continue
    files.append(dict(source=str(rel),destination=dest(str(rel)),sha256=sha(p),bytes=p.stat().st_size))
(HERE/'integration-copy-map.json').write_text(json.dumps(dict(sourceRoot='Self-contained window dressings candidate',destinationRoot='Repository root chosen by integrator',doesNotChangeFiles=True,appIntegrationAuthorized=False,newConstructionCount=5,files=files),indent=2)+'\n')
(HERE/'CHECKSUMS.json').write_text(json.dumps({str(p.relative_to(HERE)):sha(p)for p in HERE.rglob('*')if p.is_file()and'checkpoints'not in p.parts and'__pycache__'not in p.parts and p.suffix!='.log'and p.name!='CHECKSUMS.json'},indent=2)+'\n')
print('FINALIZED',len(D['items']),'items',len(files),'copy-map files')
