"""Seal ten producer candidates; independent certification is external to this snapshot."""
from pathlib import Path
import sys,json,hashlib,subprocess
H=Path(__file__).resolve().parent;R=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
d=json.loads((H/'descriptors.json').read_text());native={i['id']:i for i in json.loads((H/'qa/native.json').read_text())['items']};proofs={i['id']:i for i in json.loads((H/'qa/installation-proofs.json').read_text())['items']}
assert len(d['items'])==10
for it in d['items']:
    it['previewSha256']={v:sha(R/it[v])for v in ['thumb','top','front','rear']}
    it['qaInstallationEvidence']={v:{**row,'qaFixturesExcludedFromModelCount':True}for v,row in proofs[it['id']]['images'].items()}
    it['nativeEditableParts']=len(native[it['id']]['positive_native_part_volumes_m3']);it['status']='producer-passed-root-direction-approved-awaiting-final-independent-certificate'
    for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:assert it[key]==sha(R/it[field]),(it['id'],field)
write(H/'descriptors.json',d)
subprocess.run([sys.executable,str(H/'qa_bytes.py')],check=True)
gates=['bytes','native','local-supports','cavities','exported-installation','image-replay','proof-image-replay','source-privacy','accepted-inventory-comparison','normals-dedupe','exact-replay','glass-contrast','installation-proofs','solid-geometry','flat-faces','packed-uv'];checks={}
for name in gates:
    p=H/'qa'/(name+'.json');v=json.loads(p.read_text());assert not v['errors'],name;checks[name]=dict(path=str(p.relative_to(R)),sha256=sha(p),errors=v['errors'])
for item in json.loads((H/'shared-helper-hashes.json').read_text()):assert sha(R/item['path'])==item['sha256']
protected=json.loads((R.parent/'UNTOUCHED-NINE-CAP-REPAIR.json').read_text());assert all(sha(R/i['path'])==i['sha256']for i in protected)
write(H/'qa/unaffected-by-candle-repair.json',dict(protectedFiles=protected,protectedFileCount=len(protected),allByteIdentical=True,errors=[]))
checkpoint=dict(status='Producer gates passed; final independent certificate and root final review are separate requirements',acceptedNewModelCount=0,expansionCandidateCount=10,combinedLightingTargetCount=13,rootDirectionApprovalMinute='2026-10-08T05:47Z',independentAcceptance=False,acceptedPrototype3Unchanged=True,accepted204AndMaterials12Untouched=True,applicationChanges=False,remoteOrDeploymentChanges=False,staticDecorativeModels=True,nativeRuntimeLightObjects=0,sourceDeclaredSupportPoints=151,additionalProducerAndIndependentEarRoofPoints=2,testedSupportPointsTotal=153,qaFixturesCountAsModels=False,gates=checks,items=[dict(id=i['id'],modelSha256=i['sha256'],sourceSha256=i['sourceSha256'],triangles=json.loads((R/i['validation']).read_text())['triangles'],glbBytes=(R/i['model']).stat().st_size,nativeEditableParts=i['nativeEditableParts'])for i in d['items']])
write(H/'PRODUCTION-CHECKPOINT.json',checkpoint)
paths=[]
for p in sorted(R.rglob('*')):
    if not p.is_file():continue
    rel=p.relative_to(R)
    if '__pycache__'in rel.parts or p.suffix=='.pyc'or p.name in ['AGENTS.md','delivery-files.json','SHA256SUMS.txt']or 'WIP'in p.name:continue
    if any(part in ['regenerated','pixel-replay','proof-pixel-replay']for part in rel.parts):continue
    paths.append(dict(path=str(rel),bytes=p.stat().st_size,sha256=sha(p)))
write(H/'delivery-files.json',dict(status='Producer snapshot for final independent certification',candidateCount=10,acceptedNewModelCount=0,files=paths))
(H/'SHA256SUMS.txt').write_text(''.join(i['sha256']+'  '+i['path']+'\n'for i in paths))
assert all(sha(R/i['path'])==i['sha256']for i in paths)
print('LIGHTING_EXPANSION_FROZEN',len(paths),'files',sum(i['bytes']for i in paths),'bytes','delivery-files.json',sha(H/'delivery-files.json'),flush=True)
