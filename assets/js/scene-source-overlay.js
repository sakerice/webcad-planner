/* Read-only source diagrams. Never creates editable rooms, walls or physical site surfaces. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SceneSourceOverlay=factory();}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function val(f){return f&&f.value!==null?f.value:undefined;}
  function color(e){var c=e&&e.appearance&&val(e.appearance.diagramColor);if(Array.isArray(c))c=(c.find(function(r){return r.region==='body';})||c[0]||{}).color;return typeof c==='string'&&/^#[a-f0-9]{6}$/i.test(c)?c:'#43758b';}
  function known(f){return !!(f&&['observed','inferred'].indexOf(f.status)>=0&&typeof f.source==='string'&&f.source.trim()&&(f.status!=='inferred'||typeof f.reason==='string'&&f.reason.trim()));}
  function point(p){return !!(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1000000&&Math.abs(p.y)<=1000000);}
  // Typed bypass relation is the gap-parallel reference basis, not a certified
  // physical track/orientation. An explicit leaf axis must also agree.
  function bypassClosedLines(e,a,b){
    if(!known(e.mechanism)||val(e.mechanism)!=='bypass-slide'||!known(e.leafRelation)||val(e.leafRelation)!=='bypass'||!known(e.start)||!known(e.end)||!point(a)||!point(b))return [];
    var dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),leaves=e.leaves;
    if(!Number.isFinite(len)||!len||!Array.isArray(leaves)||leaves.length!==2||leaves.some(function(l){return !l||typeof l.id!=='string'||!l.id;})||leaves[0].id===leaves[1].id)return [];
    var u={x:dx/len,y:dy/len},out=[];
    for(var i=0;i<leaves.length;i++){
      var l=leaves[i],c=val(l.closedCenter),w=val(l.leafWidthMm),axis=val(l.closedAxis);
      if(!known(l.mechanism)||val(l.mechanism)!=='slide'||!known(l.closedCenter)||!point(c)||!known(l.leafWidthMm)||!Number.isFinite(w)||w<=0||w>1000000)return [];
      if(l.closedAxis!==undefined){
        if(!known(l.closedAxis)||!point(axis))return [];
        var n=Math.hypot(axis.x,axis.y);
        if(!n||Math.abs(n-1)>Math.SQRT2*.00005||Math.abs(axis.x/n*u.y-axis.y/n*u.x)>1e-6)return [];
      }
      out.push({kind:'line',id:e.id,sourceLeafId:l.id,points:[{x:c.x-u.x*w/2,y:c.y-u.y*w/2},{x:c.x+u.x*w/2,y:c.y+u.y*w/2}],color:color(e),floor:val(e.floor)||1,dashed:true,
        referenceOnly:true,referenceRole:'bypass-closed-leaf',leafWidthMm:w,parallelBasis:l.closedAxis?'typed-bypass-relation-and-parallel-closed-axis':'typed-bypass-relation-and-gap-direction',
        sourceFactStatus:{mechanism:e.mechanism.status,leafRelation:e.leafRelation.status,start:e.start.status,end:e.end.status,closedCenter:l.closedCenter.status,leafWidthMm:l.leafWidthMm.status}});
    }
    return out;
  }
  function primitives(report,all){
    var ir=report.originalIR||{},preview=report.sourcePreview||{},mapped=report.sourceIdMap||{},out=[],entities=new Map();
    function direction(v,p){var d=(preview.directionDerivations||[]).find(function(d){return d.path===p;});return d?d.derived:v;}
    ['rooms','siteRegions','buildingFootprints','objects','openings'].forEach(function(k){(ir[k]||[]).forEach(function(e){entities.set(e.id,e);});});
    (preview.polygons||[]).forEach(function(p){var e=entities.get(p.id)||{};if(!all&&p.collection==='rooms'&&mapped[p.id])return;out.push({kind:'polygon',id:p.id,points:p.outer,color:color(e),floor:val(e.floor)||1,label:p.id+' [source]',collection:p.collection});});
    (preview.objects||[]).forEach(function(e,i){if(!all&&mapped[e.id]&&(preview.overlayEntityIds||[]).indexOf(e.id)<0)return;var f=val(e.sourceFootprint),place=val(e.placement),room=place&&place.roomId&&entities.get(place.roomId),floor=room&&val(room.floor)||1;if(f){var u=direction(f.axisX,'objects['+i+'].sourceFootprint.axisX'),n={x:-u.y,y:u.x};out.push({kind:'object',id:e.id,points:[[-1,-1],[1,-1],[1,1],[-1,1]].map(function(p){return {x:f.center.x+p[0]*f.sizeMm.w/2*u.x+p[1]*f.sizeMm.d/2*n.x,y:f.center.y+p[0]*f.sizeMm.w/2*u.y+p[1]*f.sizeMm.d/2*n.y};}),center:f.center,front:direction(val(e.frontDirection),'objects['+i+'].frontDirection'),regionColors:Array.isArray(e.appearance&&val(e.appearance.diagramColor))?val(e.appearance.diagramColor):[],color:color(e),floor:floor,label:val(e.objectType)+' [source]'});}(val(e.diagramSegments)||[]).forEach(function(s){out.push({kind:'line',id:e.id,points:s.points,color:color(e),floor:floor,dashed:s.visibility==='dashed'});});});
    (preview.openings||[]).forEach(function(e){if(!all&&mapped[e.id])return;var a=val(e.start),b=val(e.end);if(a&&b){
      var leaves=bypassClosedLines(e,a,b);
      out.push({kind:'line',id:e.id,points:[a,b],color:color(e),floor:val(e.floor)||1,label:leaves.length?'原図の閉位置・移動未確認 [source]':val(e.mechanism)+' [source]'});
      out=out.concat(leaves);
    }});
    return out;
  }
  // Registration v1 retains symbols separately from physical editable objects.
  // Render the original footprints as annotations; never infer height or stair holes.
  function buildingPrimitives(report){
    var source=report.sourceLocal||{},poses=report.poses||{},out=[];
    function rectangle(e,id,label,registered){
      if(!e||!Number.isFinite(e.x)||!Number.isFinite(e.y)||!Number.isFinite(e.w)||!Number.isFinite(e.d)||e.w<=0||e.d<=0)return;
      var pose=poses[e.floor];if(!registered&&!pose)return;
      var a=(e.rot||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      var points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(function(v){
        var x=e.x+v[0]*e.w/2*c-v[1]*e.d/2*s,y=e.y+v[0]*e.w/2*s+v[1]*e.d/2*c;
        if(registered)return {x:x,y:y};
        var q=pose.quarterTurns;if(q===1)return {x:-y+pose.dx,y:x+pose.dy};if(q===2)return {x:-x+pose.dx,y:-y+pose.dy};if(q===3)return {x:y+pose.dx,y:-x+pose.dy};return {x:x+pose.dx,y:y+pose.dy};
      });
      out.push({kind:'object',id:id,points:points,color:'#aa6324',floor:e.floor,label:registered?'元階段記号（階接続未確認）':label,dashed:true,collection:'source-symbols'});
    }
    (report.deferredItems||[]).forEach(function(e,i){rectangle(e,'deferred-'+i,e.type,true);});
    (source.marks||[]).forEach(function(e,i){rectangle(e,'mark-'+i,e.label||'',false);});
    return out;
  }
  function render(ctx,items,map,floor,options){options=options||{};ctx.save();ctx.lineWidth=1.5;ctx.font='11px sans-serif';items.forEach(function(p){if(floor&&p.floor!==floor)return;var pts=p.points.map(map);if(!pts.length)return;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(function(q){ctx.lineTo(q.x,q.y);});if(p.kind!=='line')ctx.closePath();var selected=(options.highlightIds||[]).indexOf(p.id)>=0;ctx.lineWidth=selected?3:1.5;ctx.strokeStyle=selected?'#ef604b':p.color;ctx.setLineDash(p.dashed===false?[]:[5,4]);ctx.stroke();if(p.kind!=='line'){ctx.globalAlpha=.12;ctx.fillStyle=p.color;ctx.fill();ctx.globalAlpha=1;}if(p.label&&(!options.quietLabels||selected)){ctx.fillStyle=p.color;ctx.fillText(p.label,pts[0].x+3,pts[0].y-5);}(options.quietLabels&&!selected?[]:p.regionColors||[]).forEach(function(region,index){var y=pts[0].y+12+index*14;ctx.fillStyle=region.color;ctx.fillRect(pts[0].x+3,y-8,9,9);ctx.fillText(region.region+' '+region.color,pts[0].x+16,y);});if(p.center&&p.front){var c=map(p.center),q=map({x:p.center.x+p.front.x*350,y:p.center.y+p.front.y*350});ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.beginPath();ctx.arc(q.x,q.y,2.5,0,Math.PI*2);ctx.fill();}});ctx.restore();}
  function draw(ctx,data,state){var scale=state.zoom*.05;(data.sceneReconstructionReports||[]).filter(function(r){return r.version===3||r.kind==='building-registration'&&r.version===1;}).forEach(function(r){var t=r.translation||{x:0,y:0};render(ctx,r.version===3?primitives(r,false):buildingPrimitives(r),function(p){return {x:state.panX+(p.x+t.x)*scale,y:state.panY+(p.y+t.y)*scale};},state.floor);});}
  function drawPreview(canvas,scene,preview,options){options=options||{};if(!canvas||!canvas.getContext)return;var ctx=canvas.getContext('2d');if(!ctx)return;var items=primitives({originalIR:scene,sourcePreview:preview},true);
    // Selection-only reference marks use retained endpoints without materializing walls.
    (scene.walls||[]).forEach(function(w){if((options.highlightIds||[]).indexOf(w.id)<0)return;var a=val(w.start),b=val(w.end);if(point(a)&&point(b))items.push({kind:'line',id:w.id,points:[a,b],color:'#ef604b',dashed:true,label:w.id+' [source]'});});
    var points=items.flatMap(function(p){return p.points;});ctx.clearRect(0,0,canvas.width,canvas.height);if(!points.length)return;var xs=points.map(function(p){return p.x;}),ys=points.map(function(p){return p.y;}),x=Math.min.apply(null,xs),y=Math.min.apply(null,ys),w=Math.max.apply(null,xs)-x,d=Math.max.apply(null,ys)-y,scale=Math.min((canvas.width-50)/Math.max(1,w),(canvas.height-50)/Math.max(1,d));render(ctx,items,function(p){return {x:25+(p.x-x)*scale,y:25+(p.y-y)*scale};},null,options);}
  return {primitives:primitives,buildingPrimitives:buildingPrimitives,draw:draw,drawPreview:drawPreview};
}));
