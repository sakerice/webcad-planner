from pathlib import Path
import shutil,json,hashlib,sys
H=Path(__file__).resolve().parent
label=sys.argv[1]if len(sys.argv)>1 else'final-candidate-v1'
C=H/'checkpoints'/label;assert not C.exists(),C;C.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for p in sorted(H.rglob('*')):
 if not p.is_file():continue
 r=p.relative_to(H)
 if 'checkpoints'in r.parts or'__pycache__'in r.parts or p.suffix in ['.log','.blend1','.blend2']:continue
 q=C/r;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
files={str(p.relative_to(C)):dict(sha256=sha(p),bytes=p.stat().st_size)for p in sorted(C.rglob('*'))if p.is_file()}
(C/'candidate-freeze.json').write_text(json.dumps(dict(stage=label,assetCount=4,newConstructionCount=3,functionalFootprintVariantCount=1,rootVisualAcceptanceRequired=True,independentAcceptanceRequired=True,runtimeAcceptanceRequired=True,files=files),indent=2)+'\n')
for p in C.rglob('*'):
 if p.is_file():p.chmod(0o444)
for p in sorted((p for p in C.rglob('*')if p.is_dir()),key=lambda p:len(p.parts),reverse=True):p.chmod(0o555)
C.chmod(0o555)
print('IMMUTABLE_CANDIDATE',C,'files',len(files),'bytes',sum(r['bytes']for r in files.values()),'freezeSha256',sha(C/'candidate-freeze.json'))
