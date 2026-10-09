"""Seal this nine-ID initial expansion subset and build sub-18MB local archives.
Only run after root visual acceptance and all producer byte/pixel checks pass.
Independent certification is separate and must bind this exact allowlist hash.
"""
import json,hashlib,zipfile
from pathlib import Path
H=Path(__file__).resolve().parent;ROOT=H.parents[3];OUT=ROOT.parent/'delivery';OUT.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();rel=lambda p:str(p.relative_to(ROOT))
d=json.loads((H/'descriptors.json').read_text());items=d['items'];assert len(items)==9;assert sum(i['independentConstructionCount'] for i in items)==8
reports=['all-source-privacy-qa.json','dimensions-placement-qa.json','image-framing-qa.json','image-replay-qa.json','packed-uv-overlap-qa.json','assembly-measurements-qa.json','glazing-only-change-qa.json']
for name in reports:assert not json.loads((H/name).read_text())['errors'],name
assert json.loads((H/'image-replay-qa.json').read_text())['viewCount']==42
for it in items:
 for key,digest in it['hashes'].items():assert sha(ROOT/it[key])==digest,(it['id'],key)
modules=set();evidence=set()
for it in items:
 for key in ['model','sourceBlend','authoringBlend','thumb','top','front','rear','validation']:modules.add(ROOT/it[key])
 modules.add(H/'work'/(it['id']+'-render-binding.json'))
for p in H.glob('*.py'):modules.add(p)
for name in ['README.md','RIGHTS.md','descriptors.json','production-checkpoint.json','immutable-helper-copies.json','remaining-candidates.md']+reports+['source-replay-inputs.json','assembly-replay-inputs.json']:modules.add(H/name)
modules.update((H/'review').glob('expansion-views-*.png'))
for p in [ROOT/'tools/blender/model_kit.py',ROOT/'tools/blender/shape_kit.py',ROOT/'tools/blender/exterior_build.py',H.parent/'png_metadata.py',H.parent/'qa_asset_delivery.py']:modules.add(p)
evidence.update((H/'assemblies').glob('*.blend'));evidence.update((H/'assemblies').glob('*.json'));evidence.update((H/'assemblies').glob('*.png'));evidence.add(H/'review/joined-mansard-room.png')
assert not modules&evidence
files=sorted(modules|evidence)
allow=dict(status='Root visually accepted; exact bytes sealed for independent certification',deliverableIds=[i['id'] for i in items],deliverableCount=9,independentConstructionFamilies=8,widthOnlyVariants=1,modelAndSourceFilesFrozen=True,rootVisualReview='Joined room and all three isolated-view sheets accepted by root on2026-10-08; independent gates remain separate',files=[dict(path=rel(p),sha256=sha(p),bytes=p.stat().st_size,archiveGroup='models-sources' if p in modules else 'assembly-evidence') for p in files],exclusions=['Temporary logs and scratch previews','Recreated replay GLBs/PNGs; current hash-bound replay reports and reproducible recipes are included','Python bytecode caches','Future expansion work'],sharedManifestWrites=False,remoteWrites=False)
p=H/'review-allowlist.json';p.write_text(json.dumps(allow,indent=2)+'\n');digest=sha(p)
archives=[]
for label,paths in [('models-sources',modules),('assembly-evidence',evidence)]:
 archive=OUT/('architecture-expansion9-'+label+'.zip')
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for f in sorted(paths|{p}):z.write(f,rel(f))
 assert archive.stat().st_size<18000000,(archive,archive.stat().st_size)
 archives.append(dict(path=str(archive.relative_to(ROOT.parent)),bytes=archive.stat().st_size,sha256=sha(archive)))
receipt=dict(sealedAllowlist=rel(p),sealedAllowlistSha256=digest,files=len(files),inputIds=allow['deliverableIds'],archives=archives,acceptance='Root visual acceptance recorded. Await independent certificate for exact allowlist bytes before delivery.')
(OUT/'seal-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
