"""Freeze a three-prototype review allowlist; this does not accept or publish assets."""
from pathlib import Path
import sys,json,hashlib,subprocess
H=Path(__file__).resolve().parent;R=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
d=json.loads((H/'descriptors.json').read_text());native={i['id']:i for i in json.loads((H/'qa/native.json').read_text())['items']}
for it in d['items']:
 it['previewSha256']={v:sha(R/it[v])for v in ['thumb','top','front','rear']}
 it['qaInstallationEvidence']={v:{'path':str((H/'evidence'/(it['id']+'-'+v+'.png')).relative_to(R)),'sha256':sha(H/'evidence'/(it['id']+'-'+v+'.png')),'qaFixturesExcludedFromModelCount':True}for v in ['installation','section']}
 it['nativeEditableParts']=len(native[it['id']]['positive_native_part_volumes_m3']);it['status']='prototype-awaiting-independent-and-root-review'
 for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:assert it[key]==sha(R/it[field]),(it['id'],field)
write(H/'descriptors.json',d)
subprocess.run([sys.executable,str(H/'qa_bytes.py')],check=True)
gates=['bytes','native','installation','image-replay','source-privacy','baseline-delta','coplanar','normals-dedupe','exact-replay'];checks={}
for name in gates:
 p=H/'qa'/(name+'.json');v=json.loads(p.read_text());assert not v['errors'],name;checks[name]={'path':str(p.relative_to(R)),'sha256':sha(p),'errors':v['errors']}
helpers=json.loads((H/'shared-helper-hashes.json').read_text())
for item in helpers['files']:assert sha(R/item['path'])==item['sha256']
checkpoint={'status':'three-prototype snapshot ready for root visual review and independent byte certification','acceptedNewModelCount':0,'prototypeCount':3,'grossPlannedCandidates':18,'frozenAccepted171Untouched':True,'applicationAndSharedManifestChanges':False,'remoteOrDeploymentChanges':False,'complete':['Original native modeled parts and one-mesh canonical exports','Actual hollow-cavity rays and local intended-bearing endpoint probes','Actual 512px transparent four-view images with minimum 23px alpha margins','Labelled QA installation and section images; fixtures excluded from counts','Packed UV triangle overlap, positive closed components, strict corner normals','Exact source replay of geometry, UV, indices, full PBR and normals','Fresh source image replay with exact RGBA equality for all 12 product views','Compressed saved-payload and actual saved-UI privacy inspection','Actual baseline geometry delta and conservative role grouping'],'remaining':['Root visual approval of three prototypes','Independent final-byte certification','Only then begin the remaining useful water-room forms','Parent packaging and root-only Library delivery after acceptance'],'items':[{'id':i['id'],'modelSha256':i['sha256'],'sourceSha256':i['sourceSha256'],'triangles':json.loads((R/i['validation']).read_text())['triangles'],'glbBytes':(R/i['model']).stat().st_size,'nativeEditableParts':i['nativeEditableParts']}for i in d['items']],'gates':checks}
write(H/'PRODUCTION-CHECKPOINT.json',checkpoint)
paths=[]
for p in sorted(R.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(R)
 if '__pycache__'in rel.parts or p.suffix=='.pyc' or p.name in ['AGENTS.md','delivery-files.json','SHA256SUMS.txt']:continue
 if any(part in ['regenerated','pixel-replay']for part in rel.parts):continue
 paths.append({'path':str(rel),'bytes':p.stat().st_size,'sha256':sha(p)})
write(H/'delivery-files.json',{'status':'prototype review allowlist; not accepted or published','prototypeCount':3,'acceptedNewModelCount':0,'files':paths})
(H/'SHA256SUMS.txt').write_text(''.join(i['sha256']+'  '+i['path']+'\n'for i in paths))
print('WATER_PROTOTYPE_SNAPSHOT',len(paths),'files',sum(i['bytes']for i in paths),'bytes')
