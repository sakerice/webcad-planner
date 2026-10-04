/* One logical room, one occupied outline. AABB fields are compatibility caches only. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.RoomGeometry=factory();
}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  var LIMIT=1000000, MAX_VERTICES=64, EPS=1e-7;
  function finite(n){return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=LIMIT;}
  function signedArea(p){return p.reduce(function(a,v,i){var q=p[(i+1)%p.length];return a+v.x*q.y-q.x*v.y;},0)/2;}
  function onSegment(p,a,b){return Math.abs((p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;}
  function inside(p,pt){
    var yes=false;
    for(var i=0,j=p.length-1;i<p.length;j=i++){
      var a=p[j],b=p[i]; if(onSegment(pt,a,b)) return true;
      if((a.y>pt.y)!==(b.y>pt.y)&&pt.x<(b.x-a.x)*(pt.y-a.y)/(b.y-a.y)+a.x) yes=!yes;
    }
    return yes;
  }
  function normalizePolygon(input){
    if(!Array.isArray(input)||input.length<4||input.length>MAX_VERTICES+1) throw Error('Room outline requires 4–64 vertices');
    var p=input.map(function(v){if(!v||!finite(v.x)||!finite(v.y)) throw Error('Room coordinates must be finite and bounded');return {x:v.x,y:v.y};});
    if(p.length>1&&p[0].x===p[p.length-1].x&&p[0].y===p[p.length-1].y)p.pop();
    if(p.length>MAX_VERTICES)throw Error('Too many room vertices');
    for(var i=0;i<p.length;i++){
      var a=p[i],b=p[(i+1)%p.length];
      if((a.x===b.x)===(a.y===b.y))throw Error('Room edges must be nonzero and orthogonal');
      for(var j=i+1;j<p.length;j++){
        if(j===i+1||(i===0&&j===p.length-1))continue;
        var c=p[j],d=p[(j+1)%p.length];
        if(Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+EPS&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+EPS)throw Error('Room outline self-intersects or touches');
      }
    }
    // Reject adjacent backtracking before removing redundant collinear points.
    for(var k=p.length-1;k>=0;k--){
      var prev=p[(k+p.length-1)%p.length],cur=p[k],next=p[(k+1)%p.length];
      if((prev.x===cur.x&&cur.x===next.x)||(prev.y===cur.y&&cur.y===next.y)){
        if((cur.x-prev.x)*(next.x-cur.x)+(cur.y-prev.y)*(next.y-cur.y)<=0)throw Error('Room outline backtracks');
        p.splice(k,1);
      }
    }
    var area=signedArea(p); if(Math.abs(area)<EPS)throw Error('Room area must be positive');
    if(area<0)p.reverse();
    var start=0;for(var n=1;n<p.length;n++)if(p[n].y<p[start].y||(p[n].y===p[start].y&&p[n].x<p[start].x))start=n;
    return p.slice(start).concat(p.slice(0,start));
  }
  function normalize(shape){
    if(!shape||shape.holes)throw Error('Room holes are unsupported');
    if(shape.kind==='orthogonalPolygon')return {kind:'orthogonalPolygon',outer:normalizePolygon(shape.outer)};
    if(shape.kind!=='rectUnion'||!Array.isArray(shape.rectangles)||!shape.rectangles.length||shape.rectangles.length>32)throw Error('Unsupported room shape');
    var rs=shape.rectangles, xs=[],ys=[];
    rs.forEach(function(r){if(!r||![r.x,r.y,r.w,r.d,r.x+r.w,r.y+r.d].every(finite)||r.w<=0||r.d<=0)throw Error('Invalid room rectangle');xs.push(r.x,r.x+r.w);ys.push(r.y,r.y+r.d);});
    xs=Array.from(new Set(xs)).sort(function(a,b){return a-b;});ys=Array.from(new Set(ys)).sort(function(a,b){return a-b;});
    var occupied={};
    for(var x=0;x<xs.length-1;x++)for(var y=0;y<ys.length-1;y++)if(rs.some(function(r){return (xs[x]+xs[x+1])/2>r.x&&(xs[x]+xs[x+1])/2<r.x+r.w&&(ys[y]+ys[y+1])/2>r.y&&(ys[y]+ys[y+1])/2<r.y+r.d;}))occupied[x+','+y]=true;
    var edges=[], starts={};
    function edge(ax,ay,bx,by){var e={a:{x:xs[ax],y:ys[ay]},b:{x:xs[bx],y:ys[by]}};var key=e.a.x+','+e.a.y;if(starts[key])throw Error('Point-connected rooms are unsupported');starts[key]=e;edges.push(e);}
    Object.keys(occupied).forEach(function(key){var c=key.split(',').map(Number),x=c[0],y=c[1];if(!occupied[x+','+(y-1)])edge(x,y,x+1,y);if(!occupied[(x+1)+','+y])edge(x+1,y,x+1,y+1);if(!occupied[x+','+(y+1)])edge(x+1,y+1,x,y+1);if(!occupied[(x-1)+','+y])edge(x,y+1,x,y);});
    var out=[],e=edges[0],seen=new Set();while(e&&!seen.has(e)){seen.add(e);out.push(e.a);e=starts[e.b.x+','+e.b.y];}
    if(e!==edges[0]||seen.size!==edges.length)throw Error('Disconnected rooms and room holes are unsupported');
    // A union can have many collinear grid vertices before canonical simplification.
    out=out.filter(function(p,i){var a=out[(i+out.length-1)%out.length],b=out[(i+1)%out.length];return !((a.x===p.x&&p.x===b.x)||(a.y===p.y&&p.y===b.y));});
    return {kind:'orthogonalPolygon',outer:normalizePolygon(out)};
  }
  function polygon(room){
    if(room&&room.shape)return room.shape.kind==='orthogonalPolygon'&&Array.isArray(room.shape.outer)?room.shape.outer:normalize(room.shape).outer;
    return [{x:room.x,y:room.y},{x:room.x+room.w,y:room.y},{x:room.x+room.w,y:room.y+room.d},{x:room.x,y:room.y+room.d}];
  }
  function bounds(room){var p=polygon(room),xs=p.map(function(v){return v.x;}),ys=p.map(function(v){return v.y;}),x=Math.min.apply(null,xs),y=Math.min.apply(null,ys);return {x:x,y:y,w:Math.max.apply(null,xs)-x,d:Math.max.apply(null,ys)-y};}
  function contains(room,p,y){return !!room&&inside(polygon(room),typeof p==='number'?{x:p,y:y}:p);}
  function cells(room){
    var p=polygon(room),xs=Array.from(new Set(p.map(function(v){return v.x;}))).sort(function(a,b){return a-b;}),ys=Array.from(new Set(p.map(function(v){return v.y;}))).sort(function(a,b){return a-b;}),out=[];
    for(var i=0;i<xs.length-1;i++)for(var j=0;j<ys.length-1;j++)if(inside(p,{x:(xs[i]+xs[i+1])/2,y:(ys[j]+ys[j+1])/2}))out.push({x:xs[i],y:ys[j],w:xs[i+1]-xs[i],d:ys[j+1]-ys[j]});
    return out;
  }
  function samplePoints(room,fractions){
    fractions=fractions||[0.18,0.5,0.82];
    return cells(room).reduce(function(out,c){fractions.forEach(function(fx){fractions.forEach(function(fy){out.push({x:c.x+c.w*fx,y:c.y+c.d*fy});});});return out;},[]);
  }
  function gridPoints(room,pitchMm){
    return cells(room).reduce(function(out,c){
      var nx=Math.max(1,Math.round(c.w/pitchMm)),ny=Math.max(1,Math.round(c.d/pitchMm));
      for(var x=0;x<nx;x++)for(var y=0;y<ny;y++)out.push({x:c.x+c.w*(x+0.5)/nx,y:c.y+c.d*(y+0.5)/ny});
      return out;
    },[]);
  }
  function labelAnchor(room){var b=bounds(room),center={x:b.x+b.w/2,y:b.y+b.d/2};if(contains(room,center)&&!polygon(room).some(function(p,i,a){return onSegment(center,p,a[(i+1)%a.length]);}))return center;var rs=cells(room).sort(function(a,b){return b.w*b.d-a.w*a.d;});return {x:rs[0].x+rs[0].w/2,y:rs[0].y+rs[0].d/2};}
  function setBounds(room,next,base){
    base=base||room;var old=bounds(base),b=Object.assign({},old,next);
    if(![b.x,b.y,b.w,b.d,b.x+b.w,b.y+b.d].every(finite)||b.w<=0||b.d<=0)throw Error('Invalid room bounds');
    if(base.shape)room.shape=Object.assign({},base.shape,{kind:'orthogonalPolygon',outer:normalizePolygon(polygon(base).map(function(p){return {x:b.x+(p.x-old.x)*b.w/old.w,y:b.y+(p.y-old.y)*b.d/old.d};}))});
    Object.assign(room,b);return room;
  }
  function translate(room,dx,dy,base){base=base||room;var b=bounds(base);return setBounds(room,{x:b.x+dx,y:b.y+dy},base);}
  function trace(ctx,room,map){var p=polygon(room);ctx.beginPath();p.forEach(function(v,i){var q=map?map(v):v;if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();}
  return {normalize:normalize,polygon:polygon,bounds:bounds,contains:contains,cells:cells,samplePoints:samplePoints,gridPoints:gridPoints,labelAnchor:labelAnchor,area:function(r){return Math.abs(signedArea(polygon(r)));},translate:translate,resize:setBounds,setBounds:setBounds,trace:trace};
}));
