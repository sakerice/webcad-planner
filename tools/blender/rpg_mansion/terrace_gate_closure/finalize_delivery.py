"""Seal a self-contained candidate and explicit, non-mutating integration copy map."""
from pathlib import Path
import json,hashlib,struct,math
HERE=Path(__file__).resolve().parent
FAMILY='tools/blender/rpg_mansion/terrace_gate_closure'
PACK='assets/models/packs/rpg-mansion'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def srgb(c):return 12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055
def hexcolor(rgba):return '#'+''.join('%02x'%max(0,min(255,round(srgb(c)*255)))for c in rgba[:3])
def dest(rel):
    if rel.startswith('models/'):return PACK+'/'+rel
    if rel.startswith('previews/'):return PACK+'/'+rel
    return FAMILY+'/'+rel

def main():
    p=HERE/'descriptors.json';d=json.loads(p.read_text());integrated=[]
    labels={'wood':'木部','metal':'金属','stone':'石材','masonry':'煉瓦','ceramic':'鉢','soil':'土','foliage':'葉','flower':'花'}
    for it in d['items']:
        raw=(HERE/it['model']).read_bytes();gl=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
        primitives=[pr for m in gl['meshes']for pr in m['primitives']];materials=gl['materials'];assign=[]
        for n,m in enumerate(materials):
            prs=[pr for pr in primitives if pr.get('material')==n]
            assign.append(dict(materialIndex=n,name=m['name'],finishChannel=m.get('extras',{}).get('finishChannel'),baseColorFactor=m['pbrMetallicRoughness']['baseColorFactor'],baseColorHex=hexcolor(m['pbrMetallicRoughness']['baseColorFactor']),triangles=sum(gl['accessors'][pr['indices']]['count']//3 for pr in prs),primitiveCount=len(prs)))
        it['materialCount']=len(materials);it['materialPrimitiveCount']=len(primitives);it['materialAssignments']=assign
        it['previewSha256']={v:sha(HERE/it[v])for v in ['thumb','top','front','rear']}
        assert it['sha256']==sha(HERE/it['model'])
        assert it['sourceSha256']==sha(HERE/it['sourceBlend'])
        assert it['authoringSha256']==sha(HERE/it['authoringBlend'])
        assert sum(m['triangles']for m in assign)==it['triangles']
        out=json.loads(json.dumps(it))
        for field in ['model','sourceBlend','authoringBlend','validation','attachments','builder','thumb','top','front','rear']:out[field]=dest(it[field])
        out.update(group='外構',category='庭・テラスと門扉',assetSet='rpg-mansion',defaultElevation=it['installationDatums'].get('defaultElevationMm',0),placementHint=it['installationDatums']['installation']['mount'],dimensionBasis='Original intended native design; measured authored envelope, not historic product equivalence or structural certification.',geometrySignature=it['id'].removeprefix('rpg-mansion-garden-').removesuffix('-01'),status='candidate-awaiting-independent-acceptance')
        out['finishChannels']=[]
        for channel in it['finishChannels']:
            primary=max([m for m in assign if m['finishChannel']==channel],key=lambda m:m['triangles'])
            out['finishChannels'].append(dict(key=channel,label=labels[channel],default=primary['baseColorHex']))
        integrated.append(out)
    p.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
    (HERE/'integration-descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',name='洋館・テラスと門扉',assetSet='rpg-mansion',sourceDescriptorSha256=sha(p),items=integrated),ensure_ascii=False,indent=2)+'\n')
    sources={str(p.relative_to(HERE)):sha(p)for p in sorted(HERE.rglob('*.py'))if '__pycache__'not in str(p) and 'checkpoints' not in p.parts}
    rights=dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,externalDownloads=False,paidGeneration=False,license='Original project-authored assets for this project; no separate public reuse license granted',reconstructionNotice='Two new core constructions: supported terrace and gate leaf. One fitted strike receiver counts zero core. Five accepted input products and all explicitly marked QA hosts are excluded from new counts.',sources=sources,assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in d['items']])
    (HERE/'rights-and-provenance.json').write_text(json.dumps(rights,indent=2)+'\n')
    summary=dict(deliveredIds=len(d['items']),historicalReconstructionIds=0,newCoreConstructions=2,zeroCoreAccessories=1,totalCoreConstructionsInThisPackage=2,historicalAccounting='Accepted dependencies add zero new IDs or constructions.',glbBytes=sum(i['glbBytes']for i in d['items']),triangles=sum(i['triangles']for i in d['items']),materialPrimitives=sum(i['materialPrimitiveCount']for i in d['items']),perAsset=[{k:i[k]for k in ['id','triangles','triangleBudget','glbBytes','materialPrimitiveCount','actualMeasuredDimensionsMm']}for i in d['items']],installationChecks=[json.loads(p.read_text())for p in sorted((HERE/'installation_proofs').glob('*-report.json'))])
    assert len(summary['installationChecks'])==3 and all(r['passed']for r in summary['installationChecks'])
    contact=json.loads((HERE/'reports/producer-source-contact-audit.json').read_text());assert contact['passed'];summary['producerContactAudit']=contact
    summary['acceptanceStatus']='Unaccepted candidate requiring coordinator visual gate and independent QA'
    (HERE/'reports'/'measured-delivery-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    files=[]
    for p in sorted(HERE.rglob('*')):
        if 'checkpoints' in p.parts or '__pycache__' in p.parts:continue
        if not p.is_file()or p.suffix in ['.log','.pyc']or p.name in ['delivery-files.json','integration-copy-map.json']:continue
        rel=str(p.relative_to(HERE));files.append(dict(path=rel,bytes=p.stat().st_size,sha256=sha(p)))
    mapping=dict(sourceRoot='Self-contained terrace and gate delivery directory',destinationRoot='Repository root selected by integrator',doesNotChangeFiles=True,appIntegrationAuthorized=False,notes='Use the copy map explicitly. Models and catalogue previews go to standard pack paths; source/evidence go under the terrace and gate family. Generators are run from the self-contained delivery directory. No accepted baseline file is overwritten by this tool.',files=[dict(source=f['path'],destination=dest(f['path']),sha256=f['sha256'],bytes=f['bytes'])for f in files])
    (HERE/'integration-copy-map.json').write_text(json.dumps(mapping,indent=2)+'\n')
    p=HERE/'integration-copy-map.json';files.append(dict(path=p.name,bytes=p.stat().st_size,sha256=sha(p)))
    (HERE/'delivery-files.json').write_text(json.dumps(dict(stage='candidate-awaiting-independent-acceptance',files=files,totalFiles=len(files),totalBytes=sum(f['bytes']for f in files)),indent=2)+'\n')
    print(json.dumps({k:summary[k]for k in ['deliveredIds','glbBytes','triangles','materialPrimitives']},indent=2))
if __name__=='__main__':main()
