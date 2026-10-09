"""Namespaced adaptation of frozen export loop. Executed only in expansion_common namespace."""
def main():
 global P,PARTS
 WORK.mkdir(parents=True,exist_ok=True);(PACK/'previews').mkdir(parents=True,exist_ok=True);only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
 for item in PLAN:
  key=item['key'];stem='rpg-mansion-'+key+'-01'
  if only and key not in only:continue
  for s in list(bpy.data.scenes):
   if s!=bpy.context.scene:bpy.data.scenes.remove(s)
  kit.clear_scene();native=bpy.context.scene;native.name='Native authoring parts';native.unit_settings.system='METRIC';native.unit_settings.scale_length=1;PARTS=[];P=palette();item['builder']();bpy.context.view_layer.update()
  lo,hi,dims=bounds(PARTS);offset=Vector((-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]))
  for ob in PARTS:
   for v in ob.data.vertices:v.co+=offset
   ob.data.update();repair_mesh_winding(ob);metric_atlas(ob)
  lo,hi,dims=bounds(PARTS);native['sourceAsset']=stem;native['front']='Blender -Y / glTF +Z';native['constructionDatumTranslationM']=list(offset);native['originalStaticGeometry']=True
  native_count=len(PARTS);bpy.context.preferences.filepaths.save_version=0;sanitize_loaded(stem);author=WORK/(stem+'-authoring.blend');bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
  canonical=bpy.data.scenes.new('Canonical active export');canonical.unit_settings.system='METRIC';canonical.unit_settings.scale_length=1;clones=[]
  for part in PARTS:
   ob=part.copy();ob.data=part.data.copy();canonical.collection.objects.link(ob);clones.append(ob)
  bpy.context.window.scene=canonical;obj=kit.combine(clones);obj.name=stem;metric_atlas(obj);winding=repair_mesh_winding(obj,repair=False);uv=kit.uv_report(obj);tris=kit.tri_count(obj)
  assert tris<6000,(stem,tris);assert not uv['degenerate_world'] and not uv['degenerate_uv'];assert all(c['signedVolumeAfterM3']>0 for c in winding['components'])
  obj['sourceAsset']=stem;obj['staticAsset']=True;obj['front']='+Z after glTF transform';sanitize_loaded(stem);source=WORK/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
  glb=PACK/'models'/(stem+'.glb');export(obj,glb);assert glb.stat().st_size<1000000
  vp=WORK/(stem+'-validation.json');vp.write_text(json.dumps(dict(id=stem,dimensionsMm=dims,boundsM=[lo,hi],triangles=tris,nativeParts=native_count,uv=uv,winding=winding),indent=2)+'\n')
  rel=lambda p:str(p.relative_to(ROOT));contract={k:v for k,v in item.items()if k not in ['builder','name','key']};contract['constructionToAssetTranslationM']=list(offset);contract['units']='metres';contract['connectionFrame']='Blender XYZ / Z up';contract['allowedAssemblyTransforms']='Rigid translation and Z-axis rotations in 90-degree steps only; no mirrored or normalized scale';contract['gridMm']=[1200,600]
  for c in contract['connections']:c['assetPointM']=[c['point'][i]+offset[i]for i in range(3)]
  channels={m.get('finishChannel')for m in obj.data.materials};default={m.get('finishChannel'):COLORS[k] for k,m in P.items() if m in list(obj.data.materials)}
  desc=dict(id=stem,name=item['name'],group='住設',category='建築部材',assetSet='rpg-mansion',model=rel(glb),thumb=rel(PACK/'previews'/(stem+'-thumb.png')),top=rel(PACK/'previews'/(stem+'-top.png')),front=rel(WORK/(stem+'-front.png')),rear=rel(WORK/(stem+'-rear.png')),w=round(dims[0],4),d=round(dims[1],4),h=round(dims[2],4),defaultElevation=0,provenance='original',sourceBlend=rel(source),exportBlend=rel(source),authoringBlend=rel(author),validation=rel(vp),builder=rel(Path(__file__)),triangleBudget=6000,measuredTriangles=tris,glbBytes=glb.stat().st_size,nativePartCount=native_count,finishChannels=[dict(key=k,label=k,default=default[k])for k in sorted(channels)],moduleContract=contract,placementNotes='Static modular architecture for manual rigid placement. Opening holes are geometry, not native wall cutters. Roofs are hollow static shells, not parametric or automatic roofs. No collision, stairs, light mechanism, or structural engineering certification implied.',rights=dict(status='original',creator='OpenAI assistant using native Blender authoring',sources=[],externalGeometry=False,externalImages=False,licenseBasis='Original procedural geometry created for this project'),acceptanceStatus='New reconstruction pending visual review and independent QA')
  desc=clarify(desc)
  desc['hashes']={k:hashlib.sha256((ROOT/desc[k]).read_bytes()).hexdigest()for k in['model','sourceBlend','exportBlend','authoringBlend']}
  path=H/'descriptors.json';old=json.loads(path.read_text())['items']if path.exists()else[];by={i['id']:i for i in old};by[stem]=desc;path.write_text(json.dumps(dict(set='rpg-mansion',family='modular-architecture-completion-reconstruction',items=list(by.values())),indent=2)+'\n')
  (H/'production-checkpoint.json').write_text(json.dumps(dict(status='local-prototype-production',proposedFamily=32,prototypeTarget=18,builtCount=len(by),builtIds=list(by),acceptance='pending visual and independent review',sharedManifestWrites=False,remoteWrites=False),indent=2)+'\n');print('ASSET_READY',stem,dims,tris,glb.stat().st_size,flush=True)
