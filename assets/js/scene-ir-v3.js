/* Source-first Scene IR v3. Typed retention only; no renderer approximation or DATA mutation. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./scene-ir-v3-materialize.js'));
  else root.SceneIRV3=factory(root.SceneIRV3Materialize);
}(typeof self!=='undefined'?self:this,function(Materialize){
  'use strict';
  var LIMIT=1000000;
  var object=function(properties,required){return {type:'object',additionalProperties:false,properties:properties,required:required||Object.keys(properties)};};
  var array=function(items,max,min){return {type:'array',items:items,maxItems:max||2000,minItems:min||0};};
  var enumeration=function(values){return {enum:values};};
  var number={type:'number',minimum:-LIMIT,maximum:LIMIT},positive={type:'number',exclusiveMinimum:0,maximum:LIMIT};
  var text={type:'string',maxLength:2000},id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$'};
  var point=object({x:number,y:number}),size=object({w:positive,d:positive}),rect=object({x:number,y:number,w:positive,d:positive});
  var shape={oneOf:[object({kind:{const:'rectUnion'},rectangles:array(rect,32,1)}),object({kind:{const:'orthogonalPolygon'},outer:array(point,64,4)})]};
  function fact(value){var metadata={source:{type:'string',minLength:1,maxLength:2000},reason:{type:'string',minLength:1,maxLength:2000},evidenceRefs:array(id,64)};return {oneOf:[object(Object.assign({value:value,status:{const:'observed'}},metadata),['value','status','source']),object(Object.assign({value:value,status:{const:'inferred'}},metadata),['value','status','source','reason']),object({value:{type:'null'},status:{const:'unknown'},source:text,reason:text,evidenceRefs:array(id,64),unknownReason:enumeration(['not-shown','unreadable','ambiguous'])},['value','status'])]};}
  var floor=fact({type:'integer',minimum:1,maximum:5}),color={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
  var appearance=object({diagramColor:fact({oneOf:[color,array(object({region:enumeration(['body','top','seat','frame']),color:color}),4,1)]}),pattern:fact(enumeration(['plain','plank-lines','square-grid','none','unknown'])),moduleMm:fact(positive),specifiedMaterial:object({category:fact(text),sourceCode:fact(text)},['category'])},[]);
  var elevation=object({offsetMm:fact(number),relativeToId:fact(id)});
  function entity(props,required){return object(Object.assign({id:id},props),['id'].concat(required||[]));}
  var rooms=entity({floor:floor,shape:fact(shape),boundaryBasis:fact(enumeration(['wall-centerline','clear-face'])),name:fact(text),use:fact(text),appearance:appearance,relativeElevation:elevation},['floor','shape','boundaryBasis']);
  var walls=entity({floor:floor,start:fact(point),end:fact(point),thicknessMm:fact(positive)},['floor','start','end','thicknessMm']);
  var leaves=entity({mechanism:fact(enumeration(['swing','pocket','slide','fold'])),hingeJamb:fact(enumeration(['start','end'])),pivot:fact(point),closedAxis:fact(point),leafWidthMm:fact(positive),thicknessMm:fact(positive),swingSide:fact(point),angleDeg:fact(number),openState:fact(enumeration(['open','closed','partial'])),travelDirection:fact(point),travelDistanceMm:fact(positive),closedCenter:fact(point),openCenter:fact(point),pocketRegion:fact(shape),observedPolyline:fact(array(point,64,2))},['mechanism']);
  var openings=entity({floor:floor,hostWallId:fact(id),adjacentRoomIds:fact(array({oneOf:[id,{type:'null'}]},2,2)),start:fact(point),end:fact(point),mechanism:fact(enumeration(['swing','pocket','slide','bypass-slide','fold','opening','window'])),leaves:array(leaves,8),leafRelation:fact(enumeration(['single','paired','bypass','independent'])),appearance:appearance,heightMm:fact(positive),sillMm:fact(number),windowKind:fact(enumeration(['fix','sliding','casement']))},['floor','hostWallId','adjacentRoomIds','start','end','mechanism']);
  var placement={oneOf:[object({domain:{const:'room'},roomId:id}),object({domain:{const:'exterior'},regionId:id},['domain'])]};
  var footprint=object({center:point,sizeMm:size,axisX:point});
  var objects=entity({objectType:fact(enumeration(['bed','desk','chair','car','washbasin','toilet','bathtub','laundry-appliance','hanging-storage','cabinet-like','shower-fixture','stair','unidentified-symbol'])),semanticExtent:fact(enumeration(['asset','individual-fixture','room-assembly','symbol-only'])),placement:fact(placement),sourceFootprint:fact(footprint),frontDirection:fact(point),headDirection:fact(point),heightMm:fact(positive),relativeElevation:elevation,appearance:appearance,diagramSegments:fact(array(object({points:array(point,64,2),visibility:enumeration(['solid','dashed']),treadLabels:array(text,64),ascentDirection:point},['points','visibility']),32,1))},['objectType','semanticExtent','placement','sourceFootprint']);
  var siteRegions=entity({role:fact(enumeration(['parcel-boundary','ground','parking','approach','ramp'])),shape:fact(shape),subtractRegionIds:array(id,64),appearance:appearance,relativeElevation:elevation,direction:fact(point)},['role','shape']);
  var buildingFootprints=entity({shape:fact(shape),boundaryBasis:fact(enumeration(['outer-face','wall-centerline','clear-face']))},['shape','boundaryBasis']);
  var annotations=entity({kind:enumeration(['dimension','level-note','label','direction-note','legend']),literalText:fact(text),pixelBox:fact(rect),valuesMm:fact(array(number,64,1)),basis:fact(enumeration(['outer-face','wall-centerline','clear-face','opening-jamb','object-envelope','site-boundary','nominal-module','unknown'])),axis:fact(point),references:fact(array(object({entityId:id,edge:enumeration(['start','end','north','south','east','west','envelope'])},['entityId']),64)),spanMm:fact(positive)},['kind','literalText']);
  var bindings=entity({sourceEntityId:id,catalogId:fact(id),sizingPolicy:enumeration(['native','fit-source','proxy']),rotationDeg:fact(number),appearanceMode:enumeration(['unspecified','match-diagram-appearance']),channels:array(object({sourceRegion:enumeration(['body','top','seat','frame']),channel:id,color:color}),16)},['sourceEntityId','catalogId','sizingPolicy']);
  var connections=entity({rooms:fact(array(id,2,2)),openingId:fact(id),requiredTraversable:fact({type:'boolean'})},['rooms','openingId','requiredTraversable']);
  var collections={annotations:annotations,walls:walls,rooms:rooms,openings:openings,objects:objects,siteRegions:siteRegions,buildingFootprints:buildingFootprints,bindings:bindings,connections:connections};
  var props={sceneVersion:{const:3},units:{const:'mm'},coordinateSystem:{const:'x-east-y-south-clockwise'}};
  Object.keys(collections).forEach(function(k){props[k]=array(collections[k],k==='annotations'?256:2000);});
  var schema=Object.assign({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:webcad:scene-ir:3',title:'WebCAD source-first Scene IR v3'},object(props));
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function check(s,v,path,errors){
    function bad(message){errors.push({code:'invalid_schema',path:path,message:message,severity:'error'});}
    if(s.oneOf){var matches=s.oneOf.filter(function(branch){var es=[];check(branch,v,path,es);return !es.length;});if(matches.length!==1)bad('Expected exactly one typed variant');return;}
    if(s.const!==undefined&&v!==s.const)bad('Unexpected constant');
    if(s.enum&&s.enum.indexOf(v)<0)bad('Value outside bounded enumeration');
    if(!s.type)return;
    var valid=s.type==='null'?v===null:s.type==='array'?Array.isArray(v):s.type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):s.type==='integer'?Number.isInteger(v):typeof v===s.type;
    if(!valid){bad('Expected '+s.type);return;}
    if(s.type==='number'||s.type==='integer'){if(!Number.isFinite(v)||v<s.minimum||v>s.maximum||(s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum))bad('Number outside finite bounds');}
    if(s.type==='string'){if(v.length<(s.minLength||0)||v.length>s.maxLength||(s.pattern&&!new RegExp(s.pattern).test(v)))bad('Invalid bounded string');}
    if(s.type==='array'){if(v.length<s.minItems||v.length>s.maxItems)bad('Array outside bounded size');else v.forEach(function(e,i){check(s.items,e,path+'['+i+']',errors);});}
    if(s.type==='object'){(s.required||[]).forEach(function(k){if(!Object.prototype.hasOwnProperty.call(v,k))bad('Missing '+k);});Object.keys(v).forEach(function(k){if(!Object.prototype.hasOwnProperty.call(s.properties,k))bad('Unsupported field '+k);else check(s.properties[k],v[k],path+'.'+k,errors);});}
  }
  function area(p){return p.reduce(function(a,q,i){var r=p[(i+1)%p.length];return a+q.x*r.y-r.x*q.y;},0)/2;}
  function polygonCheck(p){
    if(p.length<4||p.length>64||!area(p))throw Error('Polygon needs bounded positive area');
    for(var i=0;i<p.length;i++){
      var a=p[i],b=p[(i+1)%p.length];if((a.x===b.x)===(a.y===b.y))throw Error('Edges must be nonzero and axis aligned');
      for(var j=i+1;j<p.length;j++){
        var c=p[j],d=p[(j+1)%p.length],adjacent=j===i+1||(i===0&&j===p.length-1);
        var overlapX=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x));
        var overlapY=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y));
        if(overlapX>=0&&overlapY>=0&&(!adjacent||overlapX>0||overlapY>0))throw Error('Self-intersection, repeated edge or point contact');
      }
    }
    return area(p)>0?p:p.slice().reverse();
  }
  function canonicalShape(value){
    if(value.kind==='orthogonalPolygon')return polygonCheck(clone(value.outer));
    var rs=value.rectangles;if(rs.some(function(r){return Math.abs(r.x+r.w)>LIMIT||Math.abs(r.y+r.d)>LIMIT;}))throw Error('Shape extent exceeds coordinate bounds');var xs=Array.from(new Set(rs.flatMap(function(r){return [r.x,r.x+r.w];}))).sort(function(a,b){return a-b;}),ys=Array.from(new Set(rs.flatMap(function(r){return [r.y,r.y+r.d];}))).sort(function(a,b){return a-b;});
    var cells=new Set(),edges=new Map();
    for(var x=0;x<xs.length-1;x++)for(var y=0;y<ys.length-1;y++)if(rs.some(function(r){return xs[x]>=r.x&&xs[x+1]<=r.x+r.w&&ys[y]>=r.y&&ys[y+1]<=r.y+r.d;}))cells.add(x+','+y);
    var todo=[cells.values().next().value],seen=new Set(todo);
    while(todo.length){var q=todo.pop().split(',').map(Number);[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var key=(q[0]+d[0])+','+(q[1]+d[1]);if(cells.has(key)&&!seen.has(key)){seen.add(key);todo.push(key);}});}
    if(seen.size!==cells.size)throw Error('Rectangles must form one edge-connected logical room');
    function edge(a,b){var key=a.join(',')+'>'+b.join(','),reverse=b.join(',')+'>'+a.join(',');if(edges.has(reverse))edges.delete(reverse);else edges.set(key,[a,b]);}
    cells.forEach(function(k){var q=k.split(',').map(Number),i=q[0],j=q[1];edge([xs[i],ys[j]],[xs[i+1],ys[j]]);edge([xs[i+1],ys[j]],[xs[i+1],ys[j+1]]);edge([xs[i+1],ys[j+1]],[xs[i],ys[j+1]]);edge([xs[i],ys[j+1]],[xs[i],ys[j]]);});
    var next=new Map();edges.forEach(function(e){var k=e[0].join(',');if(next.has(k))throw Error('Point-contact boundary is not simple');next.set(k,e[1]);});
    var start=next.keys().next().value,at=start,p=[];
    do{var xy=at.split(',').map(Number);p.push({x:xy[0],y:xy[1]});var n=next.get(at);if(!n)throw Error('Invalid union boundary');next.delete(at);at=n.join(',');}while(at!==start);
    if(next.size)throw Error('Holes are outside this versioned geometry scope');
    p=p.filter(function(q,i){var a=p[(i+p.length-1)%p.length],b=p[(i+1)%p.length];return !(a.x===q.x&&q.x===b.x)&&!(a.y===q.y&&q.y===b.y);});
    return polygonCheck(p);
  }
  function inside(p,q){var hit=false;for(var i=0,j=p.length-1;i<p.length;j=i++){var a=p[i],b=p[j];if((a.x===b.x&&q.x===a.x&&q.y>=Math.min(a.y,b.y)&&q.y<=Math.max(a.y,b.y))||(a.y===b.y&&q.y===a.y&&q.x>=Math.min(a.x,b.x)&&q.x<=Math.max(a.x,b.x)))return true;if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
  function compile(scene,options){
    options=options||{};
    var out={version:3,valid:false,plan:{walls:[],rooms:[],items:[]},diagnostics:[],evidence:[],defaults:[],suggestions:[],unresolved:[],reviewGroups:[],unresolvedEntities:[],acknowledgedOmissions:[],reconstructionStatus:'invalid',canApply:false,sourceScene:null,sourcePreview:{polygons:[],objects:[],openings:[]}};
    function issue(code,path,message,severity){out.diagnostics.push({code:code,path:path,message:message,severity:severity||'error'});}
    check(schema,scene,'scene',out.diagnostics);if(out.diagnostics.length)return out;
    out.sourceScene=clone(scene);
    var ids=new Map(),kinds=new Map(),polygons=new Map();
    Object.keys(collections).forEach(function(k){scene[k].forEach(function(e,i){var p=k+'['+i+']';if(['__proto__','constructor','prototype'].indexOf(e.id)>=0||ids.has(e.id))issue('invalid_id',p+'.id','IDs must be safe and globally unique');ids.set(e.id,e);kinds.set(e.id,k);if(e.leaves)e.leaves.forEach(function(l){if(ids.has(l.id)||['__proto__','constructor','prototype'].indexOf(l.id)>=0)issue('invalid_id',p+'.leaves','Leaf IDs must be globally unique and safe');ids.set(l.id,l);kinds.set(l.id,'leaves');});});});
    function ref(id,path,expected){if(!ids.has(id)||(expected&&expected.indexOf(kinds.get(id))<0))issue('invalid_reference',path,'Reference does not resolve to the required entity type: '+id);}
    function walk(v,p){if(!v||typeof v!=='object')return;if(v.status){out.evidence.push(Object.assign({path:p},clone(v)));if(v.source!==undefined&&!v.source.trim())issue('missing_source',p,'Source must not be whitespace');if(v.status==='inferred'&&!v.reason.trim())issue('missing_inference_reason',p,'Inference reason must not be whitespace');(v.evidenceRefs||[]).forEach(function(id){ref(id,p+'.evidenceRefs',['annotations']);});}Object.keys(v).forEach(function(k){walk(v[k],Array.isArray(v)?p+'['+k+']':p+'.'+k);});}
    walk(scene,'scene');
    ['rooms','siteRegions','buildingFootprints'].forEach(function(k){scene[k].forEach(function(e,i){if(e.shape.value===null)return;try{var p=canonicalShape(e.shape.value);polygons.set(e.id,p);out.sourcePreview.polygons.push({id:e.id,collection:k,outer:p});}catch(err){issue('invalid_shape',k+'['+i+'].shape',err.message);}});});
    function unit(f,p){if(f&&f.value!==null&&Math.abs(Math.hypot(f.value.x,f.value.y)-1)>1e-6)issue('invalid_direction',p,'Direction must be a unit vector');}
    scene.walls.forEach(function(e,i){var a=e.start.value,b=e.end.value;if(a&&b&&(a.x===b.x)===(a.y===b.y))issue('unsupported_wall','walls['+i+']','Wall must be nonzero and axis aligned');});
    scene.annotations.forEach(function(e,i){var p='annotations['+i+']';if(e.kind==='dimension'&&(!e.valuesMm||!e.basis))issue('missing_dimension_basis',p,'Dimension annotations require valuesMm and basis facts');unit(e.axis,p+'.axis');if(e.references&&e.references.value)e.references.value.forEach(function(r){ref(r.entityId,p+'.references');});if(e.valuesMm&&e.valuesMm.value&&e.spanMm&&e.spanMm.value!==null&&Math.abs(e.valuesMm.value.reduce(function(a,b){return a+b;},0)-e.spanMm.value)>0.001)issue('dimension_conflict',p,'Dimension chain sum differs from independently recorded span');});
    scene.openings.forEach(function(e,i){var p='openings['+i+']';if(e.hostWallId.value)ref(e.hostWallId.value,p+'.hostWallId',['walls']);if(e.adjacentRoomIds.value)e.adjacentRoomIds.value.filter(Boolean).forEach(function(id){ref(id,p+'.adjacentRoomIds',['rooms']);});(e.leaves||[]).forEach(function(l){['closedAxis','swingSide','travelDirection'].forEach(function(k){unit(l[k],p+'.leaves.'+l.id+'.'+k);});var axis=l.closedAxis&&l.closedAxis.value,side=l.swingSide&&l.swingSide.value,angle=l.angleDeg&&l.angleDeg.value;if(axis&&side&&angle){var turn=axis.x*side.y-axis.y*side.x;if(Math.abs(axis.x*side.x+axis.y*side.y)>1e-6||Math.sign(angle)!==Math.sign(turn))issue('source_angle_direction_conflict',p+'.leaves.'+l.id+'.angleDeg','Signed clockwise angle contradicts closed axis and declared swing side; source facts are retained unchanged');}});out.sourcePreview.openings.push(clone(e));});
    scene.objects.forEach(function(e,i){var p='objects['+i+']',place=e.placement.value,fp=e.sourceFootprint.value;unit(e.frontDirection,p+'.frontDirection');unit(e.headDirection,p+'.headDirection');if(fp)unit({value:fp.axisX},p+'.sourceFootprint.axisX');if(place){if(place.domain==='room')ref(place.roomId,p+'.placement',['rooms']);else if(place.regionId)ref(place.regionId,p+'.placement',['siteRegions']);}out.sourcePreview.objects.push(clone(e));});
    ['rooms','objects','siteRegions'].forEach(function(k){scene[k].forEach(function(e,i){if(e.relativeElevation&&e.relativeElevation.relativeToId.value)ref(e.relativeElevation.relativeToId.value,k+'['+i+'].relativeElevation',['rooms','siteRegions','buildingFootprints']);});});
    scene.siteRegions.forEach(function(e,i){(e.subtractRegionIds||[]).forEach(function(id){ref(id,'siteRegions['+i+'].subtractRegionIds',['siteRegions','buildingFootprints']);if(id===e.id)issue('cyclic_subtraction','siteRegions['+i+']','A region cannot subtract itself');});unit(e.direction,'siteRegions['+i+'].direction');});
    var active=new Set(),done=new Set();
    function visitRegion(id){if(active.has(id)){issue('cyclic_subtraction','siteRegions','Subtraction graph must be acyclic');return;}if(done.has(id))return;active.add(id);var e=ids.get(id);if(e)(e.subtractRegionIds||[]).forEach(visitRegion);active.delete(id);done.add(id);}
    scene.siteRegions.forEach(function(e){visitRegion(e.id);});
    scene.connections.forEach(function(e,i){if(e.rooms.value)e.rooms.value.forEach(function(id){ref(id,'connections['+i+'].rooms',['rooms']);});if(e.openingId.value)ref(e.openingId.value,'connections['+i+'].openingId',['openings']);});
    scene.bindings.forEach(function(e,i){var p='bindings['+i+']';ref(e.sourceEntityId,p+'.sourceEntityId',['objects','rooms','openings','siteRegions']);var source=ids.get(e.sourceEntityId),catalog=options.registry&&e.catalogId.value&&options.registry.get(e.catalogId.value);if(!source)return;if(!catalog){issue('mapping_unresolved',p,'Catalog mapping is unresolved; source facts remain intact','warning');return;}if(source.frontDirection&&source.frontDirection.value&&!catalog.front)issue('mapping_unresolved',p,'Source front is known but canonical asset front is unverified','warning');var f=source.sourceFootprint&&source.sourceFootprint.value;if(f&&(f.sizeMm.w!==catalog.w||f.sizeMm.d!==catalog.d))out.diagnostics.push({code:'native_size_mismatch',path:p,severity:'warning',message:'Native dimensions differ from source; no resizing applied',deltaMm:{w:catalog.w-f.sizeMm.w,d:catalog.d-f.sizeMm.d}});});
    out.valid=!out.diagnostics.some(function(d){return d.severity==='error';});
    issue('retained_preview_only','scene','v3 source retained; runtime polygon/site/opening consumers and persistence are not certified. Apply is disabled.','error');
    out.reconstructionStatus=out.valid?'retained-preview-only':'invalid';
    Object.keys(collections).forEach(function(k){scene[k].forEach(function(e,i){var p=k+'['+i+']';out.reviewGroups.push({id:k+':'+e.id,entityId:e.id,collection:k,path:p,label:e.name&&e.name.value||e.id,diagnostics:out.diagnostics.filter(function(d){return d.path.indexOf(p)===0;}),evidence:out.evidence.filter(function(f){return f.path.indexOf('scene.'+p+'.')===0;}),reviewPaths:[],canAcknowledgeOmission:false,acknowledgedOmission:false,accepted:false});out.unresolvedEntities.push({id:e.id,collection:k,source:clone(e),reasons:[{code:'retained_preview_only',path:p,message:'Retained source; not materialized'}],acknowledgedOmission:false,decision:null});});});
    if(options.materialization==='bounded-v3'){
      if(Materialize&&typeof Materialize.compile==='function'){
        var boundScene=clone(scene);
        (options.bindingDecisions||[]).forEach(function(decision,i){
          var path='bindingDecisions['+i+']',before=out.diagnostics.length;
          if(!decision||typeof decision!=='object'||!decision.binding){issue('invalid_binding_decision',path,'A separate reviewed binding is required');return;}
          check(collections.bindings,decision.binding,path+'.binding',out.diagnostics);
          if(out.diagnostics.length!==before)return;
          if(decision.retainedAppearanceRegions!==undefined&&(!Array.isArray(decision.retainedAppearanceRegions)||decision.retainedAppearanceRegions.length>4||decision.retainedAppearanceRegions.some(function(r){return ['body','top','seat','frame'].indexOf(r)<0;}))){issue('invalid_binding_decision',path,'Retained appearance regions must use bounded source-region names');return;}
          var binding=decision.binding,source=ids.get(binding.sourceEntityId);
          if(!source||decision.sourceSnapshot!==JSON.stringify(source)){issue('stale_binding_decision',path,'Binding review must match the unchanged source entity');return;}
          boundScene.bindings=boundScene.bindings.filter(function(b){return b.sourceEntityId!==binding.sourceEntityId;});
          boundScene.bindings.push(clone(binding));
        });
        return Materialize.compile(boundScene,out,options);
      }
      issue('missing_materializer','scene','Bounded v3 runtime is not loaded');
    }
    return out;
  }
  return {createPlacementContext:Materialize&&Materialize.createPlacementContext,sourceHash:Materialize&&Materialize.sourceHash,schema:schema,compile:compile,canonicalShape:canonicalShape,contains:inside};
}));
