// Offline geometry only: synthetic expected extractions, never hosted model output.
const fixtures = require('./tests/fixtures/extraction/synthetic.json');
const path = require('node:path');
const grid = require(path.resolve(process.argv[2] || 'assets/js/plan-grid.js'));
function owner(rects, x, y) {
  return rects.find(r => x > r.x && x < r.x+r.w && y > r.y && y < r.y+r.d)?.n || '.';
}
function expectedRects(f) { return f.rooms.flatMap(r => r.parts.map(p => ({n:r.name,x:p.x0,y:p.y0,w:p.x1-p.x0,d:p.y1-p.y0}))); }
function adjacency(rects) {
  const edges=new Set();
  for(const a of rects) for(const b of rects) {
    if(a.n===b.n) continue;
    const vertical=(a.x+a.w===b.x || b.x+b.w===a.x) && Math.min(a.y+a.d,b.y+b.d)>Math.max(a.y,b.y);
    const horizontal=(a.y+a.d===b.y || b.y+b.d===a.y) && Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x);
    if(vertical||horizontal) edges.add([a.n,b.n].sort().join('/'));
  }
  return [...edges].sort();
}
function metrics(f, built) {
  const expected = expectedRects(f);
  // Exact area of the symmetric difference of room-labelled regions, by subdividing
  // at every expected AND actual boundary (no raster sampling approximation).
  const all = expected.concat(built.rooms);
  const xs = [...new Set([0,f.width,...all.flatMap(r=>[r.x,r.x+r.w])])].sort((a,b)=>a-b);
  const ys = [...new Set([0,f.depth,...all.flatMap(r=>[r.y,r.y+r.d])])].sort((a,b)=>a-b);
  let mismatch = 0;
  for(let i=1;i<xs.length;i++) for(let j=1;j<ys.length;j++) {
    const x=(xs[i-1]+xs[i])/2, y=(ys[j-1]+ys[j])/2;
    if(owner(expected,x,y)!==owner(built.rooms,x,y)) mismatch+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1]);
  }
  const distances = f.openings.map(o => Math.min(...built.walls.filter(w => o.axis==='v'
    ? w.x1===w.x2 && o.y>=w.y1 && o.y<=w.y2
    : w.y1===w.y2 && o.x>=w.x1 && o.x<=w.x2).map(w=>o.axis==='v'?Math.abs(o.x-w.x1):Math.abs(o.y-w.y1))));
  return {fixture:f.name, labelledAreaErrorMm2:mismatch, roomsLost:f.rooms.filter(r=>!built.rooms.some(b=>b.n===r.name)).length,
    expectedAdjacency:adjacency(expected), actualAdjacency:adjacency(built.rooms),
    openingWallOffsetsMm:distances, openingsOnWall:distances.filter(d=>d<0.001).length, openings:distances.length};
}
if(require.main===module) {
  console.log(JSON.stringify({evaluation:'offline synthetic extraction reconstruction; no model calls',results:fixtures.map(f=>metrics(f,grid.build(f)))},null,2));
  if(process.argv[3]) {
    const fs=require('node:fs'), Draw=require('../assets/js/plan-review-draw.js');
    fs.mkdirSync(process.argv[3],{recursive:true});
    for(const f of fixtures) {
      const built=grid.build(f), s=360/Math.max(f.width,f.depth);
      function panel(rects, walls, shift, label) {
        return `<g transform="translate(${shift},70)"><text x="0" y="-20" font-size="16">${label}</text>`+
          rects.map(r=>`<rect x="${r.x*s}" y="${r.y*s}" width="${r.w*s}" height="${r.d*s}" fill="${r.n==='B'?'#dcebe3':'#e0e9f6'}"/>`).join('')+
          walls.map(w=>`<path d="M${w[0]*s},${w[1]*s} L${w[2]*s},${w[3]*s}" stroke="#263849" stroke-width="2"/>`).join('')+
          f.openings.map(o=>`<circle cx="${o.x*s}" cy="${o.y*s}" r="5" fill="${o.type==='door'?'#dc4530':'#1884cf'}"/>`).join('')+'</g>';
      }
      const sourceWalls=f.rooms.flatMap(Draw.roomEdges);
      const actualWalls=built.walls.map(w=>[w.x1,w.y1,w.x2,w.y2]);
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="480" viewBox="0 0 850 480"><rect width="850" height="480" fill="white"/><text x="20" y="24" font-family="sans-serif" font-size="16">${f.name}: synthetic geometry only, no model evaluation</text>${panel(expectedRects(f),sourceWalls,35,'Reference (mm coordinates)')}${panel(built.rooms,actualWalls,455,'Reconstructed')}<text x="20" y="466" font-size="14">Red = test door center; blue = test window center. Centers are unchanged.</text></svg>`;
      fs.writeFileSync(path.join(process.argv[3],f.name+'.svg'),svg);
    }
  }
}
module.exports={fixtures,metrics};
