"""Seal thirteen original additions for independent/root review; never publish."""
from pathlib import Path
import json,hashlib,subprocess,sys
H=Path(__file__).resolve().parent;R=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
dp=H/'descriptors.json';d=json.loads(dp.read_text());assert len(d['items'])==13
native={i['id']:i for i in json.loads((H/'qa/native.json').read_text())['items']}
for it in d['items']:
 for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:assert it[key]==sha(R/it[field]),(it['id'],field)
 it['previewSha256']={v:sha(R/it[v])for v in ['thumb','top','front','rear']}
 it['qaInstallationEvidence']={v:{'path':str((H/'evidence'/(it['id']+'-'+v+'.png')).relative_to(R)),'sha256':sha(H/'evidence'/(it['id']+'-'+v+'.png')),'qaFixturesExcludedFromModelCount':True}for v in ['installation','section']}
 it['nativeEditableParts']=len(native[it['id']]['positive_native_part_volumes_m3']);it['status']='candidate-awaiting-independent-and-root-review';it['constructionGroup']='bath'if it['kind']=='bathtub'else'washstand'if it['kind']=='vanity'else'shower-component'if it['kind']=='shower-system'else it['kind']
 if 'double-basin'in it['id']:it['capacityGroup']='Two-basin layout on a genuinely open metal console; not a recolour/resize of the single cabinet'
write(dp,d)
subprocess.run([sys.executable,str(H/'qa_bytes.py')],check=True)
subprocess.run([sys.executable,str(H/'qa_image_replay.py')],check=True)
subprocess.run([sys.executable,str(H/'qa_proof_replay.py')],check=True)
subprocess.run([sys.executable,str(H/'make_review_sheets.py')],check=True)
subprocess.run([sys.executable,str(H/'make_installation_sheets.py')],check=True)
gates=['bytes','native','cavities','intended-supports','normals-dedupe','exact-replay','coplanar','image-replay','proof-replay','source-privacy','review-sheet-bindings','installation-sheet-bindings','bath-filler-pairing','glass-marker'];checks={}
byid={i['id']:i for i in d['items']}
for name in gates:
 p=H/'qa'/(name+'.json');v=json.loads(p.read_text());assert not v['errors'],name
 for row in v.get('items',[]):
  it=byid.get(row.get('id'))
  if it is None:continue
  saved=row.get('sourceSha256',row.get('source_sha256'))
  if saved:assert saved==it['sourceSha256'],(name,it['id'],'stale source hash')
  if name=='source-privacy':assert row['sha256']==sha(R/it[row['field']])
 checks[name]={'path':str(p.relative_to(R)),'sha256':sha(p),'errors':v['errors']}
helpers=json.loads((H/'shared-helper-hashes.json').read_text())
for helper in helpers['files']:assert sha(R/helper['path'])==helper['sha256']
accepted=R.parent.parent/'water/repo';accepted_allow=accepted/'tools/blender/rpg_mansion/water_rooms/delivery-files.json';expected='88066e62599b9a6a273cd3076727dea29c69d7ea17372b9835e59db26761ed0d'
assert sha(accepted_allow)==expected
for f in json.loads(accepted_allow.read_text())['files']:assert sha(accepted/f['path'])==f['sha256'],'Accepted prototype was modified: '+f['path']
sourcecode=[H/n for n in ['build.py','bath_forms.py','basin_forms.py','shower_forms.py']]
write(H/'rights-and-provenance.json',{'authoring':'Original project-authored native Blender geometry','thirdPartyGeometry':False,'thirdPartyTextures':False,'paidGeneration':False,'license':'Original project-authored assets for this project; no separate public reuse license granted','sourceModules':[{'path':str(p.relative_to(R)),'sha256':sha(p)}for p in sourcecode],'sourceDimensionsAreExactReplacementClaims':False,'assets':[{'id':i['id'],'glbSha256':i['sha256'],'sourceSha256':i['sourceSha256'],'authoringSha256':i['authoringSha256']}for i in d['items']],'qaAssemblies':'The bath/filler proof reuses the accepted original slipper bath read-only; it does not count a second bath. Walls, floors, markers and glass controls are QA fixtures, never new models.'})
write(H/'production-plan.json',{'expansionCandidateCount':13,'acceptedExpansionCount':0,'separatelyCertifiedPrototypeCount':3,'plannedUsefulWaterFamilyCount':16,'baselineOverlapsExcluded':['Existing symmetric roll-top bath','Existing pedestal washstand','Existing low-coupled WC'],'countingPolicy':'Useful construction and installation differences only; no palette, rename, mirror or uniform-rescale copies. The double console explicitly records two-basin capacity and different metal support/storage construction.','items':[{'id':i['id'],'kind':i['kind'],'construction':i['geometrySignature'],'meaning':i['semanticCoverage']}for i in d['items']]})
checkpoint={'status':'sealed13-model expansion ready for independent certification and root visual approval','candidateCount':13,'acceptedExpansionCount':0,'separatelyCertifiedPrototypes':3,'acceptedPrototypeAllowlistSha256':expected,'acceptedPrototypeFilesUnchanged':True,'productViewExactPixelReplays':52,'installationAndSpecialProofExactPixelReplays':32,'privateSavedSourceFilesChecked':28,'allLocalGatesPass':True,'noApplicationOrRemoteWrites':True,'remaining':['Independent final-byte certification','Root visual approval','Parent packaging in ordinary ZIP parts below18,000,000 bytes','Root-only Library delivery'],'items':[{'id':i['id'],'modelSha256':i['sha256'],'sourceSha256':i['sourceSha256'],'triangles':json.loads((R/i['validation']).read_text())['triangles'],'glbBytes':(R/i['model']).stat().st_size,'nativeEditableParts':i['nativeEditableParts']}for i in d['items']],'gates':checks};write(H/'PRODUCTION-CHECKPOINT.json',checkpoint)
paths=set()
for helper in helpers['files']:paths.add(R/helper['path'])
for p in H.iterdir():
 if p.is_file()and p.suffix in ['.py','.json','.md']and p.name!='delivery-files.json':paths.add(p)
for it in d['items']:
 for field in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']:paths.add(R/it[field])
 for e in it['qaInstallationEvidence'].values():paths.add(R/e['path'])
for p in (H/'qa').glob('*.json'):paths.add(p)
for p in (H/'evidence').glob('review-*.png'):paths.add(p)
for p in (H/'evidence').glob('qa-*.png'):paths.add(p)
for p in (H/'sources').glob('qa-*.blend'):paths.add(p)
records=[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(paths)]
write(H/'delivery-files.json',{'status':'sealed candidate allowlist; no publication or acceptance implied','candidateCount':13,'acceptedExpansionCount':0,'separateAcceptedPrototypeCount':3,'files':records})
(H/'SHA256SUMS.txt').write_text(''.join(f['sha256']+'  '+f['path']+'\n'for f in records));print('WATER_EXPANSION_SEALED',len(records),'files',sum(f['bytes']for f in records),'bytes','allowlist',sha(H/'delivery-files.json'))
