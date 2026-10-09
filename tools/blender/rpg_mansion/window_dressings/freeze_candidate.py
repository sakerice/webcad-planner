"""Create new read-only, hash-inventoried checkpoints; never overwrite one."""
from pathlib import Path
import sys,json,hashlib,shutil
HERE=Path(__file__).resolve().parent
name=sys.argv[1];mode=sys.argv[2] if len(sys.argv)>2 else'native';target=HERE/'checkpoints'/name
assert not target.exists(),target
target.mkdir()
if mode=='native':
 names=['build.py','forms.py','common.py','helpers','build_installation_proofs.py','render_exterior_proofs.py','material_uv_evidence.py','uv_atlas_evidence.py','finalize.py','freeze_candidate.py','README.md','rights-and-provenance.json','descriptors.json','sources','authoring_sources','models']
 for name in names:
  src=HERE/name
  if src.is_dir():shutil.copytree(src,target/name,ignore=shutil.ignore_patterns('__pycache__'))
  else:shutil.copy2(src,target/name)
else:
 for src in HERE.iterdir():
  if src.name in ['checkpoints','__pycache__']:continue
  if src.is_dir():shutil.copytree(src,target/src.name,ignore=shutil.ignore_patterns('__pycache__','*.log'))
  elif src.suffix!='.log':shutil.copy2(src,target/src.name)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files={str(p.relative_to(target)):dict(sha256=sha(p),bytes=p.stat().st_size)for p in sorted(target.rglob('*'))if p.is_file()}
seal=target/'checkpoint-seal.json';seal.write_text(json.dumps(dict(stage='Immutable candidate for review; not acceptance',mode=mode,files=files),indent=2)+'\n')
for p in sorted(target.rglob('*'),reverse=True):p.chmod(0o555 if p.is_dir() else 0o444)
target.chmod(0o555)
print(json.dumps(dict(directory=str(target),sealSha256=sha(seal),fileCount=len(files),bytes=sum(i['bytes']for i in files.values()))))
