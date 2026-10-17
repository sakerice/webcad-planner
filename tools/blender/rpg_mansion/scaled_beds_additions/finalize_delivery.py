"""Seal two extra construction forms separately from the immutable core18."""
from pathlib import Path
import json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];CORE=H.parent/'scaled_beds';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text());write=lambda p,d:p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
items=read(H/'bed-items.json')['items'];assert len(items)==2;ids={i['id']for i in items};measure={q['id']:q for q in read(H/'qa-mattress-features.json')['items']}
for i in items:
 vp=R/i['validation'];validation=read(vp);validation['glb_bytes']=(R/i['model']).stat().st_size;write(vp,validation)
 i['sha256']=sha(R/i['model']);i['sourceSha256']=sha(R/i['sourceBlend']);i['authoringSha256']=sha(R/i['authoringBlend']);i['previewSha256']={k:sha(R/i[k])for k in ['thumb','top','front','rear']};i['measuredMattresses']=[{k:v for k,v in m.items()if k!='supportParts'}for m in measure[i['id']]['mattresses']];i['mattressDimensionBasis']='Physical width/depth; third features value is nominal thickness above support. Full bounds and seated join are in measuredMattresses.';i['constructionFamily']=i['id'];i['staticProp']=True
 if 'barrel-vault' in i['id']:
  i['stylizedRpgFurniture']=True;i['standardBedEquivalenceVerified']=False;i['semanticCoverage']='Stylized RPG enclosed berth with three laminated semicircular load ribs, a curved timber roof, a closed arched head and an open arched foot entrance. No ordinary standard-bed equivalence is claimed.';i['dimensionBasis']='Original stylized RPG furniture with measured authored dimensions. No ordinary standard-bed equivalence is claimed.'
write(H/'bed-items.json',dict(set='rpg-mansion',name='洋館・寝具の追加構造2種',assetIdCount=2,uniqueConstructionFamilies=2,items=items))
checks=['qa-coplanar-exteriors.json','qa-actual-bytes.json','qa-native-parts.json','qa-namedpart-contact.json','qa-mattress-features.json','qa-front-axis.json','qa-uv-overlap.json','qa-pbr-reexport.json','qa-dedupe.json','source-privacy-qa.json','source-ui-cleanup-report.json','qa-image-margins.json','generic-source-qa/source-checkpoint.json']
for n in checks:
 q=read(H/n);rows=q.get('items',[])if isinstance(q,dict)else q;assert {r['id']for r in rows}==ids,n;assert not(q.get('errors')if isinstance(q,dict)else any(r['errors']for r in q)),n
 for row in rows:
  i=next(i for i in items if i['id']==row['id'])
  if n not in ['source-privacy-qa.json','source-ui-cleanup-report.json']:
   for k,ref in [('modelSha256','sha256'),('sourceSha256','sourceSha256'),('source_sha256','sourceSha256')]:
    if k in row:assert row[k]==i[ref],(n,i['id'],k)
actual=read(H/'qa-actual-bytes.json');write(H/'PRODUCTION-CHECKPOINT.json',dict(status='two-new-constructions-root-visual-approved-awaiting-independent-qa',assetIdCount=2,uniqueConstructionFamilies=2,triangles=actual['totalTriangles'],glbBytes=actual['glbBytes'],descriptorSha256=sha(H/'bed-items.json'),core18Untouched=True,rootVisualApproved=True,rootVisualApprovalUtc="2026-10-08T00:23:07Z",releaseAuthorized=False,publicationPerformed=False,errors=[]))
(H/'PRODUCTION-CHECKPOINT.md').write_text('# Two additional bed construction forms\n\nCampaign cot: four grounded X-trestle feet, brass pivot pins, long stabilizer, and taut canvas mattress support. Static deployed state; folding motion is not claimed.\n\nBarrel-vault bed, explicitly stylized RPG furniture with no ordinary standard-bed equivalence: three laminated semicircular load ribs, curved timber roof, closed arched head, raised four-pedestal plinth and an open arched foot entrance.\n\nTwo new constructions, with 8 final views and 4 compressed editable sources. All local QA gates pass. Root accepted both repaired visuals; independent QA remains pending. Core18 and all older families remain byte-frozen. No release or publication performed.\n')
write(H/'rights-and-provenance.json',dict(authoring='Original procedural Blender geometry for this project',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this repository; no separate public reuse license granted',sourceModules={p.name:sha(p)for p in H.glob('*.py')},assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]))
write(H/'qa-render-recipes.json',dict(recipe='projected-fit-v2',sourceRecipe='tools/blender/rpg_mansion/scaled_beds/build.py:render',items=[dict(id=i['id'],view=k,modelSha256=i['sha256'],imageSha256=i['previewSha256'][k])for i in items for k in ['thumb','top','front','rear']],errors=[]))
paths=set(H.glob('*.py'))
for i in items:
 for k in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']:paths.add(R/i[k])
 paths.add(H/'generic-source-qa/regenerated'/(i['id']+'.glb'))
for n in checks+['PRODUCTION-CHECKPOINT.json','PRODUCTION-CHECKPOINT.md','bed-items.json','rights-and-provenance.json','qa-render-recipes.json','generic-source-qa/source-request.json','evidence/bed-additions-overview.jpg','evidence/bed-additions-four-views.jpg']:paths.add(H/n)
for name in ['build.py','forms.py','export_contract.py']:paths.add(CORE/name)
for name in ['model_kit.py','shape_kit.py','exterior_build.py','build_decor.py']:paths.add(H.parents[1]/name)
paths.add(H.parent/'png_metadata.py')
coreseal=read(CORE/'delivery-allowlist.json');assert all(sha(R/f['path'])==f['sha256']for f in coreseal['files']),'Frozen core18 changed'
rows=[dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))for p in sorted(paths)];write(H/'delivery-allowlist.json',dict(status='two-construction-addition-root-visual-approved-awaiting-independent-qa',assetCount=2,constructionFamilies=2,releaseAuthorized=False,publicationPerformed=False,uniqueFiles=len(rows),bytes=sum(f['bytes']for f in rows),files=rows));(H/'SHA256SUMS.txt').write_text(''.join(f['sha256']+'  '+f['path']+'\n'for f in rows));print('BED_ADDITION_SEALED',len(rows),sha(H/'delivery-allowlist.json'))
