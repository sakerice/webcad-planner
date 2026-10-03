"""Read reviewed .blend geometry, emit new sidecars; never save or export models.
blender -b --factory-startup --python tools/assets/rpg-pack-contract/probe_geometry.py
"""
import bpy, json, hashlib
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/models/packs/rpg-mansion-contract/v0.1.0'
PACK=ROOT/'assets/models/packs/rpg-mansion'
# This v0.1.0 probe must never overwrite reviewed sockets using an expanded pack.
manifest_path=OUT/'reviewed-manifest.json'
manifest=json.loads(manifest_path.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def gltf(v):return [float(v.x),float(v.z),float(-v.y)]
def bounds(points):return {'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}
def rounded(v):
    if isinstance(v,float):return round(v,9)
    if isinstance(v,list):return [rounded(x) for x in v]
    if isinstance(v,dict):return {k:rounded(x) for k,x in v.items()}
    return v

items=[];sockets=[];supports=[];final_validations=[]
for item in manifest['items']:
    model=ROOT/item['model'];source=ROOT/item['sourceBlend']
    bpy.ops.wm.open_mainfile(filepath=str(source))
    obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    points=[gltf(obj.matrix_world@v.co) for v in obj.data.vertices]
    box=bounds(points);size=[box['max'][i]-box['min'][i] for i in range(3)]
    assert all(abs(a-b/1000)<1e-6 for a,b in zip(size,[item['w'],item['h'],item['d']]))
    assert abs(box['min'][1])<1e-6
    record={'assetId':item['id'],'name':item['name'],'assetRevision':'sha256:'+sha(model),
            'modelPath':item['model'],'sourceBlend':item['sourceBlend'],'sourceBlendSha256':sha(source),
            'dimensionsMM':{'w':item['w'],'d':item['d'],'h':item['h']},'measuredBoundsM':box,
            'units':'metres','up':[0,1,0],'front':[0,0,1],'origin':'bottom-centre',
            'sitAssessment':'not-assessed-no-socket','socketIds':[]}
    previous=json.loads((ROOT/item['validation']).read_text())
    final_validations.append(dict(previous,glb_bytes=model.stat().st_size,
        previousPreMetadataGlbBytes=previous['glb_bytes'],modelSha256=sha(model),
        reviewedValidationPath=item['validation'],correction='Final bytes after GLB extras; reviewed source report unchanged'))
    record['finalGlbBytes']=model.stat().st_size
    if item['id'] in ['rpg-mansion-desk-01','rpg-mansion-side-table-01']:
        faces=[p for p in obj.data.polygons if p.normal.z>.999 and p.center.z>.5 and p.area>.1]
        assert faces
        face=max(faces,key=lambda p:(p.center.z,p.area))
        vertices=[gltf(obj.matrix_world@obj.data.vertices[i].co) for i in face.vertices]
        surface=bounds(vertices);centre=[(a+b)/2 for a,b in zip(surface['min'],surface['max'])]
        assert abs(surface['max'][1]-surface['min'][1])<1e-7
        supports.append({'assetId':item['id'],'assetRevision':record['assetRevision'],
            'surfaceId':'top-main','surfaceRevision':'top-surface-v1','status':'geometry-candidate-host-validation-required',
            'localSurfaceCenter':centre,'localSurfaceNormal':[0,1,0],
            'surfaceBoundsM':surface,'polygonLocalGltfM':vertices,
            'usableRegionProposal':({'shape':'disc','radiusM':.235,'note':'Inside brass inlay ring; host must test prop footprint and clearance'}
                if item['id']=='rpg-mansion-side-table-01' else {'shape':'surface-polygon','note':'Leather inset polygon; host must test prop footprint and clearance'}),
            'evidence':{'sourceBlend':item['sourceBlend'],'sourceBlendSha256':sha(source),'polygonIndex':face.index,'surfaceAreaM2':float(face.area)},
            'hostRequirements':['transform surface to world including scale, rotation and floor elevation','test support orientation, footprint containment and obstacles','place prop bottom on chosen supporting plane, not fixed 750mm']})
    if item['id']=='rpg-mansion-chair-01':
        # Identify the broad horizontal top of the low upholstered cushion,
        # excluding the higher upholstered back panel and all wooden rails.
        faces=[p for p in obj.data.polygons if obj.data.materials[p.material_index].get('finishChannel')=='fabric'
               and p.normal.z>.999 and .35<p.center.z<.65 and p.area>.05]
        assert len(faces)==1,[(p.index,p.center[:],p.area) for p in faces]
        face=faces[0];vertices=[gltf(obj.matrix_world@obj.data.vertices[i].co) for i in face.vertices]
        surface=bounds(vertices);centre=[(a+b)/2 for a,b in zip(surface['min'],surface['max'])]
        assert abs(surface['max'][1]-surface['min'][1])<1e-7
        assert surface['max'][0]-surface['min'][0]>.4
        assert surface['max'][2]-surface['min'][2]>.4
        approach=[centre[0],0,box['max'][2]+.60]
        socket={'assetId':item['id'],'socketId':'seat-main','socketRevision':'seat-surface-v1',
                'assetRevision':record['assetRevision'],'kind':'sit','status':'geometry-candidate-host-validation-required',
                'localSeatSurfaceCenter':centre,'localFrontDirection':[0,0,1],
                'actorLocalYawRadians':3.141592653589793,
                'localApproachFloorPoint':approach,
                'approachStatus':'proposed-front-floor-point-not-path-validated',
                'approachMarginFromAssetFrontM':.60,
                'seatSurfaceBoundsM':surface,'seatSurfaceNormal':[0,1,0],
                'evidence':{'sourceBlend':item['sourceBlend'],'sourceBlendSha256':sha(source),
                            'mesh':obj.name,'polygonIndex':face.index,'verticesLocalGltfM':vertices,
                            'surfaceAreaM2':float(face.area),'method':'Read single broad upward cushion polygon from reviewed Blender mesh; transform (x,y,z) to glTF (x,z,-y)',
                            'rigValidation':'not-performed','clearanceValidation':'not-performed','pathValidation':'not-performed'},
                'hostRequirements':['explicit requestSit','world transform including scale, facing correction and floor elevation',
                                    'same-floor approach within 1.25 metres','path check before reachable:true',
                                    'signature includes geometry/socket revision and placement transform',
                                    'release on signature change or asset deletion','blocked exit when no safe standing point',
                                    'TPS rig-specific pelvis alignment; no fixed pelvis offset in metadata']}
        record['sitAssessment']='measured-seat-candidate-not-runtime-authorized';record['socketIds']=['seat-main'];sockets.append(socket)
    elif item['id']=='rpg-mansion-fallen-chair-01':
        record['sitAssessment']='excluded-fallen-orientation'
    items.append(record)

OUT.mkdir(parents=True,exist_ok=True)
common={'schemaVersion':1,'sidecarVersion':'0.1.0','reviewedAssetCommit':'769f44a24e35780bbe69650706e998eef72fee87',
        'baseCommit':manifest['baseCommit'],'c072Recovery':'pending','packId':manifest['id'],
        'manifestSha256':sha(manifest_path),'editorIntegration':'none','units':'metres','coordinateSystem':'glTF +Y up, model front +Z'}
(OUT/'asset-geometry.json').write_text(json.dumps(rounded(dict(common,items=items)),ensure_ascii=False,indent=2)+'\n')
(OUT/'sit-sockets.proposal.json').write_text(json.dumps(rounded(dict(common,actorConvention='yaw 0 faces -Z; local model +Z facing corresponds to yaw pi',sockets=sockets)),ensure_ascii=False,indent=2)+'\n')
(OUT/'validation-final.json').write_text(json.dumps(dict(common,correctionScope='Final GLB byte counts only; original archive and reports retained',items=final_validations),ensure_ascii=False,indent=2)+'\n')
rules=[{'assetId':item['id'],'placementPolicy':'host-selected-support-surface','assetBottomOffsetM':0,
        'manifestDefaultElevationMM':item['defaultElevation'],'defaultElevationStatus':'legacy-hint-not-measured-support-height'}
       for item in manifest['items'] if item['placementHint']=='surface']
(OUT/'placement-surfaces.proposal.json').write_text(json.dumps(rounded(dict(common,surfaces=supports,placementRules=rules)),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(rounded({'assets':len(items),'sockets':sockets}),ensure_ascii=False,indent=2))
