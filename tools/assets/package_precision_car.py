"""Package the Blender master without decimation. GLTF_TRANSFORM_BIN selects the installed CLI."""
import os,subprocess,tempfile,struct,json
from pathlib import Path
R=Path(__file__).resolve().parents[2]
cli=os.environ.get('GLTF_TRANSFORM_BIN','gltf-transform')
source=R/'tools/blender/work/quality/precision_car.glb';dest=R/'assets/models/refined/precision_car_v1.glb'
with tempfile.TemporaryDirectory() as tmp:
 a,b,c=[str(Path(tmp)/n) for n in ['dedup.glb','pruned.glb','webp.glb']]
 for args in [['dedup',str(source),a],['prune',a,b],['webp',b,c,'--lossless','true'],['draco',c,str(dest),'--quantize-position','16','--quantize-normal','14','--quantize-texcoord','14']]:subprocess.run([cli,*args],check=True)
b=dest.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);raw=(R/'tools/blender/work/quality/sources/bmw-m4.glb').read_bytes();meta=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])['asset']['extras'];j['asset']['extras']={**meta,'modifications':'Blender normalized, repainted, glazing adjusted; lossless WebP textures; Draco 16-bit positions; no geometry simplification.'};payload=json.dumps(j,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4);rest=b[20+n:];dest.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)
