"""Practical nominal envelopes and placement defaults without changing origins."""
import json
from pathlib import Path
H=Path(__file__).resolve().parent

def clarify(item):
 exact=[item.get('measuredEnvelopeMm',{}).get(k,item[k])for k in ['w','d','h']]
 item['measuredEnvelopeMm']=dict(zip(['w','d','h'],exact));nominal=[int(round(x))for x in exact]
 item['nominalEnvelopeMm']=dict(zip(['w','d','h'],nominal));item['dimensionToleranceMm']=.1
 for k,v in zip(['w','d','h'],nominal):item[k]=v
 assert max(abs(a-b)for a,b in zip(exact,nominal))<=.1
 key=item['id'].removeprefix('rpg-mansion-').removesuffix('-01');elevation={'slate-gable-span':2900,'gable-end-closure':3000,'stone-cornice-straight':3000,'stone-cornice-corner':3000}.get(key,0);item['defaultElevation']=elevation
 c=item['moduleContract'];c['defaultAssetBottomElevationMm']=elevation;c['wallTopDatumMm']=3000
 to_gltf=lambda p:[float(p[0])if p[0]else 0.0,float(p[2])if p[2]else 0.0,-float(p[1])if p[1]else 0.0]
 c['allowedAssemblyTransforms']='Rigid translation and native Blender Z-axis / exported glTF Y-axis rotations in 90-degree steps only; no mirrored or normalized scale'
 c['exportConnectionFrame']='glTF XYZ / +Y up / +Z front; asset points use the exported bottom-centre origin'
 c['axisConversion']='glTF(x,y,z) = (Blender.x, Blender.z, -Blender.y)'
 c['constructionToAssetTranslationGltfM']=to_gltf(c['constructionToAssetTranslationM'])
 for connection in c['connections']:
  connection['constructionPointGltfM']=to_gltf(connection['point'])
  connection['assetPointGltfM']=to_gltf(connection['assetPointM'])
  connection['normalGltf']=to_gltf(connection['normal'])

 if key=='slate-gable-span':
  c['placementExample']=dict(bareWallTopMm=3000,assetBottomMm=2900,bearingSeatLocalHeightMm=100,resultingBearingMm=3000,onCorniceTopMm=3240,onCorniceAssetBottomMm=3140,stackAdjustmentMm=240,explanation='Raise the roof by 240 mm when its bearing sits on a 240 mm cornice; the hollow shell eave remains 100 mm below its bearing seat.')
 elif key=='gable-end-closure':
  c['placementExample']=dict(bareWallTopMm=3000,assetBottomMm=3000,onCorniceTopMm=3240,onCorniceAssetBottomMm=3240,stackAdjustmentMm=240,explanation='Raise the fitted gable by the same 240 mm as the roof when stacking both on the cornice.')
 elif key.startswith('stone-cornice'):
  c['placementExample']=dict(bareWallOrColumnTopMm=3000,assetBottomMm=3000,assetTopMm=3240,explanation='Bottom plane bears on the 3000 mm wall or column datum. Matched roof and gable then rise by 240 mm if installed above this cornice.')
 else:c['placementExample']=dict(assetBottomMm=0,groundDatumMm=0,explanation='Place at ground level; no source-origin or scale change required.')
 return item

if __name__=='__main__':
 p=H/'descriptors.json';d=json.loads(p.read_text());d['items']=[clarify(it)for it in d['items']];p.write_text(json.dumps(d,indent=2)+'\n');print('METADATA_CLARIFIED',len(d['items']))
