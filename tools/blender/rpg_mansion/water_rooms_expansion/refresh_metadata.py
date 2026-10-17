"""Reconcile completed per-asset outputs after isolated first-build batches."""
import sys,json,hashlib
from pathlib import Path
H=Path(__file__).resolve().parent;sys.path.insert(0,str(H));import build as B
R=B.ROOT
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rel(p):return str(p.relative_to(R))
items=[];nominal={}
for s in B.SPECS:
 stem='rpg-mansion-'+s['slug']+'-01';source=H/'sources'/(stem+'.blend');auth=H/'authoring_sources'/(stem+'.blend');model=B.PACK/'models'/(stem+'.glb');vp=H/'sources'/(stem+'-validation.json')
 if not all(p.is_file()for p in [source,auth,model,vp]):continue
 v=json.loads(vp.read_text());size=[round(x,3)for x in v['dimensions_mm']];datum=v['datums'];nominal[s['slug']]=size
 item=dict(id=stem,name=s['name'],kind=s['kind'],group='住設',category='水回り',packId='rpg-mansion',model=rel(model),thumb=rel(B.PACK/'previews'/(stem+'-thumb.png')),top=rel(B.PACK/'previews'/(stem+'-top.png')),front=rel(H/'evidence'/(stem+'-front.png')),rear=rel(H/'evidence'/(stem+'-rear.png')),sourceBlend=rel(source),authoringBlend=rel(auth),validation=rel(vp),builder=rel(H/'build.py'),w=size[0],d=size[1],h=size[2],authoredNominalDimensionsMm=s['size']or size,actualMeasuredDimensionsMm=size,geometrySignature=s['signature'],triangleBudget=6000,defaultElevation=s['elevation'],provenance='original',staticProp=True,placementHint=datum['installation']['mount'],semanticCoverage=s['meaning'],dimensionBasis='Original intended design envelope. Legacy catalogue dimensions are demand references, not exact replacement or certification.',installationDatums=datum,finishChannels=[dict(key=c,label={'ceramic':'陶器','metal':'金属','wood':'木部','stone':'石材','glass':'ガラス','rubber':'ホース'}[c],default={'ceramic':'#eee9dc','metal':'#ad8745','wood':'#533728','stone':'#d9d1ba','glass':'#cbdad9','rubber':'#393c36'}[c])for c in s['channels']],sha256=sha(model),sourceSha256=sha(source),authoringSha256=sha(auth))
 items.append(item)
(H/'descriptors.json').write_text(json.dumps({'set':'rpg-mansion','name':'洋館・水回り拡張','items':items},ensure_ascii=False,indent=2)+'\n')
(H/'nominal-dimensions.json').write_text(json.dumps(nominal,indent=2)+'\n');print('REFRESHED_WATER_EXPANSION',len(items))
