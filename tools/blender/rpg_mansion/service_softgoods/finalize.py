from pathlib import Path
import json,hashlib,copy
from PIL import Image,ImageDraw,ImageFont
H=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11)
LABELS={'period-range-canopy':'Period range canopy','manual-wash-tub-board':'Wash tub and board','hinged-timber-drying-frame':'Deployed drying frame','narrow-hall-runner':'Fitted hall runner (variant)'}
def sheet(rows,cols,name,cell=240):
 im=Image.new('RGB',(len(cols)*cell,len(rows)*(cell+38)+45),'#eeebe4');dr=ImageDraw.Draw(im)
 for i,c in enumerate(cols):dr.text((i*cell+9,12),c,font=font,fill='#343c37')
 for r,(label,paths)in enumerate(rows):
  for c,p in enumerate(paths):
   q=Image.open(H/p).convert('RGBA');q.thumbnail((cell-12,cell-12));xy=(c*cell+(cell-q.width)//2,45+r*(cell+38)+(cell-q.height)//2);im.paste(q,xy,q);dr.text((c*cell+8,45+r*(cell+38)+cell),label,font=small,fill='#28332b')
 im.save(H/'evidence'/name)
D=json.loads((H/'descriptors.json').read_text());D['items'].sort(key=lambda i:list(LABELS).index(i['id'].removeprefix('rpg-mansion-').removesuffix('-01')))
for it in D['items']:
 for key in ['model','sourceBlend','authoringBlend','validation','builder','thumb','top','front','rear','left','right','under']:assert(H/it[key]).is_file(),(it['id'],key)
 if it['kind']=='range-hood':
  shift=it['installationDatums']['bottomCenterTranslationBlenderM'];it['installationPoseRelativeToAcceptedRangeGltfM']=[-shift[0],-shift[2],shift[1]];it['placementNotes']=it['installationDatums']['staticLimit']+' Align to the accepted range with the canonical hood origin offset X0mm, Y1610mm up, Z29mm toward the room; rear plates then meet the wall35mm behind the range back.'
 it['glbBytes']=(H/it['model']).stat().st_size;it['dimensionBasis']='Measured final exported envelope in millimetres; no assumed equivalence to legacy geometry.'
 it['rights']=dict(status='original',thirdPartyMeshes=False,thirdPartyImages=False,paidGeneration=False,sources=[])
 it['triangleBudgetRationale']='Explicit6000 maximum; repeated physical fasteners, hollow basin and tubular joinery preserve construction. The rug is below3000.'
 it['hashes']={k:sha(H/it[k])for k in ['model','sourceBlend','authoringBlend','validation','builder','thumb','top','front','rear','left','right','under']}
D['acceptanceStatus']='Producer candidate; root visual and independent acceptance required';(H/'descriptors.json').write_text(json.dumps(D,indent=2)+'\n')
rows=[]
for it in D['items']:
 slug=it['id'].removeprefix('rpg-mansion-').removesuffix('-01');rows.append((LABELS[slug],[it[x]for x in ['thumb','front','rear','left','right','top','under']]))
sheet(rows,['Three-quarter','Front','Rear','Left','Right','Top','Underside'],'service-softgoods-all-sides.png',220)
P=json.loads((H/'reports/installation-proofs.json').read_text());rows=[(r['id'],['evidence/'+r['id']+'-'+v+'.png'for v in ['scene','scene-top','front']])for r in P['items']];sheet(rows,['Installed view','Plan / footprints','Front / clearances'],'service-softgoods-installed-scenes.png',310)
rows=[(LABELS[i['id'].removeprefix('rpg-mansion-').removesuffix('-01')],[i['thumb'],'evidence/'+i['id']+'-finish-channels.png'])for i in D['items']];sheet(rows,['Original finish','False-color channel witness'],'service-softgoods-material-channels.png',260)
rights=dict(status='original',assetCount=4,newConstructionCount=3,functionalFootprintVariantCount=1,authoring='All four geometries created from original Blender primitives/procedural meshes and original flat PBR materials for this project.',externalAssets=False,externalTextures=False,paidGeneration=False,acceptedGeometryReuse='Byte-identical project originals appear only as excluded accepted fixtures in proof scenes.',licenseBasis='Project-owner distribution terms; no new public license invented.',oldAssetsModified=False)
(H/'rights-and-provenance.json').write_text(json.dumps(rights,indent=2)+'\n')
contract=dict(schema='period-service-construction-v1',newProductCount=4,newConstructionCount=3,functionalFootprintVariantCount=1,staticOnly=True,items=[dict(id=i['id'],countingClass=i['countingClass'],coreConstructionCount=i['coreConstructionCount'],variantOf=i['variantOf'],measuredEnvelopeMm=[i[k]for k in ['w','d','h']],installation=i['installationDatums'])for i in D['items']],modernOptionalGaps=json.loads((H/'reports/existing-oven-bedding-audit.json').read_text())['decision']['modernGaps'])
(H/'CONSTRUCTION-CONTRACT.json').write_text(json.dumps(contract,indent=2)+'\n')
base='tools/blender/rpg_mansion/service_softgoods/'
def dest(p):return('assets/models/packs/rpg-mansion/'+p)if p.startswith(('models/','previews/'))else base+p
I=copy.deepcopy(D);I['name']='洋館・家事道具と廊下敷物';I['sourceDescriptorSha256']=sha(H/'descriptors.json')
for it in I['items']:
 for key in ['model','sourceBlend','authoringBlend','validation','builder','thumb','top','front','rear','left','right','under']:it[key]=dest(it[key])
(H/'integration-descriptors.json').write_text(json.dumps(I,indent=2)+'\n')
files=[]
for p in sorted(H.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(H)
 if 'checkpoints'in rel.parts or'__pycache__'in rel.parts or p.suffix in ['.log','.blend1','.blend2']or p.name in ['integration-copy-map.json','CHECKSUMS.json']:continue
 files.append(dict(source=str(rel),destination=dest(str(rel)),sha256=sha(p),bytes=p.stat().st_size))
(H/'integration-copy-map.json').write_text(json.dumps(dict(sourceRoot='Self-contained period service and softgoods candidate',destinationRoot='Review repository chosen by integrator',doesNotChangeFiles=True,appIntegrationAuthorized=False,newConstructionCount=3,functionalFootprintVariantCount=1,files=files),indent=2)+'\n')
(H/'CHECKSUMS.json').write_text(json.dumps({str(p.relative_to(H)):sha(p)for p in H.rglob('*')if p.is_file()and'checkpoints'not in p.parts and'__pycache__'not in p.parts and p.suffix not in ['.log','.blend1','.blend2']and p.name!='CHECKSUMS.json'},indent=2)+'\n')
print('FINALIZED',len(D['items']),len(files))
