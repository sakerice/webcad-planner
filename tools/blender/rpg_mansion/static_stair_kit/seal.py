"""Seal the source/GLB/evidence bundle without touching an installed catalogue."""
from pathlib import Path
import json,hashlib,subprocess,sys,zipfile
ROOT=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=ROOT/'rights-and-provenance.json';rights=json.loads(p.read_text());rights['sources']={str(p.relative_to(ROOT)):sha(p)for p in sorted(list(ROOT.glob('*.py'))+list((ROOT/'helpers').glob('*.py')))};p.write_text(json.dumps(rights,indent=2)+'\n')
subprocess.run([sys.executable,str(ROOT/'package.py')],check=True)
copy_map=json.loads((ROOT/'integration-copy-map.json').read_text());files=[dict(path=x['source'],sha256=x['sha256'],bytes=x['bytes'])for x in copy_map['files']]
files.append(dict(path='integration-copy-map.json',sha256=sha(ROOT/'integration-copy-map.json'),bytes=(ROOT/'integration-copy-map.json').stat().st_size))
manifest=dict(family='Original mansion static stair kit',stage='Sealed source and evidence for independent final certification',assetCount=10,counting=json.loads((ROOT/'descriptors.json').read_text())['counting'],productImages=40,proofImages=12,reviewSheets=2,installedProofInstances=43,applicationChanged=False,acceptedFamilyBytesModified=False,sourceDescriptorSha256=sha(ROOT/'descriptors.json'),integrationDescriptorSha256=sha(ROOT/'integration-descriptors.json'),files=sorted(files,key=lambda x:x['path']))
mp=ROOT/'delivery-manifest.json';mp.write_text(json.dumps(manifest,indent=2)+'\n')
zp=ROOT/'checkpoints'/'RPG-mansion-stair-kit-10-source-proofs-20261008.zip'
with zipfile.ZipFile(zp,'w',zipfile.ZIP_DEFLATED)as z:
    for x in manifest['files']:z.write(ROOT/x['path'],x['path'])
    z.write(mp,'delivery-manifest.json')
with zipfile.ZipFile(zp)as z:
    assert len(z.namelist())==len(manifest['files'])+1
    for x in manifest['files']:assert hashlib.sha256(z.read(x['path'])).hexdigest()==x['sha256'],x['path']
print(json.dumps(dict(archive=str(zp),bytes=zp.stat().st_size,sha256=sha(zp),members=len(manifest['files'])+1,deliveryManifestSha256=sha(mp)),indent=2))
