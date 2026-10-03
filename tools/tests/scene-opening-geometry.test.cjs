const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../../assets/js/scene-opening-geometry.js');
const root = path.join(__dirname, '../..');
const wall = (end = 4000) => ({id:'host',floor:1,x1:0,y1:0,x2:end,y2:0,thick:120});
// Endpoint fixtures have an explicit 30 mm continuation for the closed leaf's
// overlap. This is source geometry, never an adjustment by the compiler.
const closedOverlapSupport = (thick=120) => ({id:'closed-overlap-support',floor:1,x1:-30,y1:0,x2:0,y2:0,thick});
const hinge = (extra = {}) => ({id:'door',floor:1,kind:'door-swing',hostWallId:'host',
  center:{x:2000,y:0},widthMm:780,hinge:{x:1610,y:0},latch:{x:2390,y:0},swingSide:{x:0,y:1},...extra});
const slider = (extra = {}) => ({id:'door',floor:1,kind:'door-slide-s',hostWallId:'host',
  center:{x:390,y:0},widthMm:780,travelDirection:{x:1,y:0},wallFace:{x:0,y:-1},...extra});
const codes = r => r.diagnostics.map(d => d.code);
function ok(r) { assert.equal(r.ok,true,JSON.stringify(r.diagnostics)); assert.ok(r.item); return r; }
function close(a,b) { assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`); }
function closePoint(a,b) { close(a.x,b.x); close(a.y,b.y); }
function pointsEqual(a,b) {
  const sort = a => a.map(p=>[Math.round(p.x*1e5)/1e5,Math.round(p.y*1e5)/1e5]).sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
  assert.deepEqual(sort(a),sort(b));
}

test('explicit host, strict coordinates, and unsupported kinds never guess or clamp', () => {
  for (const [change, code] of [
    [{hostWallId:undefined},'missing-host-wall'], [{hostWallId:'missing'},'missing-host-wall'],
    [{center:{x:2000,y:1}},'opening-off-host'], [{center:{x:200,y:0}},'opening-outside-host'],
    [{axis:{x:0,y:1}},'opening-axis-mismatch'], [{rotationDeg:90},'opening-rotation-mismatch'],
    [{rot:90},'opening-rotation-mismatch'], [{floor:2},'opening-floor-mismatch'],
    [{widthMm:Infinity},'invalid-opening-size'], [{widthMm:'780'},'invalid-opening-size'],
    [{widthMm:0},'invalid-opening-size'], [{depthMm:NaN},'invalid-opening-depth'],
    [{kind:'door'},'unsupported-opening-kind'], [{kind:'door-hinge'},'unsupported-opening-kind'],
    [{kind:'door-fold-w'},'unsupported-opening-kind'], [{kind:'door-fold'},'unsupported-opening-kind'],
  ]) {
    const r=G.compileOpening(hinge(change),[wall()],[]);
    assert.equal(r.item,null); assert.ok(codes(r).includes(code),JSON.stringify(r));
  }
  assert.ok(codes(G.compileOpening(hinge(),[wall(),wall()],[])).includes('ambiguous-host-wall'));
  assert.ok(codes(G.compileOpening(hinge(),[{...wall(),x2:0}],[])).includes('invalid-host-wall'));
});

test('hinge identity and world swing side survive all wall directions and reversed endpoints', () => {
  for(const angle of [0,90,180,270]) for(const hand of [-1,1]) for(const swing of [-1,1]) {
    const a=angle*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x};
    const at=s=>({x:50+u.x*s,y:70+u.y*s});
    const start=at(0),end=at(4000),center=at(2000);
    const spec=hinge({center,hinge:at(2000+hand*390),latch:at(2000-hand*390),swingSide:{x:n.x*swing,y:n.y*swing}});
    const w={...wall(),x1:start.x,y1:start.y,x2:end.x,y2:end.y};
    const forward=ok(G.compileOpening(spec,[w],[]));
    const reversed=ok(G.compileOpening(spec,[{...w,x1:end.x,y1:end.y,x2:start.x,y2:start.y}],[]));
    for(const r of [forward,reversed]) {
      closePoint(r.geometry.hinge,spec.hinge); closePoint(r.geometry.latch,spec.latch);
      closePoint(r.geometry.fullOpenLatch,{x:spec.hinge.x+n.x*swing*780,y:spec.hinge.y+n.y*swing*780});
      closePoint({x:r.item.x+r.item.w/2,y:r.item.y+r.item.d/2},center);
    }
    assert.notEqual(forward.item.flipX,reversed.item.flipX);
    pointsEqual(forward.geometry.fullOpenLeaf,reversed.geometry.fullOpenLeaf);
  }
});

test('malformed hinge/latch and swing vectors are explicit errors', () => {
  for(const change of [{hinge:{x:1611,y:0}},{latch:{x:2000,y:0}},{hinge:undefined}])
    assert.ok(codes(G.compileOpening(hinge(change),[wall()],[])).includes('hinge-latch-mismatch'));
  for(const swingSide of [undefined,{x:0,y:0},{x:1,y:1},{x:1,y:0}])
    assert.ok(codes(G.compileOpening(hinge({swingSide}),[wall()],[])).includes('invalid-swing-side'));
});

test('single slider uses actual 840 mm leaf and 810 mm travel, requiring wall through 1620', () => {
  const short=G.compileOpening(slider(),[wall(1560)],[]);
  assert.equal(short.item,null);
  assert.deepEqual(short.geometry.fullOpenIntervalMm,[780,1620]);
  assert.deepEqual(short.geometry.missingBackingIntervalsMm,[[1560,1620]]);
  assert.equal(short.diagnostics[0].missingMm,60);
  const exact=ok(G.compileOpening(slider(),[wall(1620),closedOverlapSupport()],[]));
  assert.deepEqual(exact.geometry.travel,{x:810,y:0});
  assert.deepEqual(exact.geometry.fullOpenLeaf,[{x:780,y:-104},{x:1620,y:-104},{x:1620,y:-68},{x:780,y:-68}]);
  assert.equal(G.compileOpening(slider(),[wall(1619.999)],[]).ok,false);
});

test('single slider direction, face and complete world leaf survive endpoint reversal', () => {
  for(const angle of [0,90,180,270]) for(const dir of [-1,1]) for(const face of [-1,1]) {
    const a=angle*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x};
    const center={x:u.x*2000,y:u.y*2000},end={x:u.x*4000,y:u.y*4000};
    const w={...wall(),x2:end.x,y2:end.y};
    const spec=slider({center,travelDirection:{x:u.x*dir,y:u.y*dir},wallFace:{x:n.x*face,y:n.y*face}});
    const f=ok(G.compileOpening(spec,[w],[]));
    const r=ok(G.compileOpening(spec,[{...w,x1:w.x2,y1:w.y2,x2:0,y2:0}],[]));
    closePoint(f.geometry.travel,{x:u.x*dir*810,y:u.y*dir*810});
    closePoint(r.geometry.travel,f.geometry.travel);
    pointsEqual(f.geometry.fullOpenLeaf,r.geometry.fullOpenLeaf);
    assert.notEqual(f.item.flipX,r.item.flipX); assert.notEqual(f.item.flipY,r.item.flipY);
  }
});

test('single and pocket sliders reject closed-end overhang in every travel and host direction', () => {
  for(const kind of ['door-slide-s','door-pocket']) for(const angle of [0,90,180,270])
    for(const direction of [-1,1]) for(const reversed of [false,true]) {
      const radians=angle*Math.PI/180,u={x:Math.cos(radians),y:Math.sin(radians)},n={x:-u.y,y:u.x};
      const at=s=>({x:u.x*s,y:u.y*s});
      const makeWall=(lo,hi)=>{
        const start=at(reversed?hi:lo),end=at(reversed?lo:hi);
        return {...wall(),x1:start.x,y1:start.y,x2:end.x,y2:end.y};
      };
      const spec=slider({kind,center:at(direction>0?390:1230),travelDirection:{x:u.x*direction,y:u.y*direction},
        wallFace:kind==='door-pocket'?'center':{x:-n.x,y:-n.y}});
      const before=JSON.stringify(spec),original=makeWall(0,1620);
      const rejected=G.compileOpening(spec,[original],[]);
      assert.equal(rejected.item,null);
      assert.deepEqual(rejected.geometry.missingBackingIntervalsMm,[],'Full-open backing alone is sufficient');
      const defect=rejected.diagnostics.find(d=>d.code==='insufficient-slider-envelope');
      assert.ok(defect);close(defect.missingMm,30);
      close(rejected.geometry.sweptIntervalMm[1]-rejected.geometry.sweptIntervalMm[0],1650);
      close(rejected.geometry.closedIntervalMm[1]-rejected.geometry.closedIntervalMm[0],840);
      assert.equal(JSON.stringify(spec),before,'No source movement, flipping or mutation');

      const exact=makeWall(direction>0?-30:0,direction>0?1620:1650);
      const accepted=ok(G.compileOpening(spec,[exact],[]));
      assert.deepEqual(accepted.geometry.missingEnvelopeIntervalsMm,[]);
      closePoint({x:accepted.item.x+accepted.item.w/2,y:accepted.item.y+accepted.item.d/2},spec.center);
      closePoint(accepted.geometry.travel,{x:u.x*direction*810,y:u.y*direction*810});
      pointsEqual(accepted.geometry.closedLeaf,rejected.geometry.closedLeaf);
      pointsEqual(accepted.geometry.fullOpenLeaf,rejected.geometry.fullOpenLeaf);

      const short=makeWall(direction>0?-29.999:0,direction>0?1620:1649.999);
      const almost=G.compileOpening(spec,[short],[]);
      assert.equal(almost.item,null);
      close(almost.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,.001);
    }
});

test('entire envelope coverage detects 4 mm closed-side gaps and honours exact joins', () => {
  for(const kind of ['door-slide-s','door-pocket']) for(const reversed of [false,true]) {
    const spec=slider({kind,wallFace:kind==='door-pocket'?'center':{x:0,y:-1}});
    const host=reversed?{...wall(1620),x1:1620,x2:0}:wall(1620);
    const join=closedOverlapSupport();
    ok(G.compileOpening(spec,[host,join],[]));
    const gap=G.compileOpening(spec,[host,{...join,x2:-4}],[]);
    assert.equal(gap.item,null);assert.deepEqual(gap.geometry.missingBackingIntervalsMm,[]);
    close(gap.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,4);
    const reversedJoin={...join,x1:join.x2,x2:join.x1};
    ok(G.compileOpening(spec,[host,reversedJoin],[]));
  }
});

test('other renderer cuts are removed from closed overlap even if full-open backing is clear', () => {
  for(const kind of ['door-slide-s','door-pocket']) {
    const spec=slider({kind,wallFace:kind==='door-pocket'?'center':{x:0,y:-1}});
    const host={...wall(1620),x1:-1000};
    const other={id:'other',floor:1,kind:'window',hostWallId:'host',center:{x:-76,y:0},widthMm:100};
    const r=G.compileOpening(spec,[host],[spec,other]);
    assert.equal(r.item,null);assert.deepEqual(r.geometry.missingBackingIntervalsMm,[]);
    assert.ok(!codes(r).includes('overlapping-openings'),'Nominal clear spans do not overlap');
    close(r.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,4);
    ok(G.compileOpening(spec,[host],[spec,{...other,center:{x:-80,y:0}}]));
    const tiny=G.compileOpening(spec,[host],[{...other,center:{x:-79.999,y:0}}]);
    close(tiny.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,.001);
  }
});

test('closed-end pocket coverage may change thickness, but surface backing must preserve its face', () => {
  const host=wall(1620),support=closedOverlapSupport(60);
  const pocket=slider({kind:'door-pocket',wallFace:'center'});
  const p=ok(G.compileOpening(pocket,[host,support],[]));
  assert.equal(p.geometry.backingMode,'pocket');
  assert.deepEqual(p.geometry.missingEnvelopeIntervalsMm,[],'Own intended opening and cavity remain traversable');
  const surface=G.compileOpening(slider(),[host,support],[]);
  assert.equal(surface.item,null);assert.deepEqual(surface.geometry.missingBackingIntervalsMm,[]);
  close(surface.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,30);
  const thin=G.compileOpening(pocket,[host,closedOverlapSupport(35)],[]);
  assert.equal(thin.item,null);
  close(thin.diagnostics.find(d=>d.code==='insufficient-slider-envelope').missingMm,30);
});

test('adjacent holes use actual renderer cut width, including its minimum fitting allowance', () => {
  const door=slider(),hole={id:'other',floor:1,kind:'door-opening',hostWallId:'host',center:{x:1002,y:0},widthMm:4};
  const r=G.compileOpening(door,[wall(2000)],[door,hole]);
  assert.equal(r.ok,false); assert.deepEqual(r.geometry.missingBackingIntervalsMm,[[780,1227]]);
  assert.equal(r.diagnostics.find(d=>d.code==='insufficient-slider-backing').missingMm,447);
});

test('backing can span contiguous reversed walls but cannot span tiny physical gaps', () => {
  const host=wall(900),next={...wall(2000),id:'next',x1:2000,x2:900};
  ok(G.compileOpening(slider(),[host,next,closedOverlapSupport()],[]));
  const r=G.compileOpening(slider(),[host,{...next,x2:904}],[]);
  assert.equal(r.ok,false); assert.deepEqual(r.geometry.missingBackingIntervalsMm,[[900,904]]);
  const shifted=G.compileOpening(slider(),[host,{...next,y1:1,y2:1}],[]);
  assert.equal(shifted.ok,false);
  const stepped=G.compileOpening(slider(),[host,{...next,thick:140}],[]);
  assert.equal(stepped.ok,false);
  const upstairs=G.compileOpening(slider(),[host,{...next,floor:2}],[]);
  assert.equal(upstairs.ok,false);
});

test('adjacent openings on continuing walls remove exact backing intervals', () => {
  const host=wall(900),next={...wall(2000),id:'next',x1:900};
  const hole={id:'hole',floor:1,kind:'door-opening',hostWallId:'next',center:{x:1200,y:0},widthMm:200};
  const r=G.compileOpening(slider(),[host,next],[hole]);
  assert.deepEqual(r.geometry.missingBackingIntervalsMm,[[975,1425]]);
  const touch={...hole,center:{x:1845,y:0}};
  ok(G.compileOpening(slider(),[host,next,closedOverlapSupport()],[touch]));
});

test('both opening widths and full-open travel collide with adjacent holes', () => {
  const other=hinge({id:'other',center:{x:2300,y:0},widthMm:200});
  const r=G.compileOpening(hinge(),[wall()],[other]);
  assert.ok(codes(r).includes('overlapping-openings'));
  const full=G.compileOpening(slider(),[wall()],[{...other,center:{x:1500,y:0}}]);
  assert.ok(codes(full).includes('insufficient-slider-backing'));
});

test('pocket doors require explicit centre track, solid full-open pocket and sufficient thickness', () => {
  const spec=slider({kind:'door-pocket',wallFace:'center'});
  const r=ok(G.compileOpening(spec,[wall(1620),closedOverlapSupport()],[]));
  assert.equal(r.geometry.parameters.leafZmm,0); assert.equal(r.geometry.backingMode,'pocket');
  assert.ok(codes(G.compileOpening({...spec,wallFace:undefined},[wall()],[])).includes('invalid-pocket-face'));
  assert.ok(codes(G.compileOpening(spec,[{...wall(),thick:35}],[])).includes('pocket-too-thin'));
  assert.ok(codes(G.compileOpening(spec,[wall(1560)],[])).includes('insufficient-slider-backing'));
  ok(G.compileOpening(spec,[{...wall(900),thick:36},{...wall(1620),id:'next',x1:900,thick:36},closedOverlapSupport(36)],[]));
});

test('double slider is the actual bypass pair, including direction and full-open leaf bounds', () => {
  for(const dir of [-1,1]) {
    const spec=slider({kind:'door-slide',widthMm:1600,center:{x:800,y:0},travelDirection:{x:dir,y:0},wallFace:{x:0,y:1}});
    const r=ok(G.compileOpening(spec,[wall(1600)],[]));
    assert.equal(r.item.flipX,dir>0);
    closePoint(r.geometry.travel,{x:dir*736,y:0});
    assert.deepEqual(r.geometry.fullOpenIntervalMm,dir>0?[736,1600]:[0,864]);
    assert.equal(r.geometry.parameters.leafWidthMm,864);
    assert.equal(r.geometry.backingMode,'fixed-bypass-leaf');
  }
});

test('double slider world face is rejected if the legacy renderer cannot express it', () => {
  const spec=slider({kind:'door-slide',center:{x:1000,y:0}});
  assert.ok(codes(G.compileOpening(spec,[wall()],[])).includes('unsupported-bypass-face'));
  const supported={...spec,wallFace:{x:0,y:1}};
  ok(G.compileOpening(supported,[wall()],[]));
  assert.ok(codes(G.compileOpening(supported,[{...wall(),x1:4000,x2:0}],[])).includes('unsupported-bypass-face'));
});

test('sliders reject absent/diagonal travel or invented explicit displacement', () => {
  for(const travelDirection of [undefined,{x:0,y:0},{x:1,y:1}])
    assert.ok(codes(G.compileOpening(slider({travelDirection}),[wall()],[])).includes('invalid-travel-direction'));
  assert.ok(codes(G.compileOpening(slider({wallFace:{x:1,y:0}}),[wall()],[])).includes('invalid-wall-face'));
  assert.ok(codes(G.compileOpening(slider({travel:{x:780,y:0}}),[wall()],[])).includes('opening-travel-mismatch'));
  ok(G.compileOpening(slider({travel:{x:810,y:0}}),[wall(),closedOverlapSupport()],[]));
});

test('plain doorway needs explicit span and host, with no invented swing or leaf', () => {
  const r=ok(G.compileOpening({id:'passage',floor:1,kind:'door-opening',hostWallId:'host',center:{x:1000,y:0},widthMm:900},[wall()],[]));
  assert.equal(r.item.type,'door-opening'); assert.equal(r.geometry.parameters.mode,'opening');
  assert.equal(r.geometry.fullOpenLeaf,undefined);
});

test('windows validate host and clear span without claiming sash-motion validation', () => {
  for(const kind of ['window','window-door']) {
    const spec={id:'glazing',floor:1,kind,hostWallId:'host',center:{x:1000,y:0},widthMm:900};
    const r=ok(G.compileOpening(spec,[wall()],[]));
    assert.equal(r.item.type,kind);assert.equal(r.geometry.motionValidation,'not-modeled');
    assert.equal(r.geometry.fullOpenLeaf,undefined);
    assert.equal(r.item.d,kind==='window-door'?180:150);
    assert.ok(codes(G.compileOpening({...spec,center:{x:1000,y:1}},[wall()],[])).includes('opening-off-host'));
  }
});

test('strict host identity persists through JSON save/load and defeats nearest-wall ties', () => {
  const w=wall(), cross={id:'cross',floor:1,x1:2000,y1:-1000,x2:2000,y2:1000,thick:120};
  const r=ok(G.compileOpening(hinge(),[w],[]));
  const saved=JSON.parse(JSON.stringify(r.item));
  assert.equal(saved.openingHostWallId,'host');
  assert.equal(G.explicitHostWallInfo(saved,[cross,w]).wall,w);
  assert.equal(G.explicitHostWallInfo(saved,[cross]),null);
  assert.equal(G.explicitHostWallInfo(saved,[w,{...w}]),null);
  assert.equal(G.explicitHostWallInfo({...saved,x:-1},[w]),null);
  assert.equal(G.explicitHostWallInfo(saved,[{...w,y1:10,y2:10}]),null);
  assert.equal(G.explicitHostWallInfo(saved,[{...w,x1:4000,x2:0}]),null);
});

test('actual display resolver uses saved exact binding, while legacy items retain nearest/clamp', () => {
  const source=fs.readFileSync(path.join(root,'assets/js/draw-2d.js'),'utf8');
  const start=source.indexOf('function getOpeningWallInfo(it){');
  const end=source.indexOf('// ── 片引き戸',start);
  const w=wall(),cross={id:'cross',floor:1,x1:2000,y1:-1000,x2:2000,y2:1000,thick:120};
  const context=vm.createContext({SceneOpeningGeometry:G,DATA:{walls:[cross,w]},
    isOpeningItemType:()=>true,getOpeningCenterCandidates:it=>[{x:it.x+it.w/2,y:it.y+it.d/2}]});
  vm.runInContext(source.slice(start,end),context);
  const item=ok(G.compileOpening(hinge(),[w],[])).item;
  assert.equal(context.getOpeningWallInfo(item).wall,w);
  assert.equal(context.getOpeningWallInfo({...item,openingHostWallId:'gone'}),null);
  const legacy={...item}; delete legacy.openingHostWallId;
  assert.equal(context.getOpeningWallInfo(legacy).wall,cross);
});

test('renderer extraction retains legacy scalar dimensions and consumes shared parameters', () => {
  for(const type of ['door-slide-s','door-pocket','door-slide','door-swing','door-front'])
    for(const width of [650,780,940,1650]) for(const flipX of [false,true]) for(const flipY of [false,true]) {
      const p=G.rendererParameters({type,w:width,flipX,flipY},120);
      if(p.mode==='single') {
        close(p.leafWidthMm/1000,width/1000+.06);
        close(p.openXmm/1000,(flipX?-1:1)*(width/1000+.03));
        close(p.leafZmm/1000,type==='door-pocket'?0:(flipY?1:-1)*(.060+.036/2+.008));
      }else if(p.mode==='bypass'){
        close(p.leafWidthMm/1000,width/1000*.54);
        close(p.openXmm/1000,(flipX?1:-1)*width/1000*.23);
      }else{
        close(p.hingeXmm/1000,(flipX?1:-1)*width/2000);
        close(p.openAngleY,-(flipY?-1:1)*Math.PI/2);
      }
    }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const fragment of ['assets/js/scene-opening-geometry.js','SceneOpeningGeometry.rendererParameters(it,best.thick||120)',
    'ssGeometry.leafWidthMm*U','ssGeometry.openXmm*U','ssGeometry.leafThicknessMm*U',
    'bypassGeometry.leafWidthMm*U','bypassGeometry.fixedXmm*U','bypassGeometry.leafZmm*U',
    'hingeGeometry.hingeXmm*U','hingeGeometry.openAngleY','SceneOpeningGeometry.wallCutWidthMm(it,len/U)*U']) assert.ok(html.includes(fragment),fragment);
});

test('shared wall-cut geometry preserves renderer margins, minima and host clipping', () => {
  assert.equal(G.wallCutWidthMm({type:'door-slide-s',w:780},4000),860);
  assert.equal(G.wallCutWidthMm({type:'door-opening',w:4},4000),450);
  assert.equal(G.wallCutWidthMm({type:'door-opening',w:780},800),800);
  assert.equal(G.wallCutWidthMm({type:'window',w:780},4000),780);
  assert.equal(G.wallCutWidthMm({type:'window',w:4},4000),100);
  assert.equal(G.wallCutWidthMm({type:'door-slide-s',w:'780'},4000),860);
  assert.equal(G.rendererParameters({type:'door-slide-s',w:'780'},120).leafWidthMm,840);
});

test('single-slider swept leaf rejects perpendicular obstructions even with sufficient backing', () => {
  const blocker={id:'blocker',floor:1,x1:1200,y1:-160,x2:1200,y2:-50,thick:20};
  const r=G.compileOpening(slider(),[wall(),blocker],[]);
  assert.deepEqual(r.geometry.missingBackingIntervalsMm,[]);
  assert.ok(codes(r).includes('opening-sweep-collision'));
  ok(G.compileOpening(slider(),[wall(),closedOverlapSupport(),{...blocker,floor:2}],[]));
  ok(G.compileOpening(slider(),[wall(),closedOverlapSupport(),{...blocker,y1:-180,y2:-105}],[]));
});

test('hinge sweep detects tiny mid-arc walls by analytic contact angles, not endpoint or coarse sampling', () => {
  const theta=Math.PI/7,radius=700,x=1610+Math.cos(theta)*radius,y=Math.sin(theta)*radius;
  const blocker={id:'blocker',floor:1,x1:x-.5,y1:y,x2:x+.5,y2:y,thick:1};
  const r=G.compileOpening(hinge(),[wall(),blocker],[]);
  assert.ok(codes(r).includes('opening-sweep-collision'));
  const far={...blocker,x1:1610+Math.cos(theta)*900-.5,x2:1610+Math.cos(theta)*900+.5,y1:Math.sin(theta)*900,y2:Math.sin(theta)*900};
  ok(G.compileOpening(hinge(),[wall(),far],[]));
  ok(G.compileOpening(hinge({swingSide:{x:0,y:-1}}),[wall(),blocker],[]));
});

test('compilation is pure, repeatable, and does not pass through unauthorized item fields', () => {
  const spec=slider({texture:'secret',color:'#000000',widthMm:780}),walls=[wall(),closedOverlapSupport()],others=[];
  const before=JSON.stringify({spec,walls,others});
  const first=ok(G.compileOpening(spec,walls,others)),second=ok(G.compileOpening(spec,walls,others));
  assert.deepEqual(first,second); assert.equal(JSON.stringify({spec,walls,others}),before);
  assert.equal(first.item.texture,undefined); assert.equal(first.item.color,undefined);
});
