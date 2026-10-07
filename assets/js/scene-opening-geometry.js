// Strict, opt-in Scene IR opening compiler. It never chooses a nearby wall,
// moves an opening or reverses its intent. The additive openingHostWallId is
// persisted with new compiled items; legacy items remain unchanged.
// All coordinates and the renderer's canonical leaf parameters are millimetres.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SceneOpeningGeometry = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EPS = 1e-6;
  var TYPES = ['door-swing', 'door-swing-s', 'door-front', 'door-slide-s', 'door-pocket', 'door-slide', 'door-opening', 'window', 'window-door'];
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function point(p) { return !!p && finite(p.x) && finite(p.y); }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function diff(a, b) { return {x:a.x - b.x, y:a.y - b.y}; }
  function scale(p, s) { return {x:p.x * s, y:p.y * s}; }
  function near(a, b) { return Math.abs(a - b) <= EPS; }
  function samePoint(a, b) { return point(a) && point(b) && Math.hypot(a.x - b.x, a.y - b.y) <= EPS; }
  function unit(p) {
    if (!point(p)) return null;
    var len = Math.hypot(p.x, p.y);
    return len > EPS ? scale(p, 1 / len) : null;
  }
  function parallelSign(p, axis) {
    var v = unit(p);
    if (!v || Math.abs(v.x * axis.y - v.y * axis.x) > EPS) return 0;
    return dot(v, axis) < 0 ? -1 : 1;
  }
  function wallFrame(w) {
    if (!w || ![w.x1,w.y1,w.x2,w.y2,w.thick].every(finite) || w.thick <= 0) return null;
    var dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy);
    if (len < 1) return null;
    return {wall:w, origin:{x:w.x1,y:w.y1}, u:{x:dx/len,y:dy/len}, n:{x:-dy/len,y:dx/len}, length:len};
  }
  function world(frame, center, x, y) {
    return {x:center.x + frame.u.x*x + frame.n.x*y, y:center.y + frame.u.y*x + frame.n.y*y};
  }

  // These values are consumed by buildWinFrames itself. They are the existing
  // procedural meshes, including the 60 mm overlap and 30 mm extra travel;
  // the compiler must not substitute the simpler, schematic 2D symbol sizes.
  function rendererParameters(item, wallThicknessMm) {
    var w=Number(item&&item.w);
    if (!item || !finite(w) || w <= 0) return null;
    if (item.openingSourceGeometry) return Object.assign({},item.openingSourceGeometry);
    if (item.type === 'door-opening' || item.type === 'window' || item.type === 'window-door') return {mode:'opening'};
    if (item.type === 'door-slide-s' || item.type === 'door-pocket') {
      var dir = item.flipX ? -1 : 1;
      return {mode:'single', direction:dir, leafWidthMm:w+60, leafThicknessMm:36,
        closedXmm:0, openXmm:dir*(w+30),
        leafZmm:item.type==='door-pocket'?0:(item.flipY?1:-1)*(wallThicknessMm/2+18+8)};
    }
    if (item.type === 'door-slide') {
      var leftOpen = !!item.flipX;
      return {mode:'bypass', leafWidthMm:w*0.54, leafThicknessMm:36,
        leftXmm:-w*0.23, rightXmm:w*0.23,
        fixedXmm:leftOpen?w*0.23:-w*0.23,
        closedXmm:leftOpen?-w*0.23:w*0.23,
        openXmm:leftOpen?w*0.23:-w*0.23,
        fixedZmm:-19, leafZmm:19};
    }
    if (item.type === 'door-swing' || item.type === 'door-swing-s' || item.type === 'door-front') {
      return {mode:'hinge', hingeXmm:item.flipX?w/2:-w/2,
        // This is the leaf mesh centre relative to its hinge, not the latch.
        leafCenterXmm:item.flipX?-w/2:w/2,
        leafWidthMm:w, leafThicknessMm:item.type==='door-front'?60:36,
        openAngleY:-(item.flipY?-1:1)*Math.PI/2};
    }
    return null;
  }
  function wallCutWidthMm(item, wallLengthMm) {
    if(item.openingSourceGeometry) return Number(item.w);
    return Math.min(wallLengthMm,item.type==='window'||item.type==='window-door'?
      Math.max(Number(item.w),100):Math.max(Number(item.w)+80,450));
  }
  function wallPolygon(w) {
    var f=wallFrame(w),c={x:(w.x1+w.x2)/2,y:(w.y1+w.y2)/2};
    return leafRectangle(f,c,0,0,f.length,w.thick);
  }
  // Strict positive-area intersection: exact contact is allowed, penetration
  // is not. Projection intervals avoid pixel/grid sampling and miss no gaps.
  function polygonsOverlap(a,b) {
    var shapes=[a,b];
    for(var k=0;k<shapes.length;k++) for(var i=0;i<shapes[k].length;i++){
      var s=shapes[k],q=s[i],r=s[(i+1)%s.length],n=unit({x:q.y-r.y,y:r.x-q.x});
      if(!n) continue;
      var aa=a.map(function(v){return dot(v,n);}),bb=b.map(function(v){return dot(v,n);});
      if(Math.min.apply(null,aa)>=Math.max.apply(null,bb)-EPS || Math.min.apply(null,bb)>=Math.max.apply(null,aa)-EPS) return false;
    }
    return true;
  }
  function contactAngles(a,b,c,lo,hi) {
    var radius=Math.hypot(a,b),out=[];
    if(radius<EPS || Math.abs(c)>radius+EPS) return out;
    var phase=Math.atan2(b,a),delta=Math.acos(Math.max(-1,Math.min(1,c/radius)));
    [-delta,delta].forEach(function(d){
      for(var k=-2;k<=2;k++){
        var angle=phase+d+k*Math.PI*2;
        if(angle>lo+EPS&&angle<hi-EPS)out.push(angle);
      }
    });
    return out;
  }
  function hingeSweepOverlaps(frame,center,p,obstacle) {
    var pivot=world(frame,center,p.hingeXmm,p.hingeZmm||0);
    var fixed=obstacle.map(function(v){var d=diff(v,pivot);return {x:dot(d,frame.u),y:dot(d,frame.n)};});
    var moving=[{x:p.leafCenterXmm-p.leafWidthMm/2,y:-p.leafThicknessMm/2},
      {x:p.leafCenterXmm+p.leafWidthMm/2,y:-p.leafThicknessMm/2},
      {x:p.leafCenterXmm+p.leafWidthMm/2,y:p.leafThicknessMm/2},
      {x:p.leafCenterXmm-p.leafWidthMm/2,y:p.leafThicknessMm/2}];
    var end=-p.openAngleY,lo=Math.min(0,end),hi=Math.max(0,end),angles=[lo,hi];
    // Every overlap transition is a vertex/edge contact. Solve all such
    // trigonometric roots analytically, then inspect the intervals between.
    [false,true].forEach(function(inverse){
      var edges=inverse?moving:fixed,vertices=inverse?fixed:moving;
      for(var i=0;i<edges.length;i++){
        var e=edges[i],f=edges[(i+1)%edges.length],n={x:e.y-f.y,y:f.x-e.x},c=dot(e,n);
        vertices.forEach(function(v){
          var a=dot(v,n),b=inverse?n.x*v.y-n.y*v.x:-n.x*v.y+n.y*v.x;
          angles=angles.concat(contactAngles(a,b,c,lo,hi));
        });
      }
    });
    angles.sort(function(a,b){return a-b;});
    function at(angle){
      var c=Math.cos(angle),s=Math.sin(angle);
      return moving.map(function(v){return {x:c*v.x-s*v.y,y:s*v.x+c*v.y};});
    }
    if(polygonsOverlap(at(lo),fixed)||polygonsOverlap(at(hi),fixed))return true;
    for(var j=1;j<angles.length;j++) if(angles[j]-angles[j-1]>EPS&&polygonsOverlap(at((angles[j]+angles[j-1])/2),fixed))return true;
    return false;
  }
  function leafRectangle(frame, center, x, z, width, thickness) {
    return [[x-width/2,z-thickness/2],[x+width/2,z-thickness/2],
      [x+width/2,z+thickness/2],[x-width/2,z+thickness/2]].map(function(p){return world(frame,center,p[0],p[1]);});
  }
  function hingeLeaf(frame, center, p, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    return [[p.leafCenterXmm-p.leafWidthMm/2,-p.leafThicknessMm/2],
      [p.leafCenterXmm+p.leafWidthMm/2,-p.leafThicknessMm/2],
      [p.leafCenterXmm+p.leafWidthMm/2,p.leafThicknessMm/2],
      [p.leafCenterXmm-p.leafWidthMm/2,p.leafThicknessMm/2]].map(function(q){
        // THREE rotation.y: x'=cos*x+sin*z, z'=-sin*x+cos*z.
        return world(frame,center,p.hingeXmm+c*q[0]+s*q[1],(p.hingeZmm||0)-s*q[0]+c*q[1]);
      });
  }
  function mergeIntervals(intervals) {
    var out = [];
    intervals.slice().sort(function(a,b){return a[0]-b[0];}).forEach(function(i){
      var prev = out[out.length-1];
      if (prev && i[0] <= prev[1]+EPS) prev[1] = Math.max(prev[1],i[1]);
      else out.push(i.slice());
    });
    return out;
  }
  function subtractIntervals(intervals, holes) {
    var out = mergeIntervals(intervals);
    mergeIntervals(holes).forEach(function(h){
      var next=[];
      out.forEach(function(i){
        if (h[1] <= i[0]+EPS || h[0] >= i[1]-EPS) next.push(i);
        else {
          if (h[0] > i[0]+EPS) next.push([i[0],h[0]]);
          if (h[1] < i[1]-EPS) next.push([h[1],i[1]]);
        }
      });
      out=next;
    });
    return out;
  }
  function missingIntervals(required, available) {
    return subtractIntervals([required],available);
  }

  // Source geometry is deliberately bounded to one procedural panel. All
  // saved values are host-local so copies/moves need no stale world caches.
  function sourceParameters(spec, frame, center, fail) {
    var s=spec.sourceLeaf;
    if(!s || typeof s!=='object' || Array.isArray(s)) {fail('invalid-source-leaf','sourceLeaf must be an object');return null;}
    var allowed=['mechanism','pivot','closedAxis','leafWidthMm','thicknessMm','angleDeg','closedCenter','travelDistanceMm','pocketPolygon'];
    if(s.mechanism==='slide')allowed.push('openCenter');
    Object.keys(s).forEach(function(k){if(allowed.indexOf(k)<0)fail('unsupported-source-leaf-field','Unsupported source leaf field: '+k);});
    if(!finite(s.leafWidthMm)||s.leafWidthMm<=0||!finite(s.thicknessMm)||s.thicknessMm<=0){fail('invalid-source-panel','Source leaf width and thickness must be positive finite numbers');return null;}
    function local(p){var d=diff(p,center);return {x:dot(d,frame.u),y:dot(d,frame.n)};}
    var unused=s.mechanism==='swing'?['closedCenter','travelDistanceMm','pocketPolygon']:s.mechanism==='slide'?['pivot','angleDeg','pocketPolygon']:['pivot','closedAxis','angleDeg'];
    unused.forEach(function(k){if(s[k]!==undefined)fail('inapplicable-source-leaf-field',k+' does not apply to '+s.mechanism);});
    if(s.mechanism==='swing' && ['door-swing','door-swing-s','door-front'].indexOf(spec.kind)>=0){
      var sign=parallelSign(s.closedAxis,frame.u), side=parallelSign(spec.swingSide,frame.n);
      if(!point(s.pivot)||!sign||!side||!finite(s.angleDeg)||s.angleDeg<=0||s.angleDeg>180){fail('invalid-source-swing','Source swing needs exact pivot, host-parallel closed axis, perpendicular swing side and angle in (0,180]');return null;}
      var sourceTip={x:s.pivot.x+frame.u.x*sign*s.leafWidthMm,y:s.pivot.y+frame.u.y*sign*s.leafWidthMm};
      if(spec.hinge!==undefined&&!samePoint(spec.hinge,s.pivot))fail('source-hinge-conflict','Explicit hinge contradicts the independent source leaf pivot');
      if(spec.latch!==undefined&&!samePoint(spec.latch,sourceTip))fail('source-latch-conflict','Explicit latch contradicts the independent source leaf tip; gap jambs are not leaf endpoints');
      var pivot=local(s.pivot), end=pivot.x+sign*s.leafWidthMm;
      if(Math.min(pivot.x,end)<-spec.widthMm/2-EPS||Math.max(pivot.x,end)>spec.widthMm/2+EPS||Math.abs(pivot.y)>frame.wall.thick/2+EPS){fail('source-swing-outside-gap','Source closed panel and pivot must fit the declared opening span and wall thickness');return null;}
      return {mode:'hinge',hingeXmm:pivot.x,hingeZmm:pivot.y,leafCenterXmm:sign*s.leafWidthMm/2,leafWidthMm:s.leafWidthMm,leafThicknessMm:s.thicknessMm,openAngleY:-side*sign*s.angleDeg*Math.PI/180};
    }
    if(s.mechanism==='slide' && spec.kind==='door-slide-s'){
      // Only the existing native single wall-face envelope is certified. These
      // equalities reject missing/non-native source facts; they do not supply
      // measured panel dimensions, offsets or travel from a gap default.
      var direction=parallelSign(spec.travelDirection,frame.u);
      if(spec.sourceExactGap!==true){fail('source-slide-exact-gap-required','Source wall sliders require an independently declared exact gap');return null;}
      if(!point(s.closedCenter)||!direction||!finite(s.travelDistanceMm)||s.travelDistanceMm<=0){fail('invalid-source-slide','Source slide needs exact closed center, host-parallel travel direction and positive distance');return null;}
      if(spec.doorOpenState!=='open'&&spec.doorOpenState!=='closed')fail('invalid-source-slide-state','Source slide needs a known open or closed displayed state');
      if(s.closedAxis!==undefined&&!parallelSign(s.closedAxis,frame.u))fail('source-slide-axis-conflict','Source closed leaf axis must be parallel to its host');
      var c=local(s.closedCenter),face=c.y<0?-1:1;
      if(!near(s.leafWidthMm,spec.widthMm+60)||!near(s.thicknessMm,36)||!near(c.x,0)||!near(c.y,face*(frame.wall.thick/2+18+8))||!near(s.travelDistanceMm,spec.widthMm+30)){
        fail('unsupported-source-slide-envelope','Independent source panel width, thickness, closed center and travel must match the native single wall-slide envelope');return null;
      }
      if(spec.wallFace!==undefined&&parallelSign(spec.wallFace,frame.n)!==face)fail('source-slide-face-conflict','Explicit wall face contradicts the independent source closed center');
      var open=c.x+direction*s.travelDistanceMm,expectedOpen=world(frame,center,open,c.y);
      if(s.openCenter!==undefined&&!samePoint(s.openCenter,expectedOpen))fail('source-slide-pose-conflict','Observed source open center contradicts independent closed center and travel');
      return {mode:'single',direction:direction,leafWidthMm:s.leafWidthMm,leafThicknessMm:s.thicknessMm,closedXmm:c.x,openXmm:open,leafZmm:c.y};
    }
    if(s.mechanism==='pocket' && spec.kind==='door-pocket'){
      var direction=parallelSign(spec.travelDirection,frame.u);
      if(!point(s.closedCenter)||!direction||!finite(s.travelDistanceMm)||s.travelDistanceMm<=0){fail('invalid-source-pocket','Source pocket needs exact closed center and positive travel distance');return null;}
      var c=local(s.closedCenter), polygon=s.pocketPolygon;
      if(!Array.isArray(polygon)||polygon.length!==4||!polygon.every(point)){fail('unsupported-pocket-cavity','This procedural slice requires an exact four-corner rectangular pocket');return null;}
      var corners=polygon.map(local),xs=corners.map(function(p){return p.x;}),ys=corners.map(function(p){return p.y;}),a=Math.min.apply(null,xs),b=Math.max.apply(null,xs),lo=Math.min.apply(null,ys),hi=Math.max.apply(null,ys);
      if(b-a<=EPS||hi-lo<=EPS||corners.some(function(p,i){var q=corners[(i+1)%4];return !(near(p.x,a)||near(p.x,b))||!(near(p.y,lo)||near(p.y,hi))||!(near(p.x,q.x)!==near(p.y,q.y));})||new Set(corners.map(function(p){return p.x+','+p.y;})).size!==4){fail('unsupported-pocket-cavity','Pocket must be a simple host-aligned rectangle');return null;}
      var open=c.x+direction*s.travelDistanceMm;
      if(open-s.leafWidthMm/2<a-EPS||open+s.leafWidthMm/2>b+EPS||c.y-s.thicknessMm/2<lo-EPS||c.y+s.thicknessMm/2>hi+EPS){fail('source-panel-outside-pocket','The complete full-open panel must fit the exact source cavity');return null;}
      if(c.x-s.leafWidthMm/2>-spec.widthMm/2+EPS||c.x+s.leafWidthMm/2<spec.widthMm/2-EPS){fail('source-panel-does-not-cover-gap','Closed source panel must cover the exact opening gap');return null;}
      if(direction>0?a>spec.widthMm/2+EPS:b<-spec.widthMm/2-EPS){fail('disconnected-pocket-cavity','Pocket cavity must connect to the opening');return null;}
      if(lo<-frame.wall.thick/2-EPS||hi>frame.wall.thick/2+EPS){fail('source-pocket-outside-wall','Exact cavity must be contained by its supporting wall thickness');return null;}
      return {mode:'single',direction:direction,leafWidthMm:s.leafWidthMm,leafThicknessMm:s.thicknessMm,closedXmm:c.x,openXmm:open,leafZmm:c.y,pocketBoundsMm:[a,b,lo,hi]};
    }
    fail('unsupported-source-mechanism','Only a single procedural swing, native-envelope wall slide or pocket panel is supported');return null;
  }

  var sourceEditMessage='読み取り元の建具寸法・回転・反転・引く向きを保持しています。この建具の形状変更・規格置換は未対応です。移動（同じ向きの壁へ）と開閉状態は変更できます。';
  function sourceEditBlocked(item,key){
    return !!(item&&item.openingSourceGeometry&&['w','d','rot','flipX','flipY','type','openingModel','openingSourceGeometry','openingHostWallId','doorHeight','windowHeight','windowSill','windowTop','windowStd','windowKind'].indexOf(key)>=0);
  }
  function sourceControlBlocked(item,handler){
    if(!item||!item.openingSourceGeometry)return false;
    var m=String(handler||'').match(/updateSelectedProp\(\s*['"]([^'"]+)['"]/);
    return !!(m&&sourceEditBlocked(item,m[1])||/applyDoorWidthPreset|applyWindowStdPreset|extendWallForSlideDoor/.test(handler||''));
  }

  function sourcePlacementStatus(item,walls){
    if(!item||!item.openingSourceGeometry)return null;
    var detached=!explicitHostWallInfo(item,walls),edited=item.openingPlacementEdited===true;
    var message=detached?'取り付け先の壁が未解決です。保存された壁と位置・向きが一致しないため、壁への取り付けは無効です。近くの壁へ自動で付け替えません。 ':'';
    message+=edited?'取込後に配置を編集しています。現在の配置の支持壁・戸袋・開閉時の干渉は再検証していません。 ':'移動や周辺壁の変更後の支持壁・戸袋・開閉時の干渉は、自動で再検証しません。 ';
    message+='取込時の検証記録は元の配置の記録であり、現在の配置の保証ではありません。';
    return {detached:detached,edited:edited,message:message};
  }

  function planGeometry(item, wallThicknessMm, open) {
    var p=rendererParameters(item,wallThicknessMm);
    if(!p||p.mode==='opening')return null;
    var fraction=typeof open==='boolean'?(open?1:0):open;
    if(!finite(fraction)||fraction<0||fraction>1)throw new RangeError('Opening fraction must be between 0 and 1');
    var f={u:{x:1,y:0},n:{x:0,y:1}},c={x:0,y:0};
    var out={parameters:p,closedLeaf:p.mode==='hinge'?hingeLeaf(f,c,p,0):leafRectangle(f,c,p.closedXmm,p.leafZmm,p.leafWidthMm,p.leafThicknessMm)};
    out.leaf=p.mode==='hinge'?hingeLeaf(f,c,p,p.openAngleY*fraction):leafRectangle(f,c,p.closedXmm+(p.openXmm-p.closedXmm)*fraction,p.leafZmm,p.leafWidthMm,p.leafThicknessMm);
    if(p.mode==='bypass')out.fixedLeaf=leafRectangle(f,c,p.fixedXmm,p.fixedZmm,p.leafWidthMm,p.leafThicknessMm);
    if(p.pocketBoundsMm){var b=p.pocketBoundsMm;out.pocket=leafRectangle(f,c,(b[0]+b[1])/2,(b[2]+b[3])/2,b[1]-b[0],b[3]-b[2]);}
    return out;
  }
  function sourcePlanGeometry(item, open){return item&&item.openingSourceGeometry?planGeometry(item,120,open):null;}

  // The renderer subtracts these same exact cavity bounds from wall solids.
  function pocketCutsForWall(item, walls, wall) {
    var p=item&&item.openingSourceGeometry, info=explicitHostWallInfo(item,walls), wf=wallFrame(wall);
    if(!p||!p.pocketBoundsMm||!info||!wf||item.floor!==(wall.floor||1))return [];
    var f=wallFrame(info.wall), b=p.pocketBoundsMm;
    if(!parallelSign(f.u,wf.u)||Math.abs(dot(diff(wf.origin,f.origin),f.n))>EPS)return [];
    var corners=leafRectangle(f,info.center,(b[0]+b[1])/2,(b[2]+b[3])/2,b[1]-b[0],b[3]-b[2]);
    var xs=corners.map(function(v){return dot(diff(v,wf.origin),wf.u);}),zs=corners.map(function(v){return dot(diff(v,wf.origin),wf.n);});
    var a=Math.max(0,Math.min.apply(null,xs)),end=Math.min(wf.length,Math.max.apply(null,xs));
    return end>a+EPS?[{a:a,b:end,z0:Math.min.apply(null,zs),z1:Math.max.apply(null,zs)}]:[];
  }
  // Axis-aligned box subtraction, shared with source cavity rendering. The
  // result has no overlaps, preserves all shell material, and uses no sampling.
  function subtractBoxes(box, voids) {
    var cells=[box.slice()];
    (voids||[]).forEach(function(v){var next=[];cells.forEach(function(c){
      var lo=[Math.max(c[0],v[0]),Math.max(c[2],v[2]),Math.max(c[4],v[4])],hi=[Math.min(c[1],v[1]),Math.min(c[3],v[3]),Math.min(c[5],v[5])];
      if(lo.some(function(n,i){return hi[i]<=n+EPS;})){next.push(c);return;}
      var core=c.slice();
      for(var i=0;i<3;i++){var k=i*2;
        if(core[k]<lo[i]-EPS){var left=core.slice();left[k+1]=lo[i];next.push(left);core[k]=lo[i];}
        if(core[k+1]>hi[i]+EPS){var right=core.slice();right[k]=hi[i];next.push(right);core[k+1]=hi[i];}
      }
    });cells=next;});return cells;
  }

  // Saved explicit binding is authoritative in both drawing and wall cutting.
  // A removed/moved/rotated host must not silently redirect the opening to a
  // nearby wall. In particular, a reversed host after compilation invalidates
  // the stored directed renderer basis rather than silently reversing swing.
  function explicitHostWallInfo(item, walls) {
    if(!item || item.openingHostWallId===undefined || item.openingHostWallId===null) return null;
    var matches=(walls||[]).filter(function(w){return w && w.id===item.openingHostWallId;});
    if(matches.length!==1 || ![item.x,item.y,item.w,item.d,item.rot].every(finite) || item.w<=0 || item.d<=0) return null;
    var host=matches[0], frame=wallFrame(host);
    if(!frame || (host.floor||1)!==item.floor) return null;
    var center={x:item.x+item.w/2,y:item.y+item.d/2}, d=diff(center,frame.origin);
    var s=dot(d,frame.u), offset=dot(d,frame.n);
    var itemAxis={x:Math.cos(item.rot*Math.PI/180),y:Math.sin(item.rot*Math.PI/180)};
    if(Math.abs(offset)>EPS || s-item.w/2 < -EPS || s+item.w/2 > frame.length+EPS || dot(itemAxis,frame.u)<1-EPS) return null;
    return {wall:host,dist:Math.abs(offset),t:s/frame.length,rawT:s/frame.length,center:center,
      x:center.x,y:center.y,rot:Math.atan2(frame.u.y,frame.u.x)*180/Math.PI};
  }

  // Explicit editor boundary only: do not call from rendering, loading or
  // validation. undefined retains legacy behavior; null is a saved detached
  // strict opening and must NEVER turn back into a nearest-wall lookup.
  // Pointer drop/paste may opt into the editor's 400 mm wall placement snap.
  // Numeric edits/nudges must keep their exact coordinates, so repeated small
  // moves cannot get trapped by projecting back to the same wall each time.
  function rebindAfterEdit(item, walls, options) {
    options=options||{};
    if(!item || item.openingHostWallId===undefined || TYPES.indexOf(item.type)<0) return null;
    var before=options.before;
    if(before && ['x','y','w','d','rot','floor'].every(function(k){return item[k]===before[k];}))
      return explicitHostWallInfo(item,walls);
    if(item.openingSourceGeometry)item.openingPlacementEdited=true;
    var current=explicitHostWallInfo(item,walls);
    if(current) return current; // Preserve a host moved together with its opening.
    var candidate=null, bestDist=Infinity;
    if([item.x,item.y,item.w,item.d,item.rot].every(finite) && item.w>0 && item.d>0){
      var center={x:item.x+item.w/2,y:item.y+item.d/2};
      (walls||[]).forEach(function(w){
        if(!w || (typeof w.id!=='string'&&typeof w.id!=='number') || (w.floor||1)!==item.floor) return;
        if((walls||[]).filter(function(other){return other&&other.id===w.id;}).length!==1) return;
        var frame=wallFrame(w); if(!frame || frame.length<item.w-EPS) return;
        if(item.openingSourceGeometry && dot(frame.u,{x:Math.cos(item.rot*Math.PI/180),y:Math.sin(item.rot*Math.PI/180)})<1-EPS)return;
        var trial=Object.assign({},item,{openingHostWallId:w.id});
        if(options.snapToWall){
          var delta=diff(center,frame.origin), along=dot(delta,frame.u);
          var segmentAlong=Math.max(0,Math.min(frame.length,along));
          var segmentPoint=world(frame,frame.origin,segmentAlong,0);
          var distance=Math.hypot(center.x-segmentPoint.x,center.y-segmentPoint.y);
          if(distance>400 || distance>=bestDist) return;
          along=Math.max(item.w/2,Math.min(frame.length-item.w/2,along));
          var target=world(frame,frame.origin,along,0);
          trial.x=target.x-item.w/2; trial.y=target.y-item.d/2;
          trial.rot=Math.atan2(frame.u.y,frame.u.x)*180/Math.PI;
          var info=explicitHostWallInfo(trial,walls);
          if(info){candidate=trial; bestDist=distance;}
        }else if(!candidate && explicitHostWallInfo(trial,walls)) candidate=trial;
      });
    }
    item.openingHostWallId=candidate?candidate.openingHostWallId:null;
    if(candidate && options.snapToWall){item.x=candidate.x; item.y=candidate.y; item.rot=candidate.rot;}
    return explicitHostWallInfo(item,walls);
  }

  // spec: {id,floor,kind,hostWallId,center,widthMm,depthMm?,axis?,rotationDeg?,
  // hinge,latch,swingSide OR travelDirection,wallFace}. Directions are world
  // vectors (magnitude is ignored). Optional travel is the exact displacement.
  // Pocket wallFace is explicitly 'center'. Bypass wallFace must be the actual
  // positive host normal: the legacy renderer does not implement its flipY.
  function compileOpening(spec, walls, allSpecs) {
    var diagnostics=[], warnings=[], geometry=null;
    function fail(code,message,extra) {
      var d={code:code,message:message};
      if(extra) Object.keys(extra).forEach(function(k){d[k]=extra[k];});
      diagnostics.push(d);
    }
    function result(item) { return {ok:diagnostics.length===0,item:diagnostics.length?null:item,geometry:geometry,diagnostics:diagnostics,warnings:warnings}; }
    if (!spec || typeof spec !== 'object') { fail('invalid-opening','Opening must be an object'); return result(null); }
    if (TYPES.indexOf(spec.kind) < 0) { fail('unsupported-opening-kind','Opening kind has no strict renderer implementation: '+String(spec.kind)); return result(null); }
    if (typeof spec.hostWallId !== 'string' && typeof spec.hostWallId !== 'number') {
      fail('missing-host-wall','An explicit hostWallId is required'); return result(null);
    }
    var matches=(walls||[]).filter(function(w){return w && w.id===spec.hostWallId;});
    if (matches.length!==1) { fail(matches.length?'ambiguous-host-wall':'missing-host-wall','hostWallId must identify exactly one wall'); return result(null); }
    var host=matches[0], frame=wallFrame(host);
    if (!frame) { fail('invalid-host-wall','Host wall requires finite endpoints, positive thickness and at least 1 mm length'); return result(null); }
    if (!Number.isInteger(spec.floor) || spec.floor<1 || spec.floor>5 || spec.floor!==(host.floor||1)) fail('opening-floor-mismatch','Opening and host must have the same explicit floor');
    if (!point(spec.center) || !finite(spec.widthMm) || spec.widthMm<=0) fail('invalid-opening-size','Opening requires a finite world center and positive widthMm');
    if (spec.depthMm!==undefined && (!finite(spec.depthMm)||spec.depthMm<=0)) fail('invalid-opening-depth','depthMm must be positive and finite');
    if (diagnostics.length) return result(null);
    var center=spec.center, half=spec.widthMm/2, delta=diff(center,frame.origin), along=dot(delta,frame.u), off=dot(delta,frame.n);
    if (Math.abs(off)>EPS) fail('opening-off-host','Opening center must be exactly on its explicit host wall');
    if (along-half < -EPS || along+half > frame.length+EPS) fail('opening-outside-host','The entire opening must lie within its explicit host; clamping is forbidden');
    if (spec.axis!==undefined && !parallelSign(spec.axis,frame.u)) fail('opening-axis-mismatch','Opening axis must be parallel to its host wall');
    var rotation=spec.rotationDeg!==undefined?spec.rotationDeg:spec.rot;
    if (rotation!==undefined && (!finite(rotation)||!parallelSign({x:Math.cos(rotation*Math.PI/180),y:Math.sin(rotation*Math.PI/180)},frame.u))) fail('opening-rotation-mismatch','Opening rotation must be parallel to its host wall');
    var depth=spec.depthMm===undefined?(spec.kind==='door-front'?200:(spec.kind==='window-door'?180:(spec.kind==='door-swing'||spec.kind==='door-swing-s'?spec.widthMm:150))):spec.depthMm;
    var item={id:spec.id,type:spec.kind,floor:spec.floor,openingHostWallId:host.id,x:center.x-half,y:center.y-depth/2,w:spec.widthMm,d:depth,
      rot:Math.atan2(frame.u.y,frame.u.x)*180/Math.PI,flipX:false,flipY:false};
    if(spec.doorOpenState!==undefined){
      if(spec.doorOpenState!=='open'&&spec.doorOpenState!=='closed') fail('invalid-opening-state','doorOpenState must be open or closed');
      else item.doorOpenState=spec.doorOpenState;
    }
    var hinge=spec.kind==='door-swing'||spec.kind==='door-swing-s'||spec.kind==='door-front';
    var staticOpening=spec.kind==='door-opening'||spec.kind==='window'||spec.kind==='window-door';
    if(spec.sourceExactGap===true&&!staticOpening&&spec.sourceLeaf===undefined){fail('missing-independent-source-leaf','An exact source gap cannot establish leaf width, hinge or travel; independent sourceLeaf geometry is required');return result(null);}
    var unused=hinge?['travelDirection','travel','wallFace']:staticOpening?['hinge','latch','swingSide','travelDirection','travel','wallFace']:['hinge','latch','swingSide'];
    unused.forEach(function(key){if(spec[key]!==undefined)fail('inapplicable-opening-kinematics',key+' does not apply to '+spec.kind);});
    if(spec.sourceLeaf!==undefined){
      var sourceP=sourceParameters(spec,frame,center,fail);
      if(sourceP){item.openingSourceGeometry=sourceP;item.flipX=sourceP.mode==='hinge'?sourceP.leafCenterXmm<0:sourceP.direction<0;item.flipY=sourceP.mode==='hinge'?sourceP.openAngleY>0:false;}
    }else if(hinge){
      var low=world(frame,center,-half,0), high=world(frame,center,half,0);
      if(samePoint(spec.hinge,low)&&samePoint(spec.latch,high)) item.flipX=false;
      else if(samePoint(spec.hinge,high)&&samePoint(spec.latch,low)) item.flipX=true;
      else fail('hinge-latch-mismatch','World hinge and latch must be the two exact opening endpoints');
      var swingSign=parallelSign(spec.swingSide,frame.n);
      if(!swingSign) fail('invalid-swing-side','swingSide must be a nonzero world direction perpendicular to the host wall');
      else item.flipY=swingSign*(item.flipX?-1:1)<0;
    }else if(spec.kind!=='door-opening'&&spec.kind!=='window'&&spec.kind!=='window-door'){
      var travelSign=parallelSign(spec.travelDirection,frame.u);
      if(!travelSign) fail('invalid-travel-direction','travelDirection must be a nonzero world direction parallel to the host wall');
      else item.flipX=spec.kind==='door-slide'?travelSign>0:travelSign<0;
      if(spec.kind==='door-pocket'){
        if(spec.wallFace!=='center') fail('invalid-pocket-face','Pocket doors require explicit wallFace: center');
        if(host.thick<36-EPS) fail('pocket-too-thin','Pocket wall must contain the actual 36 mm leaf thickness');
      }else{
        var faceSign=parallelSign(spec.wallFace,frame.n);
        if(!faceSign) fail('invalid-wall-face','wallFace must be a nonzero world direction perpendicular to the host wall');
        else if(spec.kind==='door-slide' && faceSign<0) fail('unsupported-bypass-face','The renderer fixes the moving bypass leaf on the positive host-normal track');
        else item.flipY=faceSign>0;
      }
    }
    if(diagnostics.length) return result(null);
    if(spec.sourceExactGap===true&&staticOpening)item.openingSourceGeometry={mode:'opening'};
    var p=rendererParameters(item,host.thick);
    geometry={hostWallId:host.id,center:{x:center.x,y:center.y},basis:{axis:frame.u,normal:frame.n},
      openingIntervalMm:[along-half,along+half],parameters:p};
    if(spec.kind==='window'||spec.kind==='window-door')geometry.motionValidation='not-modeled';
    if(hinge){
      geometry.hinge=world(frame,center,p.hingeXmm,p.hingeZmm||0);
      geometry.latch=world(frame,center,p.hingeXmm+p.leafCenterXmm*2,p.hingeZmm||0);
      geometry.fullOpenLatch=world(frame,center,p.hingeXmm+Math.cos(p.openAngleY)*p.leafCenterXmm*2,(p.hingeZmm||0)-Math.sin(p.openAngleY)*p.leafCenterXmm*2);
      geometry.closedLeaf=hingeLeaf(frame,center,p,0);
      geometry.fullOpenLeaf=hingeLeaf(frame,center,p,p.openAngleY);
    }else if(p.mode!=='opening'){
      geometry.travel=scale(frame.u,p.openXmm-p.closedXmm);
      geometry.closedLeaf=leafRectangle(frame,center,p.closedXmm,p.leafZmm,p.leafWidthMm,p.leafThicknessMm);
      geometry.fullOpenLeaf=leafRectangle(frame,center,p.openXmm,p.leafZmm,p.leafWidthMm,p.leafThicknessMm);
      geometry.closedIntervalMm=[along+p.closedXmm-p.leafWidthMm/2,along+p.closedXmm+p.leafWidthMm/2];
      geometry.fullOpenIntervalMm=[along+p.openXmm-p.leafWidthMm/2,along+p.openXmm+p.leafWidthMm/2];
      geometry.sweptIntervalMm=[Math.min(geometry.closedIntervalMm[0],geometry.fullOpenIntervalMm[0]),
        Math.max(geometry.closedIntervalMm[1],geometry.fullOpenIntervalMm[1])];
      if(spec.travel!==undefined&&!samePoint(spec.travel,geometry.travel)) fail('opening-travel-mismatch','Requested travel differs from the actual renderer full-open displacement');
      if(p.mode==='bypass'){
        geometry.backingMode='fixed-bypass-leaf';
        geometry.fixedLeaf=leafRectangle(frame,center,p.fixedXmm,p.fixedZmm,p.leafWidthMm,p.leafThicknessMm);
      }
    }
    var holes=[];
    (allSpecs||[]).forEach(function(o){
      if(!o||o===spec||(spec.id!==undefined&&o.id===spec.id)||(o.floor||1)!==spec.floor||!point(o.center)||!finite(o.widthMm)||o.widthMm<=0) return;
      var hosts=(walls||[]).filter(function(w){return w&&w.id===o.hostWallId;});
      if(hosts.length!==1) return;
      var of=wallFrame(hosts[0]);
      if(!of||!parallelSign(of.u,frame.u)||Math.abs(dot(diff(o.center,frame.origin),frame.n))>EPS) return;
      var c=dot(diff(o.center,frame.origin),frame.u), h=o.widthMm/2;
      var ownCenter=dot(diff(o.center,of.origin),of.u),cutHalf=wallCutWidthMm({type:o.kind,w:o.widthMm,openingSourceGeometry:o.sourceLeaf||o.sourceExactGap},of.length)/2;
      var start=world(of,of.origin,Math.max(0,ownCenter-cutHalf),0),end=world(of,of.origin,Math.min(of.length,ownCenter+cutHalf),0);
      var ca=dot(diff(start,frame.origin),frame.u),cb=dot(diff(end,frame.origin),frame.u);
      holes.push([Math.min(ca,cb),Math.max(ca,cb)]);
      if(c+h>along-half+EPS&&c-h<along+half-EPS) fail('overlapping-openings','Another opening overlaps this opening on its host line',{openingId:o.id});
    });
    if(p.mode==='single'){
      var cover=[];
      (walls||[]).forEach(function(w){
        if(!w||(w.floor||1)!==spec.floor) return;
        var f=wallFrame(w); if(!f||!parallelSign(f.u,frame.u)) return;
        var d1=diff(f.origin,frame.origin), d2=diff({x:w.x2,y:w.y2},frame.origin);
        // A parallel but shifted wall, a gap, or a different wall face cannot
        // become backing simply because a coarse sample hit nearby material.
        if(Math.abs(dot(d1,frame.n))>EPS||Math.abs(dot(d2,frame.n))>EPS) return;
        if(item.type==='door-pocket' ? w.thick<p.leafThicknessMm-EPS : !near(w.thick,host.thick)) return;
        if(p.pocketBoundsMm&&(p.pocketBoundsMm[2]<-w.thick/2-EPS||p.pocketBoundsMm[3]>w.thick/2+EPS)) return;
        var a=dot(d1,frame.u), b=dot(d2,frame.u);
        cover.push([Math.min(a,b),Math.max(a,b)]);
      });
      // Own wall-cut margin is a frame/attachment zone, not additional pocket
      // demand. Every OTHER opening removes its actual renderer cut (including
      // the 40 mm-per-side fitting margin), not merely its nominal clear span.
      var backing=subtractIntervals(cover,holes), required=geometry.fullOpenIntervalMm;
      var missing=missingIntervals(required,backing);
      if(p.pocketBoundsMm){
        var cavity=[along+p.pocketBoundsMm[0],along+p.pocketBoundsMm[1]], cavityMissing=missingIntervals(cavity,backing);
        geometry.pocketPolygon=leafRectangle(frame,center,(p.pocketBoundsMm[0]+p.pocketBoundsMm[1])/2,(p.pocketBoundsMm[2]+p.pocketBoundsMm[3])/2,p.pocketBoundsMm[1]-p.pocketBoundsMm[0],p.pocketBoundsMm[3]-p.pocketBoundsMm[2]);
        if(cavityMissing.length)fail('source-pocket-without-support','The exact source cavity exceeds continuous supporting walls or crosses another opening',{missingIntervalsMm:cavityMissing});
      }
      geometry.backingMode=item.type==='door-pocket'?'pocket':'wall-face';
      geometry.backingIntervalsMm=backing;
      geometry.missingBackingIntervalsMm=missing;
      if(missing.length) fail('insufficient-slider-backing','Full-open leaf does not fit continuous solid backing without another opening',
        {missingIntervalsMm:missing,missingMm:missing.reduce(function(sum,i){return sum+i[1]-i[0];},0)});
      // Full-open support alone misses the closed leaf's 30 mm overlap beyond
      // the opposite aperture edge. Pure translation sweeps exactly the union
      // of the closed/open longitudinal extents; every intermediate position
      // must stay on this continuous wall run. Own aperture/cavity is intended
      // and is not subtracted, but no outer wall end or OTHER cut is forgiven.
      var envelopeMissing=missingIntervals(geometry.sweptIntervalMm,backing);
      geometry.missingEnvelopeIntervalsMm=envelopeMissing;
      if(envelopeMissing.length) fail('insufficient-slider-envelope','The complete closed-to-open leaf envelope exceeds the continuous wall run or crosses another opening',
        {missingIntervalsMm:envelopeMissing,missingMm:envelopeMissing.reduce(function(sum,i){return sum+i[1]-i[0];},0)});
    }
    if(item.openingSourceGeometry && p.mode==='hinge'){
      // Check the source hinge against its own remaining wall, too. The exact
      // aperture is removed; an inset pivot never grants an invented jamb void.
      // Nominal source widths can have sub-millimetre latch-corner contact
      // (900 x 40 panel: 0.222 mm). Report the bounded contact tolerance; never
      // widen the source gap or modify renderer coordinates to hide it.
      geometry.hostContactToleranceMm=1;
      var exactContact=false,materialContact=false;
      [[0,along-half],[along+half,frame.length]].forEach(function(span){
        if(span[1]-span[0]>EPS&&hingeSweepOverlaps(frame,center,p,leafRectangle(frame,frame.origin,(span[0]+span[1])/2,0,span[1]-span[0],host.thick)))exactContact=true;
      });
      [[0,along-half-1],[along+half+1,frame.length]].forEach(function(span){
        if(span[1]-span[0]<=EPS)return;
        var obstacle=leafRectangle(frame,frame.origin,(span[0]+span[1])/2,0,span[1]-span[0],host.thick);
        if(hingeSweepOverlaps(frame,center,p,obstacle)){materialContact=true;fail('source-swing-host-collision','The exact source panel sweep intersects its own host outside the declared gap beyond the 1 mm nominal-contact convention');}
      });
      geometry.nominalJambContact=exactContact&&!materialContact;
      if(geometry.nominalJambContact)warnings.push({code:'source-nominal-jamb-contact',message:'Source nominal leaf and gap dimensions have at most 1 mm own-jamb penetration during rotation. This assumes unmodeled nominal jamb clearance; geometry is unchanged and zero collision is not certified.',toleranceMm:1});
    }
    if(p.mode!=='opening'){
      var sweep=null;
      if(p.mode!=='hinge'){
        var minX=geometry.sweptIntervalMm[0]-along;
        var maxX=geometry.sweptIntervalMm[1]-along;
        sweep=leafRectangle(frame,center,(minX+maxX)/2,p.leafZmm,maxX-minX,p.leafThicknessMm);
        geometry.sweptLeaf=sweep;
      }
      (walls||[]).forEach(function(w){
        if(w===host||(w.floor||1)!==spec.floor)return;
        var wf=wallFrame(w);if(!wf)return;
        // A pocket is an expressly declared cavity in these continuous walls.
        if(item.type==='door-pocket'&&parallelSign(wf.u,frame.u)&&Math.abs(dot(diff(wf.origin,frame.origin),frame.n))<=EPS&&w.thick>=p.leafThicknessMm-EPS)return;
        var obstacle=wallPolygon(w);
        if(p.mode==='hinge'?hingeSweepOverlaps(frame,center,p,obstacle):polygonsOverlap(sweep,obstacle))
          fail('opening-sweep-collision','The rendered leaf sweep intersects another wall',{wallId:w.id});
      });
    }
    return result(item);
  }
  return {supportedKinds:TYPES.slice(),rendererParameters:rendererParameters,planGeometry:planGeometry,sourceEditMessage:sourceEditMessage,sourceEditBlocked:sourceEditBlocked,sourceControlBlocked:sourceControlBlocked,sourcePlacementStatus:sourcePlacementStatus,sourcePlanGeometry:sourcePlanGeometry,pocketCutsForWall:pocketCutsForWall,subtractBoxes:subtractBoxes,wallCutWidthMm:wallCutWidthMm,explicitHostWallInfo:explicitHostWallInfo,rebindAfterEdit:rebindAfterEdit,compileOpening:compileOpening};
}));
