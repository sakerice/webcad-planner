/* Explicit bounded v3 materialization. Source facts are never rewritten to match an asset. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./room-geometry.js'),require('./scene-opening-geometry.js'),require('./plan-schema.js'));
  else root.SceneIRV3Materialize=factory(root.RoomGeometry,root.SceneOpeningGeometry,root.PlanSchema);
}(typeof self!=='undefined'?self:this,function(RoomGeometry,Openings,PlanSchema){
  'use strict';
  var EPS=.001;
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function value(f){return f&&f.value!==null?f.value:undefined;}
  function finite(v){return typeof v==='number'&&Number.isFinite(v);}
  // Synchronous SHA-256 over UTF-8 JSON, so browser and offline compiler agree.
  function sourceHash(scene){
    var bytes=unescape(encodeURIComponent(JSON.stringify(scene))),words=[],h=[],k=[],prime=2;
    function rotr(x,n){return (x>>>n)|(x<<(32-n));}
    while(k.length<64){var isPrime=true;for(var d=2;d*d<=prime;d++)if(prime%d===0){isPrime=false;break;}
      if(isPrime){if(h.length<8)h.push((Math.sqrt(prime)%1*4294967296)|0);k.push((Math.pow(prime,1/3)%1*4294967296)|0);}prime++;}
    var length=bytes.length;for(var i=0;i<length;i++)words[i>>2]=(words[i>>2]||0)|(bytes.charCodeAt(i)<<(24-(i%4)*8));
    words[length>>2]=(words[length>>2]||0)|(128<<(24-(length%4)*8));
    var end=(((length+8)>>6)+1)*16;words[end-2]=Math.floor(length/536870912);words[end-1]=(length*8)|0;
    for(var offset=0;offset<end;offset+=16){var w=[],a=h.slice();for(i=0;i<64;i++){
      if(i<16)w[i]=words[offset+i]|0;else{var x=w[i-15],y=w[i-2];w[i]=((rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-16]+(rotr(y,17)^rotr(y,19)^(y>>>10))+w[i-7])|0;}
      var t1=(a[7]+(rotr(a[4],6)^rotr(a[4],11)^rotr(a[4],25))+((a[4]&a[5])^(~a[4]&a[6]))+k[i]+w[i])|0;
      var t2=((rotr(a[0],2)^rotr(a[0],13)^rotr(a[0],22))+((a[0]&a[1])^(a[0]&a[2])^(a[1]&a[2])))|0;
      a=[(t1+t2)|0,a[0],a[1],a[2],(a[3]+t1)|0,a[4],a[5],a[6]];
    }for(i=0;i<8;i++)h[i]=(h[i]+a[i])|0;}
    return 'sha256:'+h.map(function(v){return ('00000000'+(v>>>0).toString(16)).slice(-8);}).join('');
  }
  function placementEntityIds(scene){return ['walls','rooms','openings'].reduce(function(ids,k){return ids.concat((scene[k]||[]).map(function(e){return e.id;}));},[]).sort();}
  function createPlacementContext(scene,pageScope,targetFloor,singleLevelConfirmed){
    return {version:1,sourceHash:sourceHash(scene),pageScope:clone(pageScope),entityIds:placementEntityIds(scene),targetFloor:targetFloor,singleLevelConfirmed:singleLevelConfirmed===true};
  }
  function reviewKey(scene,e,context){return JSON.stringify({source:e,bindings:scene.bindings.filter(function(b){return b.sourceEntityId===e.id;}),runtime:context||null});}
  function compile(scene,out,options){
    if(!out.valid)return out;
    var registry=options.registry,rooms=new Map(),walls=[],specs=[],bindings=new Map(),accepted=options.acceptedReviews||[],acceptedGroups=options.acceptedReviewGroups||[],snapshots=options.reviewedEntities||{};
    out.diagnostics=out.diagnostics.filter(function(d){return d.code!=='retained_preview_only';});
    out.reviewGroups=[];out.unresolvedEntities=[];out.acknowledgedOmissions=[];
    function issue(code,path,message,severity){var d={code:code,path:path,message:message,severity:severity||'error'};out.diagnostics.push(d);return d;}
    function need(f,p){var v=value(f);if(v===undefined)issue('unknown_required_geometry',p,'Source does not establish this required value; no exact value is invented');return v;}
    function errorsSince(n){return out.diagnostics.slice(n).some(function(d){return d.severity==='error';});}
    function sourceEvidence(e,p){out.evidence.filter(function(f){return f.path.indexOf('scene.'+p+'.')===0&&f.status==='inferred';}).forEach(function(f){issue('inference_review',f.path.slice(6),f.reason,'review');});}
    function defaultValue(p,v,reason){out.defaults.push({path:p,value:v,provenance:'editor-default',reason:reason});issue('default_review',p,reason,'review');}
    if(!registry||typeof registry.get!=='function'||!RoomGeometry){issue('missing_runtime','scene','Bounded materialization requires current catalogue and logical room geometry');return out;}
    var placement=options.placementContext,placementValid=false;
    if(placement){
      var source=out.sourceScene,scope=options.pageScope;
      placementValid=placement.version===1&&placement.singleLevelConfirmed===true&&Number.isInteger(placement.targetFloor)&&placement.targetFloor>=1&&placement.targetFloor<=4&&
        Array.isArray(scope)&&scope.length===1&&typeof scope[0]==='string'&&scope[0].length>0&&
        JSON.stringify(placement.pageScope)===JSON.stringify(scope)&&placement.sourceHash===sourceHash(source)&&
        JSON.stringify(placement.entityIds)===JSON.stringify(placementEntityIds(source));
      if(!placementValid)issue('stale_placement_context','placementContext','Confirm a single source image and exact destination again; source, page scope, entity set or decision changed');
      else ['walls','rooms','openings'].forEach(function(k){source[k].forEach(function(e,i){if(value(e.floor)!==undefined&&value(e.floor)!==placement.targetFloor)issue('placement_floor_conflict',k+'['+i+'].floor','Known source floor conflicts with the selected destination; source label is never overwritten');});});
    }
    out.placementContext=placementValid?clone(placement):null;
    function runtimeFloor(e,p){
      if(value(e.floor)!==undefined)return value(e.floor);
      if(placementValid&&e.floor.status==='unknown'&&placement.entityIds.indexOf(e.id)>=0){
        out.evidence.push({path:p+'.runtimeFloor',status:'placement-context',value:placement.targetFloor,reason:'User-confirmed import destination; source floor remains unknown',sourceHash:placement.sourceHash});
        issue('placement_context_review',p+'.floor','Review runtime destination '+placement.targetFloor+'F; this is user placement intent, not a printed source label','review');
        return placement.targetFloor;
      }
      return need(e.floor,p+'.floor');
    }
    scene.bindings.forEach(function(b,i){if(bindings.has(b.sourceEntityId))issue('ambiguous_binding','bindings['+i+']','Only one reviewed binding per source entity');bindings.set(b.sourceEntityId,b);});
    function appearanceLimits(e,p){var a=e.appearance;if(!a)return;var pattern=value(a.pattern),module=value(a.moduleMm),material=a.specifiedMaterial;if(module!==undefined)issue('unsupported_asset_pattern_module',p+'.appearance.moduleMm','Known pattern module has no certified object/opening renderer parameter');if(pattern&&['plain','none','unknown'].indexOf(pattern)<0)issue('unsupported_asset_pattern',p+'.appearance.pattern','Known patterned source appearance cannot be silently replaced by native asset material');else if(pattern==='plain'||pattern==='none')issue('native_surface_review',p+'.appearance.pattern','Source diagram is unpatterned; review native asset surface as a visualization choice rather than measured physical finish','review');if(material&&(value(material.category)!==undefined||value(material.sourceCode)!==undefined))issue('specified_material_review',p+'.appearance.specifiedMaterial','Specified physical material/code is retained but not certified against the selected renderer material','review');}
    scene.walls.forEach(function(e,i){var p='walls['+i+']',n=out.diagnostics.length;sourceEvidence(e,p);appearanceLimits(e,p);var a=need(e.start,p+'.start'),b=need(e.end,p+'.end'),floor=runtimeFloor(e,p),t=need(e.thicknessMm,p+'.thicknessMm');if(errorsSince(n))return;var w={id:e.id,floor:floor,x1:a.x,y1:a.y,x2:b.x,y2:b.y,thick:t};walls.push(w);out.plan.walls.push(w);});
    function roomAppearance(e,r,p){
      var a=e.appearance,b=bindings.get(e.id);if(!a)return;
      var color=value(a.diagramColor),pattern=value(a.pattern),module=value(a.moduleMm);
      if(color!==undefined||pattern!==undefined||module!==undefined){
        if(!b||b.appearanceMode!=='match-diagram-appearance'){issue('appearance_mapping_required',p+'.appearance','Known diagram appearance needs an explicit visualization mapping; native finishes cannot replace it');return;}
        issue('diagram_appearance_review',p+'.appearance','Map drawing color/pattern to renderer appearance, without claiming physical finish evidence','review');
        if(typeof color==='string')r.floorColor=color;
        else if(color)issue('unsupported_room_color_regions',p+'.appearance.diagramColor','Regional floor color mapping is unsupported');
        if(pattern==='square-grid'){r.floorMaterial='tile_floor';if(module!==undefined){if(module<10||module>10000)issue('unsupported_floor_module',p+'.appearance.moduleMm','Known module is outside exact renderer range');else r.floorModuleMm=module;}}
        else if(pattern==='plank-lines'){r.floorMaterial='wood_floor';if(module!==undefined)issue('unsupported_pattern_module',p+'.appearance.moduleMm','Known plank module is not a certified renderer texture scale');}
        else if(pattern==='plain'||pattern==='none'){r.floorDiagramPattern='plain';if(module!==undefined)issue('unsupported_pattern_module',p+'.appearance.moduleMm','A known module cannot be applied to an unpatterned renderer material');}
        else if(pattern&&['none','plain','unknown'].indexOf(pattern)<0)issue('unsupported_room_pattern',p+'.appearance.pattern','Pattern has no faithful renderer mapping');
        if(a.specifiedMaterial)issue('material_product_unresolved',p+'.appearance.specifiedMaterial','Literal physical material retained; renderer texture is only a visualization choice','review');
      }
    }
    scene.rooms.forEach(function(e,i){var p='rooms['+i+']',n=out.diagnostics.length;sourceEvidence(e,p);var f=runtimeFloor(e,p),shape=need(e.shape,p+'.shape'),basis=need(e.boundaryBasis,p+'.boundaryBasis');if(errorsSince(n))return;var canonical=RoomGeometry.normalize(shape),r=Object.assign({id:e.id,type:'room',floor:f,n:value(e.name)||'',shape:canonical,sourceBoundaryBasis:basis,sceneImportVersion:3},RoomGeometry.bounds({shape:canonical}));roomAppearance(e,r,p);rooms.set(e.id,r);out.plan.rooms.push(r);});
    var resolving=new Set(),resolved=new Set();
    function elevation(e,index){var r=rooms.get(e.id),p='rooms['+index+']';if(!r||resolved.has(e.id))return r&&r.floorRaiseMm;if(resolving.has(e.id)){issue('relative_datum_cycle',p+'.relativeElevation','Relative room level references must be acyclic');return;}
      resolving.add(e.id);var relation=e.relativeElevation,offset;
      if(relation&&(value(relation.offsetMm)!==undefined||value(relation.relativeToId)!==undefined)){var delta=need(relation.offsetMm,p+'.relativeElevation.offsetMm'),ref=need(relation.relativeToId,p+'.relativeElevation.relativeToId'),ri=scene.rooms.findIndex(function(x){return x.id===ref;}),rr=rooms.get(ref);if(ri<0||!rr||r.floor!==1||rr.floor!==1)issue('unsupported_relative_datum',p+'.relativeElevation','Only same first-floor reference finish mapping is certified');else{var base=elevation(scene.rooms[ri],ri);if(base!==undefined&&delta!==undefined)offset=base+delta;}}
      else{offset=typeof options.defaultFloorOffset==='function'?options.defaultFloorOffset(r.floor):0;defaultValue(p+'.floorRaiseMm',offset,'Use current editor finish datum as an explicit reference, not a measured absolute elevation');}
      if(offset!==undefined){var hd=(options.targetPlan||{}).heightDefaults||{},fe=((options.targetPlan||{}).floors||{})[r.floor]||{},thickness=hd.perFloor&&finite(fe.floorThickness)?fe.floorThickness:finite(hd.floorThickness)?hd.floorThickness:180;
        if(offset<0&&hd.modelVersion!==2)issue('height_model_incompatible',p+'.relativeElevation','Negative finish offset requires an existing v2 height model; no global migration is performed');
        if(offset>600||offset<-(thickness-20))issue('floor_offset_out_of_range',p+'.relativeElevation','Source level would be clamped by renderer');
        r.floorRaiseMm=offset;
        if(relation&&value(relation.offsetMm)!==undefined)out.evidence.push({path:p+'.compiledFloorRaiseMm',status:'derived',value:offset,reason:'Source relative delta plus explicitly reviewed editor reference datum'});
      }
      resolving.delete(e.id);resolved.add(e.id);return offset;
    }
    scene.rooms.forEach(elevation);
    function boundarySpan(room,start,end,wall){
      var poly=RoomGeometry.polygon(room),dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),u={x:dx/length,y:dy/length},normal={x:-u.y,y:u.x},offset=room.sourceBoundaryBasis==='clear-face'?wall.thick/2:0,intervals=[];
      poly.forEach(function(a,i){var b=poly[(i+1)%poly.length];if(Math.abs((b.x-a.x)*normal.x+(b.y-a.y)*normal.y)>EPS)return;
        var distance=(a.x-start.x)*normal.x+(a.y-start.y)*normal.y;if(Math.abs(Math.abs(distance)-offset)>EPS)return;
        var x=(a.x-start.x)*u.x+(a.y-start.y)*u.y,y=(b.x-start.x)*u.x+(b.y-start.y)*u.y,lo=Math.max(0,Math.min(x,y)),hi=Math.min(length,Math.max(x,y));if(hi>lo)intervals.push([lo,hi]);});
      intervals.sort(function(a,b){return a[0]-b[0];});var covered=0;for(var i=0;i<intervals.length;i++){if(intervals[i][0]>covered+EPS)return false;covered=Math.max(covered,intervals[i][1]);}return covered>=length-EPS;
    }
    scene.openings.forEach(function(e,i){var p='openings['+i+']',n=out.diagnostics.length;sourceEvidence(e,p);appearanceLimits(e,p);var a=need(e.start,p+'.start'),b=need(e.end,p+'.end'),floor=runtimeFloor(e,p),host=need(e.hostWallId,p+'.hostWallId'),kind=need(e.mechanism,p+'.mechanism'),adjacent=need(e.adjacentRoomIds,p+'.adjacentRoomIds');if(errorsSince(n))return;var kinds={swing:'door-swing',pocket:'door-pocket',opening:'door-opening',window:'window'},wall=walls.find(function(w){return w.id===host;});
      if(!kinds[kind]){issue('unsupported_opening_mechanism',p,'Source '+kind+' retained but not certified for bounded materialization');return;}
      if(!wall){issue('invalid_opening_host',p,'Host wall did not compile');return;}
      if((a.x===b.x)===(a.y===b.y)){issue('invalid_opening_span',p,'Gap must be a nonzero axis-aligned span');return;}
      var spec={id:e.id,floor:floor,hostWallId:host,kind:kinds[kind],sourceExactGap:true,center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},widthMm:Math.hypot(a.x-b.x,a.y-b.y),axis:{x:(b.x-a.x)/Math.hypot(a.x-b.x,a.y-b.y),y:(b.y-a.y)/Math.hypot(a.x-b.x,a.y-b.y)},_path:p,_source:e};
      adjacent.filter(Boolean).forEach(function(id){var r=rooms.get(id);if(!r||r.floor!==floor||!boundarySpan(r,a,b,wall))issue('wrong_adjacent_room',p+'.adjacentRoomIds','Entire gap must meet each named logical room boundary under its explicit basis');});
      if(kind==='swing'||kind==='pocket'){
        if(!e.leaves||e.leaves.length!==1){issue('unsupported_leaf_group',p+'.leaves','Exactly one source leaf is currently certified; paired/fold geometry remains retained');return;}
        var l=e.leaves[0],lp=p+'.leaves[0]',w=need(l.leafWidthMm,lp+'.leafWidthMm'),th=value(l.thicknessMm);if(value(l.mechanism)!==kind)issue('source_leaf_mechanism_conflict',lp+'.mechanism','Leaf mechanism contradicts the physical opening mechanism');var relation=value(e.leafRelation);if(relation&&relation!=='single')issue('unsupported_leaf_relation',p+'.leafRelation','Only an explicitly single procedural leaf is supported in this slice');if(value(l.observedPolyline)!==undefined)issue('unsupported_leaf_polyline',lp+'.observedPolyline','Known depicted leaf polyline has no exact physical renderer mapping');var inapplicable=kind==='swing'?['travelDirection','travelDistanceMm','pocketRegion']:['pivot','hingeJamb','swingSide','angleDeg'];inapplicable.forEach(function(key){if(value(l[key])!==undefined)issue('inapplicable_source_leaf_fact',lp+'.'+key,'Known leaf fact does not apply to this mechanism and cannot be silently ignored');});if(kind==='pocket'&&value(l.closedAxis)&&Math.abs(value(l.closedAxis).x*spec.axis.y-value(l.closedAxis).y*spec.axis.x)>EPS)issue('source_leaf_axis_conflict',lp+'.closedAxis','Pocket leaf axis is not parallel to its wall/gap');if(th===undefined){th=36;defaultValue(lp+'.thicknessMm',th,'Panel thickness absent from source; explicit procedural default needs review');}
        spec.sourceLeaf={mechanism:kind,leafWidthMm:w,thicknessMm:th};
        if(kind==='swing'){spec.sourceLeaf.pivot=need(l.pivot,lp+'.pivot');spec.sourceLeaf.closedAxis=need(l.closedAxis,lp+'.closedAxis');spec.swingSide=need(l.swingSide,lp+'.swingSide');var sourceAngle=value(l.angleDeg);spec.sourceLeaf.angleDeg=sourceAngle===undefined?undefined:Math.abs(sourceAngle);if(sourceAngle&&spec.sourceLeaf.closedAxis&&spec.swingSide&&Math.sign(sourceAngle)!==Math.sign(spec.sourceLeaf.closedAxis.x*spec.swingSide.y-spec.sourceLeaf.closedAxis.y*spec.swingSide.x))issue('source_angle_direction_conflict',lp+'.angleDeg','Signed displayed angle disagrees with source swing side');if(spec.sourceLeaf.angleDeg===undefined||(spec.sourceLeaf.angleDeg===0&&value(l.openState)==='closed')){spec.sourceLeaf.angleDeg=90;defaultValue(lp+'.fullTravelAngleDeg',90,'Source does not establish full swing travel (a closed-state angle is not travel); review procedural full-open default');}}
        else{spec.travelDirection=need(l.travelDirection,lp+'.travelDirection');spec.sourceLeaf.closedCenter=value(l.closedCenter);if(!spec.sourceLeaf.closedCenter){spec.sourceLeaf.closedCenter=clone(spec.center);defaultValue(lp+'.closedCenter',spec.sourceLeaf.closedCenter,'Source closed panel center absent; review gap-centered placement');}spec.sourceLeaf.travelDistanceMm=need(l.travelDistanceMm,lp+'.travelDistanceMm');var pocket=need(l.pocketRegion,lp+'.pocketRegion');if(pocket)spec.sourceLeaf.pocketPolygon=RoomGeometry.normalize(pocket).outer;}
        var expectedClosed,expectedOpen;
        if(kind==='swing'&&spec.sourceLeaf.pivot&&spec.sourceLeaf.closedAxis&&w!==undefined){
          var axis=spec.sourceLeaf.closedAxis,pivot=spec.sourceLeaf.pivot,jamb=value(l.hingeJamb),jambDirection=jamb==='start'?1:jamb==='end'?-1:0;
          // Jamb association establishes the closed leaf direction, not an exact
          // pivot coordinate. The source gap and inset/face-offset pivot stay
          // independent; shared geometry still checks their full span and sweep.
          if(jambDirection&&Math.abs(axis.x*spec.axis.x+axis.y*spec.axis.y-jambDirection)>EPS)issue('hinge_jamb_conflict',lp+'.hingeJamb','Source closed leaf direction contradicts the named gap jamb');
          expectedClosed={x:pivot.x+axis.x*w/2,y:pivot.y+axis.y*w/2};
          var side=spec.swingSide;if(side){var sign=axis.x*side.y-axis.y*side.x,ang=spec.sourceLeaf.angleDeg*Math.PI/180*Math.sign(sign),c=Math.cos(ang),sn=Math.sin(ang);expectedOpen={x:pivot.x+(axis.x*c-axis.y*sn)*w/2,y:pivot.y+(axis.x*sn+axis.y*c)*w/2};}
        }else if(kind==='pocket'&&spec.sourceLeaf.closedCenter&&spec.travelDirection&&spec.sourceLeaf.travelDistanceMm!==undefined){expectedClosed=spec.sourceLeaf.closedCenter;expectedOpen={x:expectedClosed.x+spec.travelDirection.x*spec.sourceLeaf.travelDistanceMm,y:expectedClosed.y+spec.travelDirection.y*spec.sourceLeaf.travelDistanceMm};}
        [['closedCenter',expectedClosed],['openCenter',expectedOpen]].forEach(function(pair){var observed=value(l[pair[0]]);if(observed&&pair[1]&&Math.hypot(observed.x-pair[1].x,observed.y-pair[1].y)>EPS)issue('source_leaf_pose_conflict',lp+'.'+pair[0],'Known source pose conflicts with independent width/pivot/travel facts');});
        var state=value(l.openState);if(state===undefined){state='open';defaultValue(lp+'.openState',state,'Source displayed state is unknown; review procedural open-state default');}if(kind==='swing'&&state==='closed'&&value(l.angleDeg)!==undefined&&value(l.angleDeg)!==0)issue('source_leaf_state_conflict',lp+'.openState','Closed displayed state conflicts with nonzero source angle');if(state==='partial')issue('unsupported_partial_open_state',lp+'.openState','Partial displayed state retained; runtime only supports open/closed');else if(state)spec.doorOpenState=state;
      }
      var height=value(e.heightMm);if(height===undefined){height=kind==='window'?1200:2100;defaultValue(p+'.heightMm',height,'Opening height absent from source; procedural default needs review');}if(height<(kind==='window'?200:300)||height>3200)issue('opening_height_out_of_range',p+'.heightMm','Opening height would be clamped by runtime');spec._height=height;
      if(kind==='window'){spec._sill=value(e.sillMm);if(spec._sill===undefined){spec._sill=900;defaultValue(p+'.sillMm',900,'Window sill absent from source; default needs review');}spec._windowKind=value(e.windowKind);if(spec._windowKind===undefined){spec._windowKind='fix';defaultValue(p+'.windowKind','fix','Source window sash type is unknown; review fixed-pane display default');}}
      if(!errorsSince(n))specs.push(spec);
    });
    specs.forEach(function(spec){var result=Openings.compileOpening(spec,walls,specs);result.diagnostics.forEach(function(d){issue('opening_'+d.code,spec._path,d.message);});(result.warnings||[]).forEach(function(d){issue('opening_'+d.code,spec._path,d.message,'warning');});if(!result.ok)return;var it=result.item;it.sceneImportVersion=3;var e=spec._source;
      if(spec.kind==='window'){it.windowHeight=spec._height;it.windowSill=spec._sill;it.windowKind=spec._windowKind;var rs=(value(e.adjacentRoomIds)||[]).filter(Boolean).map(function(id){return rooms.get(id);}).filter(Boolean),limit=options.windowVerticalLimitMm&&options.windowVerticalLimitMm(spec.floor,rs);if(limit!==undefined&&it.windowHeight+it.windowSill>limit){issue('window_vertical_clamp',spec._path,'Window source/default height would exceed runtime wall cut');return;}if(typeof options.normalizeWindow!=='function'||typeof options.windowVerticalLimitMm!=='function'){issue('missing_window_runtime',spec._path,'Exact window vertical values need the actual renderer normalizer and host limit');return;}var normalized=options.normalizeWindow(clone(it));if(!normalized||['windowSill','windowHeight'].some(function(k){return Math.abs(normalized[k]-it[k])>EPS;})){issue('window_vertical_clamp',spec._path,'Known source window values would be clamped or rounded by runtime');return;}}
      else it.doorHeight=spec._height;
      var appearance=e.appearance,b=bindings.get(e.id),color=appearance&&value(appearance.diagramColor);if(color!==undefined){if(!b||b.appearanceMode!=='match-diagram-appearance')issue('appearance_mapping_required',spec._path+'.appearance','Known opening color needs reviewed visualization mapping');else if(typeof color==='string'){if(spec.kind==='door-opening')issue('unsupported_opening_color',spec._path+'.appearance','Fixed passage jamb material cannot honor the known source color');it.color=color;it.colorCustom=true;issue('diagram_appearance_review',spec._path+'.appearance','Drawing fill mapped as display color, not physical finish evidence','review');}else issue('unsupported_opening_color_regions',spec._path+'.appearance.diagramColor','Known regional opening colors have no certified single-color mapping');}
      out.plan.items.push(it);
    });
    function footprint(center,w,d,rot){var a=rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(function(p){var x=p[0]*w/2,y=p[1]*d/2;return {x:center.x+x*c-y*s,y:center.y+x*s+y*c};});}
    // Edge subdivision catches rectangles spanning a concave notch even when every corner fits.
    function contained(room,poly){var boundary=RoomGeometry.polygon(room);return poly.every(function(a,i){var b=poly[(i+1)%poly.length],ts=[0,1];boundary.forEach(function(p){if(a.x!==b.x){var t=(p.x-a.x)/(b.x-a.x);if(t>0&&t<1)ts.push(t);}if(a.y!==b.y){var t=(p.y-a.y)/(b.y-a.y);if(t>0&&t<1)ts.push(t);}});ts.sort(function(a,b){return a-b;});return ts.every(function(t,j){var mid=j?(t+ts[j-1])/2:t;return RoomGeometry.contains(room,{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})&&RoomGeometry.contains(room,{x:a.x+(b.x-a.x)*mid,y:a.y+(b.y-a.y)*mid});});});}
    scene.objects.forEach(function(e,i){var p='objects['+i+']',n=out.diagnostics.length;sourceEvidence(e,p);appearanceLimits(e,p);var b=bindings.get(e.id),place=need(e.placement,p+'.placement'),fp=need(e.sourceFootprint,p+'.sourceFootprint'),type=value(e.objectType);if(type==='unidentified-symbol'&&value(e.semanticExtent)==='symbol-only'){issue('source_annotation_retained',p,'Symbol-only source annotation remains a read-only diagram overlay, not a physical furniture requirement','warning');return;}if(type==='stair'){issue('unsupported_stair_reconstruction',p,'Stair source diagram retained; 3D flight is not certified');return;}if(!b){issue('mapping_unresolved',p+'.binding','Choose an exact catalog binding separately from source evidence');return;}var id=value(b.catalogId),m=id&&registry.get(id);if(!m||m.openingOnly){issue('mapping_unresolved',p+'.binding','Exact non-opening catalog ID is unresolved');return;}if(b.sizingPolicy==='proxy'){issue('proxy_not_exact',p+'.binding','Proxy is retained for preview, not a faithful physical object');return;}if(!place||!fp)return;
      issue('catalog_binding_review',p+'.binding','Review the separate catalog representation; extraction cannot authorize its own asset mapping','review');
      var extent=value(e.semanticExtent);if(extent!==m.semanticExtent)issue('asset_semantic_extent',p+'.semanticExtent','Catalog semantic extent does not match source');
      var rot=Math.atan2(fp.axisX.y,fp.axisX.x)*180/Math.PI,front=value(e.frontDirection),axes={'+Z':{x:0,y:1},'-Z':{x:0,y:-1},'+X':{x:1,y:0},'-X':{x:-1,y:0}};
      if(front){var mf=axes[m.front];if(!mf)issue('mapping_unresolved',p+'.frontDirection','Source front is known but catalog front has not been independently verified');else{rot=(Math.atan2(front.y,front.x)-Math.atan2(mf.y,mf.x))*180/Math.PI;var delta=((rot-Math.atan2(fp.axisX.y,fp.axisX.x)*180/Math.PI)%180+180)%180;if(Math.min(delta,180-delta)>EPS)issue('asset_axis_conflict',p+'.sourceFootprint','Catalog front rotation conflicts with source envelope axes');}}
      var head=value(e.headDirection);
      if(head){var mh=axes[m.head];if(!mh)issue('mapping_unresolved',p+'.headDirection','Known bed head direction requires independently verified catalog head-axis metadata');else{var headRot=(Math.atan2(head.y,head.x)-Math.atan2(mh.y,mh.x))*180/Math.PI;if(front&&Math.abs(Math.atan2(Math.sin((headRot-rot)*Math.PI/180),Math.cos((headRot-rot)*Math.PI/180)))>EPS)issue('asset_head_conflict',p+'.headDirection','Known head and front directions disagree under catalog axes');else if(!front)rot=headRot;}}
      var explicitRot=value(b.rotationDeg);if(explicitRot!==undefined){var rotationDelta=(explicitRot-rot)*Math.PI/180,conflict=front||head?Math.abs(Math.atan2(Math.sin(rotationDelta),Math.cos(rotationDelta)))>EPS:Math.abs(Math.sin(rotationDelta))>EPS;if(conflict)issue('asset_rotation_conflict',p+'.binding','Binding rotation contradicts source front/head/footprint');else rot=explicitRot;}
      if(Math.abs(m.w-fp.sizeMm.w)>EPS||Math.abs(m.d-fp.sizeMm.d)>EPS){if(b.sizingPolicy!=='fit-source')issue('native_size_mismatch',p+'.binding','Native catalog dimensions cannot replace known source footprint');else issue('asset_scaling_review',p+'.binding','Apply reviewed source-envelope scaling; this is not exact product identification','review');}
      var host=place.domain==='room'&&rooms.get(place.roomId),floor=host&&host.floor;
      if(place.domain==='room'&&!host)issue('unknown_host_room',p+'.placement','Source room did not compile');
      if(place.domain==='exterior'){if(type==='car'&&m.kind!=='car')issue('asset_semantic_extent',p+'.binding','Exterior car source requires an actual car asset');if(type!=='car')issue('unsupported_exterior_asset',p+'.placement','Only an exterior car asset is mapped in this slice');floor=1;issue('exterior_ground_review',p+'.placement','Exterior source has no floor datum; review ground-based display placement','review');}
      var it={id:e.id,type:id,floor:floor,rot:rot,x:fp.center.x-fp.sizeMm.w/2,y:fp.center.y-fp.sizeMm.d/2,w:fp.sizeMm.w,d:fp.sizeMm.d,modelFacingVersion:1,sceneImportVersion:3};if(host){it.baseRoom=host.id;if(!contained(host,footprint(fp.center,it.w,it.d,it.rot)))issue('asset_outside_room',p,'Complete source footprint crosses occupied room boundary');}
      if(place.domain==='exterior'){
        var worldFootprint=footprint(fp.center,it.w,it.d,it.rot),region=place.regionId&&out.sourcePreview.polygons.find(function(p){return p.id===place.regionId&&p.collection==='siteRegions';});
        if(place.regionId&&(!region||!contained({shape:{kind:'orthogonalPolygon',outer:region.outer}},worldFootprint)))issue('asset_outside_exterior_region',p+'.placement','Complete source vehicle footprint must fit its known exterior parent region');
        out.sourcePreview.polygons.filter(function(p){return p.collection==='buildingFootprints';}).forEach(function(building){var overlap=RoomGeometry.cells({shape:{kind:'orthogonalPolygon',outer:building.outer}}).some(function(cell){var box=[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.d},{x:cell.x,y:cell.y+cell.d}],axes=[{x:1,y:0},{x:0,y:1}];worldFootprint.forEach(function(a,i){var b=worldFootprint[(i+1)%4],len=Math.hypot(b.x-a.x,b.y-a.y);axes.push({x:-(b.y-a.y)/len,y:(b.x-a.x)/len});});return axes.every(function(axis){var a=worldFootprint.map(function(v){return v.x*axis.x+v.y*axis.y;}),b=box.map(function(v){return v.x*axis.x+v.y*axis.y;});return Math.min(Math.max.apply(null,a),Math.max.apply(null,b))-Math.max(Math.min.apply(null,a),Math.min.apply(null,b))>EPS;});});if(overlap)issue('exterior_asset_intersects_building',p+'.placement','Known source vehicle envelope overlaps the building footprint');});
      }
      var height=value(e.heightMm);if(height!==undefined&&height!==m.h)issue('unsupported_asset_height',p+'.heightMm','Known source height differs from fixed asset height');else if(height===undefined)defaultValue(p+'.heightMm',m.h,'Catalog height is not measured from source');
      if(e.relativeElevation&&(value(e.relativeElevation.offsetMm)!==undefined||value(e.relativeElevation.relativeToId)!==undefined)){var delta=value(e.relativeElevation.offsetMm),reference=value(e.relativeElevation.relativeToId);if(host&&reference===host.id&&delta!==undefined&&delta>=-1000&&delta<=10000)it.elev=delta;else issue('unsupported_object_elevation',p+'.relativeElevation','Known source object elevation lacks a supported finish reference');}else{it.elev=m.defaultElevation||0;defaultValue(p+'.elev',it.elev,'Object elevation is not measured; review catalogue/default reference placement');}
      var color=e.appearance&&value(e.appearance.diagramColor);if(color!==undefined){if(b.appearanceMode!=='match-diagram-appearance')issue('appearance_mapping_required',p+'.appearance','Known diagram color cannot silently become native asset finish');else{issue('diagram_appearance_review',p+'.appearance','Reviewed diagram appearance mapping is a display choice, not physical material evidence','review');if(typeof color==='string'){if(m.genericColor){it.color=color;it.colorCustom=true;}else if(m.finishChannels.length===1){it.finishColors={};it.finishColors[m.finishChannels[0].key]=color;}else issue('appearance_channels_unresolved',p+'.appearance','Multichannel asset needs explicit source-region channel bindings');}else{
          var mappings=b.channels||[],seenChannels=new Set(),mappedRegions=new Set(),retained=(options.bindingDecisions||[]).find(function(d){return d.binding&&d.binding.sourceEntityId===e.id&&d.sourceSnapshot===JSON.stringify(e);}),allowedRegions=retained&&retained.retainedAppearanceRegions||[];
          mappings.forEach(function(ch){var sourceRegion=color.find(function(c){return c.region===ch.sourceRegion;});if(!sourceRegion||sourceRegion.color.toLowerCase()!==ch.color.toLowerCase()){issue('appearance_mapping_conflict',p+'.appearance','Mapped color must match its retained source region');return;}if(seenChannels.has(ch.channel)){issue('appearance_channel_conflict',p+'.appearance','Distinct source regions cannot silently overwrite one renderer channel');return;}seenChannels.add(ch.channel);
            if(m.genericColor&&ch.channel==='color'){it.color=ch.color;it.colorCustom=true;mappedRegions.add(ch.sourceRegion);}
            else if(m.finishChannels.some(function(c){return c.key===ch.channel;})){it.finishColors=it.finishColors||{};it.finishColors[ch.channel]=ch.color;mappedRegions.add(ch.sourceRegion);}
            else issue('unknown_finish_channel',p+'.appearance','Asset cannot render the selected color channel');
          });
          var missing=color.filter(function(c){return !mappedRegions.has(c.region);});
          if(missing.length){if(missing.every(function(c){return allowedRegions.indexOf(c.region)>=0;})){
            out.sourcePreview.overlayEntityIds=out.sourcePreview.overlayEntityIds||[];out.sourcePreview.overlayEntityIds.push(e.id);
            out.unmatchedSourceRegions=out.unmatchedSourceRegions||[];missing.forEach(function(c){out.unmatchedSourceRegions.push({entityId:e.id,region:c.region,color:c.color,representation:'source-overlay-only'});});
            issue('appearance_region_overlay_review',p+'.appearance','Explicitly retain unmapped color regions as source overlays; physical appearance is incomplete','review');
          }else issue('appearance_channels_unresolved',p+'.appearance','Every known regional color needs mapping or an explicit separate retain-overlay decision');}
        }}}

      if(!errorsSince(n))out.plan.items.push(it);
    });
    scene.siteRegions.forEach(function(e,i){issue('site_overlay_review','siteRegions['+i+']','Site region is preserved as a read-only source overlay, not a physical 3D surface','review');});
    scene.connections.forEach(function(e,i){var op=value(e.openingId),pair=value(e.rooms),source=scene.openings.find(function(o){return o.id===op;}),adjacent=source&&value(source.adjacentRoomIds);if(value(e.requiredTraversable)&&(!pair||pair[0]===pair[1]||!pair.every(function(id){return rooms.has(id)&&adjacent&&adjacent.indexOf(id)>=0;})||!out.plan.items.some(function(it){return it.id===op&&it.type.indexOf('door-')===0;})))issue('missing_traversable_connection','connections['+i+']','Required physical opening must compile and adjoin both named logical rooms');});
    var omittedCodes=['mapping_unresolved','proxy_not_exact','asset_semantic_extent','unsupported_asset_height'];
    ['annotations','walls','rooms','openings','objects','siteRegions','buildingFootprints','bindings','connections'].forEach(function(k){scene[k].forEach(function(e,i){var p=k+'['+i+']',group=k+':'+e.id,ds=out.diagnostics.filter(function(d){return d.path===p||d.path.indexOf(p+'.')===0;}),errors=ds.filter(function(d){return d.severity==='error';}),critical=k!=='objects'||value(e.objectType)==='stair',eligible=!critical&&errors.length&&errors.every(function(d){return omittedCodes.indexOf(d.code)>=0;}),context={placementContext:out.placementContext,pageScope:options.pageScope||null,retainedAppearanceRegions:(options.bindingDecisions||[]).filter(function(d){return d.binding&&d.binding.sourceEntityId===e.id;}).map(function(d){return d.retainedAppearanceRegions||[];}),heightDefaults:(options.targetPlan||{}).heightDefaults||{},floors:(options.targetPlan||{}).floors||{},defaults:out.defaults.filter(function(d){return d.path===p||d.path.indexOf(p+'.')===0;}),catalogue:scene.bindings.filter(function(b){return b.sourceEntityId===e.id;}).map(function(b){return registry.get(value(b.catalogId));})},key=reviewKey(scene,e,context),fresh=snapshots[e.id]===key,decision=(options.unresolvedDecisions||[]).find(function(d){return d.entityId===e.id&&d.decision==='leave-unplaced'&&d.classification==='noncritical-decoration';}),omitted=!!(eligible&&fresh&&decision);if(omitted){ds.forEach(function(d){d.acknowledgedOmission=true;});out.acknowledgedOmissions.push(e.id);}var g={id:group,reviewKey:key,entityId:e.id,collection:k,path:p,label:value(e.name)||e.id,diagnostics:ds,evidence:out.evidence.filter(function(f){return f.path.indexOf('scene.'+p+'.')===0||f.path.indexOf(p+'.')===0;}),reviewPaths:ds.filter(function(d){return d.severity==='review';}).map(function(d){return d.path;}),canAcknowledgeOmission:!!eligible,acknowledgedOmission:omitted,accepted:fresh&&acceptedGroups.indexOf(group)>=0};out.reviewGroups.push(g);if(errors.length)out.unresolvedEntities.push({id:e.id,collection:k,source:clone(e),reasons:errors,acknowledgedOmission:omitted,decision:omitted?clone(decision):null});});});
    if(PlanSchema){var runtimeValidation=PlanSchema.validatePlan(out.plan);runtimeValidation.errors.forEach(function(message){issue('invalid_runtime_plan','scene',message);});}else issue('missing_runtime_schema','scene','Runtime plan validator is required before Apply');
    if(!out.plan.walls.length&&!out.plan.rooms.length&&!out.plan.items.length)issue('empty_materialization','scene','No supported physical source geometry is ready to apply');
    out.canApply=!out.diagnostics.some(function(d){if(d.acknowledgedOmission)return false;if(d.severity==='error')return true;if(d.severity!=='review')return false;var g=out.reviewGroups.find(function(g){return d.path===g.path||d.path.indexOf(g.path+'.')===0;});return !(g&&snapshots[g.entityId]===g.reviewKey&&(g.accepted||accepted.indexOf(d.path)>=0));});
    out.reconstructionStatus=scene.siteRegions.length||out.acknowledgedOmissions.length||(out.unmatchedSourceRegions||[]).length?'incomplete-source-overlays':'bounded-draft';
    return out;
  }
  return {compile:compile,reviewKey:reviewKey,sourceHash:sourceHash,createPlacementContext:createPlacementContext};
}));
