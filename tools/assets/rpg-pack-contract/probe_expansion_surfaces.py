"""Read delivered GLB triangles for six explicitly audited assets. Never write models."""
import sys,json,hashlib,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/blender/rpg_mansion'))
from test_pack import glb
PACK=ROOT/'assets/models/packs/rpg-mansion';OUT=ROOT/'assets/models/packs/rpg-mansion-contract/v0.2.0';OUT.mkdir(exist_ok=True)
m=json.loads((PACK/'manifest.json').read_text());items={i['id']:i for i in m['items']}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(points):return {'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}
def planes(item,channel,lo,hi):
 j,read=glb(ROOT/item['model']);assert all(not any(k in n for k in ['matrix','translation','rotation','scale']) for n in j['nodes'])
 groups={}
 for mi,mesh in enumerate(j['meshes']):
  for pi,p in enumerate(mesh['primitives']):
   if j['materials'][p['material']].get('extras',{}).get('finishChannel')!=channel:continue
   xyz=read(p['attributes']['POSITION']);idx=[i[0] for i in read(p['indices'])]
   for k in range(0,len(idx),3):
    tri=[xyz[i] for i in idx[k:k+3]];a,b,c=tri
    area=((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2
    if area<=1e-8 or max(p[1] for p in tri)-min(p[1] for p in tri)>1e-7 or not lo<a[1]<hi:continue
    group=groups.setdefault(round(a[1],7),{'triangles':[],'area':0,'refs':[]});group['triangles'].append(tri);group['area']+=area;group['refs'].append({'mesh':mi,'primitive':pi,'triangle':k//3})
 assert groups,item['id'];return max(groups.values(),key=lambda g:g['area'])
def measured(item,channel,lo,hi):
 p=planes(item,channel,lo,hi);verts=list({tuple(v) for t in p['triangles'] for v in t});b=bounds(verts)
 # These reviewed top faces are rectangles. Verify their triangles cover the entire region.
 assert abs(p['area']-(b['max'][0]-b['min'][0])*(b['max'][2]-b['min'][2]))<1e-6
 center=[(a+b)/2 for a,b in zip(b['min'],b['max'])];poly=[[b['min'][0],center[1],b['min'][2]],[b['max'][0],center[1],b['min'][2]],[b['max'][0],center[1],b['max'][2]],[b['min'][0],center[1],b['max'][2]]]
 return b,center,poly,{'modelPath':item['model'],'modelSha256':sha(ROOT/item['model']),'sourceBlend':item['sourceBlend'],'sourceBlendSha256':sha(ROOT/item['sourceBlend']),'method':'Explicit audited component role; upward GLB triangles filtered by finish channel and bounded height, full rectangle area verified; not bounding-box top','channel':channel,'selectionHeightRangeM':[lo,hi],'triangles':p['refs'],'trianglesLocalGltfM':p['triangles'],'surfaceAreaM2':p['area'],'rigValidation':'not-performed','clearanceValidation':'not-performed','pathValidation':'not-performed'}
common={'schemaVersion':1,'sidecarVersion':'0.2.0','baseSidecarVersion':'0.1.0','coverage':'Additional six representatives; merge by assetId and preserve v0.1.0 records','reviewedAssetCommit':'d7a89c65a370146b74ecb8c5c8da670b41fce247','packId':'rpg-mansion','manifestSha256':sha(PACK/'manifest.json'),'editorIntegration':'fixture-only; TPS host integration pending','units':'metres','coordinateSystem':'glTF +Y up, model front +Z'}
seats=[];surfaces=[];geometry=[]
for slug in ['wing-chair','stool','sofa','dining-table','coffee-table','secretary']:
 item=items['rpg-mansion-'+slug+'-01'];j,read=glb(ROOT/item['model']);allpts=[v for mesh in j['meshes'] for p in mesh['primitives'] for v in read(p['attributes']['POSITION'])];box=bounds(allpts);rev='sha256:'+sha(ROOT/item['model'])
 geometry.append({'assetId':item['id'],'assetRevision':rev,'modelPath':item['model'],'dimensionsMM':{k:item[k] for k in ['w','d','h']},'measuredBoundsM':box,'units':'metres','up':[0,1,0],'front':[0,0,1],'origin':'bottom-centre','socketIds':['seat-main'] if slug in ['wing-chair','stool','sofa'] else []})
 if slug in ['wing-chair','stool','sofa']:
  b,c,poly,e=measured(item,'fabric',.45,.65);fb,fc,fp,fe=measured(item,'wood',.35,.43)
  seats.append({'assetId':item['id'],'socketId':'seat-main','socketRevision':'seat-surface-v1','assetRevision':rev,'kind':'sit','status':'geometry-candidate-host-validation-required','localSeatSurfaceCenter':c,'localFrontDirection':[0,0,1],'actorLocalYawRadians':math.pi,'localApproachFloorPoint':[c[0],0,box['max'][2]+.6],'approachStatus':'proposed-front-floor-point-not-path-validated','approachMarginFromAssetFrontM':.6,'seatSurfaceBoundsM':b,'seatSurfaceNormal':[0,1,0],'seatPolygonLocalGltfM':poly,'seatFrameReference':{'role':'wood rail top; NOT actor seat or pelvis','localCenter':fc,'boundsM':fb,'evidence':fe},'evidence':e,'hostRequirements':['explicit requestSit','world transform including actual editor effective height, scale, rotation and floor elevation','same-floor approach within 1.25 metres; host path/obstacle/exit checks required','signature includes asset/socket revisions and full placement including conversion height v2','release on signature change or deletion','TPS rig-specific pelvis alignment; seat surface is not pelvis root','single conservative centre socket; no inferred sofa multi-seat slots']})
 else:
  lo,hi=(.96,1.01) if slug=='secretary' else ((.775,.79) if slug=='dining-table' else (.447,.46))
  b,c,poly,e=measured(item,'fabric' if slug=='secretary' else 'wood',lo,hi)
  surfaces.append({'assetId':item['id'],'assetRevision':rev,'surfaceId':'top-main','surfaceRevision':'top-surface-v1','status':'geometry-candidate-host-validation-required','localSurfaceCenter':c,'localSurfaceNormal':[0,1,0],'surfaceBoundsM':b,'polygonLocalGltfM':poly,'usableRegionProposal':{'shape':'surface-polygon','note':'Host must inset by actual prop footprint and check obstacles; secretary writing board excludes pigeonhole top'},'evidence':e,'hostRequirements':['use editor effective height, not stored item.h or 750mm hint','transform polygon to world and normal by inverse transpose','test prop footprint containment, collisions and horizontal support','place prop bottom on measured plane; no automatic plan mutation']})
for filename,key,rows in [('sit-sockets.proposal.json','sockets',seats),('placement-surfaces.proposal.json','surfaces',surfaces),('asset-geometry.json','items',geometry)]:
 data={**common,key:rows}
 if key=='sockets':data['actorConvention']='yaw 0 faces -Z; local model +Z facing corresponds to yaw pi'
 if key=='surfaces':data['placementRules']=json.loads((OUT.parent/'v0.1.0/placement-surfaces.proposal.json').read_text())['placementRules']
 (OUT/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Measured GLB seats:',[(s['assetId'],s['localSeatSurfaceCenter'][1]) for s in seats]);print('Measured GLB surfaces:',[(s['assetId'],s['localSurfaceCenter'][1]) for s in surfaces])
