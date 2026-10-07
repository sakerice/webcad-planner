/* Immutable catalogue membership used by the editor's pane-local pack picker.
 * Selection is an argument, never shared state. All IDs remain resolvable.
 * Supply the editor's already-resolved legacy catalogue, not raw overlapping
 * source manifests. No plan migration, network, DOM, storage or model loading.
 */
(function(root){
  'use strict';
  const DEFAULT_PACK_ID='japanese-standard';
  const DEFAULT_PACK_NAME='日本建築標準';

  function requireString(value,context){
    if(typeof value!=='string'||!value.length)throw new TypeError(context+' must be a non-empty string');
    return value;
  }
  // Catalogue manifests are JSON data. Reject lossy/non-JSON values rather than
  // silently changing them. Copy before freezing so caller objects stay mutable.
  function snapshot(value,stack=new Set()){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(typeof value!=='object'||stack.has(value))throw new TypeError('Catalogue must contain finite, acyclic JSON data');
    if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
      throw new TypeError('Catalogue must contain plain JSON objects');
    stack.add(value);
    const copy=Array.isArray(value)?value.map(v=>snapshot(v,stack)):Object.fromEntries(Object.keys(value).map(k=>[k,snapshot(value[k],stack)]));
    stack.delete(value);
    return Object.freeze(copy);
  }

  function createRegistry(legacyAssets,extraPacks=[]){
    if(!Array.isArray(legacyAssets)||!Array.isArray(extraPacks))throw new TypeError('Expected catalogue and pack arrays');
    const assets=new Map(),packs=new Map(),members=new Map();
    function addAsset(item,namespace){
      if(!item||typeof item!=='object'||Array.isArray(item))throw new TypeError('Invalid asset');
      const id=requireString(item.id,'Asset ID');
      if(namespace&&!id.startsWith(namespace))throw new Error('Asset ID outside namespace: '+id);
      if(assets.has(id))throw new Error('Duplicate asset ID: '+id);
      assets.set(id,snapshot(item));
      return id;
    }
    function addPack(id,name,ids){
      const unique=Object.freeze(Array.from(new Set(ids)));
      packs.set(id,Object.freeze({id,name,assetIds:unique,count:unique.length}));
      members.set(id,new Set(unique));
    }
    addPack(DEFAULT_PACK_ID,DEFAULT_PACK_NAME,legacyAssets.map(item=>addAsset(item)));
    // Register definitions before membership references. Cross-pack membership
    // therefore does not depend on pack order; duplicate definitions still fail.
    const declarations=[],packIds=new Set([DEFAULT_PACK_ID]),namespaces=new Set();
    for(const pack of extraPacks){
      if(!pack||typeof pack!=='object'||Array.isArray(pack))throw new TypeError('Invalid pack');
      const id=requireString(pack.id,'Pack ID'),name=requireString(pack.name,'Pack name');
      if(packIds.has(id))throw new Error('Duplicate pack ID: '+id);
      packIds.add(id);
      const items=pack.items===undefined?[]:pack.items,refs=pack.assetIds===undefined?[]:pack.assetIds;
      if(!Array.isArray(items)||!Array.isArray(refs))throw new TypeError('Pack items and assetIds must be arrays');
      let namespace;
      if(items.length){
        namespace=requireString(pack.namespace,'Pack namespace');
        if(namespaces.has(namespace))throw new Error('Duplicate asset namespace: '+namespace);
        namespaces.add(namespace);
      }
      const ids=items.map(item=>addAsset(item,namespace));
      declarations.push({id,name,ids:ids.concat(refs.map(ref=>requireString(ref,'Member asset ID')))});
    }
    for(const pack of declarations){
      for(const id of pack.ids)if(!assets.has(id))throw new Error('Unknown member asset ID: '+id);
      addPack(pack.id,pack.name,pack.ids);
    }
    const allAssets=Object.freeze(Array.from(assets.values()));
    const allPacks=Object.freeze(Array.from(packs.values()));
    const candidates=new Map(Array.from(packs,([id,p])=>[id,Object.freeze(p.assetIds.map(assetId=>assets.get(assetId)))]));
    function resolvePackId(id){return packs.has(id)?id:DEFAULT_PACK_ID;}
    return Object.freeze({
      defaultPackId:DEFAULT_PACK_ID,
      resolvePackId,
      listPacks:()=>allPacks,
      listAssets:()=>allAssets,
      getAsset:id=>assets.get(id)||null,
      listCandidates:id=>candidates.get(resolvePackId(id)),
      hasCandidate:(assetId,packId)=>members.get(resolvePackId(packId)).has(assetId)
    });
  }
  const api=Object.freeze({DEFAULT_PACK_ID,DEFAULT_PACK_NAME,createRegistry});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AssetPackRegistry=api;
})(typeof window==='object'?window:globalThis);
