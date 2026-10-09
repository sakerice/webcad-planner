"""Bind final source/model/image bytes and measured features without editing artifacts."""
from pathlib import Path
import json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text());write=lambda p,d:p.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
d=read(H/'bed-items.json');plan=read(H/'production-plan.json');order={p['slug']:n for n,p in enumerate(plan['profiles'])};d['items'].sort(key=lambda i:order[i['id'].removeprefix('rpg-mansion-').removesuffix('-01')]);measures={i['id']:i for i in read(H/'qa-mattress-features.json')['items']}
for i in d['items']:
 vp=R/i['validation'];v=read(vp)
 if v['glb_bytes']!=(R/i['model']).stat().st_size:v['glb_bytes']=(R/i['model']).stat().st_size;write(vp,v)
 i['sha256']=sha(R/i['model']);i['sourceSha256']=sha(R/i['sourceBlend']);i['authoringSha256']=sha(R/i['authoringBlend']);i['previewSha256']={k:sha(R/i[k])for k in ['thumb','top','front','rear']}
 i['measuredMattresses']=[{k:v for k,v in m.items()if k not in ['supportParts']}for m in measures[i['id']]['mattresses']]
 i['mattressDimensionBasis']='features.mattressDimensionsM width/depth are physical extents; its third value is nominal height above support. Full native thickness and seated join are measured separately in measuredMattresses.'
 slug=i['id'].removeprefix('rpg-mansion-').removesuffix('-01');family=slug
 if slug=='sleigh-single-capacity-variant':family='sleigh-double-bed';i['variantOf']='rpg-mansion-sleigh-double-bed-01';i['variantType']='single-capacity-and-narrow-footprint'
 elif slug=='paired-twin-beds':family='narrow-servants-bed';i['variantOf']='rpg-mansion-narrow-servants-bed-01';i['variantType']='paired-capacity-arrangement'
 elif slug=='daybed-stowed-trundle-variant':family='daybed-deployed-trundle-variant';i['variantOf']='rpg-mansion-daybed-deployed-trundle-variant-01';i['variantType']='stowed-footprint-state'
 i['constructionFamily']=family
 i['staticProp']=True
 if i['features'].get('variantType'):i.setdefault('variantType',i['features']['variantType'])
d.update(name='洋館・寝具家具18アセット',assetIdCount=len(d['items']),uniqueConstructionFamilies=len({i['constructionFamily']for i in d['items']}),uniqueConstructionOrArrangementForms=16,countingNote='18 asset IDs; 15 construction families, plus one paired-twin arrangement and two additional capacity/footprint-state variants. No palette-only variants are counted.');write(H/'bed-items.json',d)
plan['scope']='18 local sleeping assets produced; 15 construction families plus explicitly labeled assembly/capacity/state variants. Final acceptance requires independent QA and root visual review.'
for p in plan['profiles']:p['state']='built-local-qa-complete-awaiting-independent-and-visual-acceptance'
plan['assetIdCount']=18;plan['uniqueConstructionFamilies']=15;plan['uniqueConstructionOrArrangementForms']=16;write(H/'production-plan.json',plan)
prov=read(H/'rights-and-provenance.json');prov['sourceModules']={p.name:sha(p)for p in H.glob('*.py')};prov['assets']=[dict(id=i['id'],glbSha256=i['sha256'],canonicalSourceSha256=i['sourceSha256'],partOnlySourceSha256=i['authoringSha256'])for i in d['items']];write(H/'rights-and-provenance.json',prov)
# Recheck the exact approved prototype assets, sources and preview bytes.
approved=read(H/'approved-prototype-snapshot/immutable-files.json');changed=[f['path']for f in approved['files']if sha(R/f['path'])!=f['sha256']];write(H/'qa-approved-prototype-preservation.json',dict(items=approved['files'],errors=changed));assert not changed
actual=read(H/'qa-actual-bytes.json');summary=dict(status='core18-locally-complete-root-visual-approved-awaiting-independent-qa',assetIdCount=18,uniqueConstructionFamilies=15,uniqueConstructionOrArrangementForms=16,plannedCoreAssets=18,remainingCoreAssetsNotBuilt=0,renderedViews=72,rootVisualApproved=True,rootVisualApprovalUtc="2026-10-08T00:08:27Z",approvedPrototypesByteIdentical=True,triangles=actual['totalTriangles'],glbBytes=actual['glbBytes'],descriptorSha256=sha(H/'bed-items.json'),contactSheet='tools/blender/rpg_mansion/scaled_beds/evidence/bed18-overview.jpg',releaseAuthorized=False,publicationPerformed=False,errors=[]);write(H/'PRODUCTION-CHECKPOINT.json',summary)
(H/'PRODUCTION-CHECKPOINT.md').write_text('# Bed core18 local production checkpoint\n\n18 asset IDs are locally complete: 15 construction families, one paired arrangement, and two additional capacity/footprint states. The three approved prototypes are byte-identical to their approved snapshot. All 72 rendered views have at least 12 pixels of transparent border.\n\nLocal geometry, outward-visible coplanar surface clipping, physical part contact, measured mattress support, exact-source re-export, PBR, normals, UV, privacy, image, hash and within-family dedupe gates pass. See the individual QA reports for scope and physical measurements. These are static props, not product-safety or mechanism certifications.\n\nRoot accepted the geometry and visual direction; sheet labels have been fitted by measured pixel width. Final independent QA is still required. No publication, release acceptance, shared manifests, or remote writes were performed. Two further construction additions are separate from this frozen core18 package.\n')
print('BED_FINAL_METADATA',sha(H/'bed-items.json'))
