#!/usr/bin/env python3
"""Derive exact-ID metadata from bundled GLB/finish wiring; never modify assets."""
from pathlib import Path
import json,struct,hashlib
ROOT=Path(__file__).resolve().parents[1]
IDS=['im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown','original-sideboard','fmp-Sofa01','im0261-Sofa-MEGA_PACK_Sofa-BOLIA_sofa_Ivory']
fin=json.loads((ROOT/'assets/models/finishes.json').read_text());items={}
for folder in ['interior_model_0_26_1','furniture_mega','custom']:
 for item in json.loads((ROOT/f'assets/models/{folder}/manifest.json').read_text())['items']:items[item['id']]=item
out={}
for ident in IDS:
 item=items[ident];blob=(ROOT/item['model']).read_bytes();length=struct.unpack('<I',blob[12:16])[0];g=json.loads(blob[20:20+length]);mapping=fin['models'].get(item['model'],{});references=fin['references'].get(item['model'],{});materials=[]
 for i,m in enumerate(g.get('materials',[])):
  name=m.get('name','');extras=m.get('extras',{});ch=mapping.get(name) or extras.get('finishChannel');pbr=m.get('pbrMetallicRoughness',{});nodes=[]
  for node in g.get('nodes',[]):
   if 'mesh' in node and any(p.get('material')==i for p in g['meshes'][node['mesh']].get('primitives',[])):nodes.append(node.get('name') or 'unnamed-mesh-'+str(node['mesh']))
  textured='baseColorTexture' in pbr;external=name in mapping
  materials.append({'name':name,'channel':ch,'channelOrigin':'finishes.json' if external else 'GLB-extras' if ch else 'none','parts':nodes,'lockColor':extras.get('lockColor',False),'baseColorTexture':textured,'baseColorFactor':pbr.get('baseColorFactor',[1,1,1,1]),'textureColorEffect':'source-luminance-neutralized-tint' if textured and external else 'native-RGB-multiplies-tint' if textured else 'plain-color','finishReference':references.get(name,fin['defaults'].get(ch)) if external else None,'finishReferenceOrigin':'material-reference' if name in references else 'channel-default' if external else 'none','normalTextureRetained':'normalTexture' in m,'occlusionTextureRetained':'occlusionTexture' in m})
 bin_start=20+length;bin_length=struct.unpack('<I',blob[bin_start:bin_start+4])[0];bin_data=blob[bin_start+8:bin_start+8+bin_length]
 def accessor(index,primitive):
  a=g['accessors'][index];view=a.get('bufferView');compression=(primitive.get('extensions') or {}).get('KHR_draco_mesh_compression');
  if view is None:
   if not compression:raise ValueError('Unauditable accessor without data')
   view=compression['bufferView']
  v=g['bufferViews'][view];offset=v.get('byteOffset',0);return {'accessor':{k:a[k] for k in ['componentType','type','count','byteOffset','normalized'] if k in a},'stride':v.get('byteStride'),'bytesSHA256':hashlib.sha256(bin_data[offset:offset+v['byteLength']]).hexdigest()}
 geometry={'nodes':[{k:n[k] for k in ['children','mesh','translation','rotation','scale','matrix'] if k in n} for n in g.get('nodes',[])],'scenes':g.get('scenes',[]),'meshes':[[{'positions':accessor(p['attributes']['POSITION'],p),'indices':accessor(p['indices'],p) if 'indices' in p else None,'mode':p.get('mode',4)} for p in m['primitives']] for m in g['meshes']]}
 geometry_sha=hashlib.sha256(json.dumps(geometry,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 out[ident]={'model':item['model'],'modelSHA256':hashlib.sha256(blob).hexdigest(),'geometrySHA256':geometry_sha,'nativeDimensionsMm':{k:item[k] for k in ['w','d','h']},'expectedExternalMapping':mapping,'expectedReferences':references,'expectedDefaults':{ch:fin['defaults'].get(ch) for ch in sorted(set(mapping.values()))},'materials':materials,'independentMaterialChannels':sorted(set(m['channel'] for m in materials if m['channel'] and m['channel'] not in fin['fixed'])),'uniformPixelRGBGuaranteed':False,'sourceRegionSemanticsAudited':False}
payload=json.dumps(out,ensure_ascii=False,indent=2)
wrapper='''/* Exact bundled-asset material audit. Existing ModelQuality remains the renderer. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SceneMaterialAudit=factory();}(typeof self!=='undefined'?self:this,function(){'use strict';
const AUDITS = '''+payload+''';
const clone=v=>JSON.parse(JSON.stringify(v)),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function describe(item,finishData){
 const audit=AUDITS[item.id],declared=(item.finishChannels||[]).map(c=>({key:c.key,label:c.label||c.key,default:c.default}));
 const unknown={status:'unreviewed',declaredChannels:declared,verifiedChannels:[],fixedMaterials:[],sourceRegionSemanticsAudited:false,uniformPixelRGBGuaranteed:false,reason:'Declared controls are not an asset/part audit'};
 if(!audit)return unknown;
 const data=finishData||{},map=(data.models||{})[item.model]||{},refs=(data.references||{})[item.model]||{},defaults=Object.fromEntries(Object.keys(audit.expectedDefaults).map(k=>[k,(data.defaults||{})[k]]));
 if(item.model!==audit.model||!['w','d','h'].every(k=>item[k]===audit.nativeDimensionsMm[k])||!equal(map,audit.expectedExternalMapping)||!equal(refs,audit.expectedReferences)||!equal(defaults,audit.expectedDefaults))return {...unknown,status:'audit-mismatch',reason:'Asset path/dimensions or existing finish wiring changed; re-audit required'};
 const keys=declared.map(c=>c.key),verified=audit.independentMaterialChannels.filter(k=>keys.includes(k)).map(key=>({...declared.find(c=>c.key===key),materials:clone(audit.materials.filter(m=>m.channel===key)),color:true,textureReplacement:true,roughness:true}));
 return {status:'asset-and-code-audited',asset:{path:audit.model,sha256:audit.modelSHA256,geometrySHA256:audit.geometrySHA256,geometryHashBasis:'position/index or Draco geometry buffers and static node transforms; not a shape-equivalence certificate'},defaultHeight:{valueMm:item.h,origin:'catalogue-manifest',sourceMeasured:false,widthDepthFitChangesHeight:false},declaredChannels:declared,verifiedChannels:verified,fixedMaterials:clone(audit.materials.filter(m=>!keys.includes(m.channel))),independentChannelCount:verified.length,sourceRegionSemanticsAudited:false,uniformPixelRGBGuaranteed:false,renderer:'ModelQuality.prepare/applyFinishes; existing finishColors/finishTextures/finishRoughness',limits:['Channel names describe asset material groups, not source drawing regions','Texture luminance or native RGB can alter displayed pixels','Unmapped materials retain native finishes']};
}
return {describe,audits:()=>clone(AUDITS)};
}));
'''
(ROOT/'assets/js/scene-material-audit.js').write_text(wrapper)
print('Audited exact IDs:',len(out))
