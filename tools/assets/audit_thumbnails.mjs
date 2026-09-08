import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const entries=['furniture_mega','interior_model_0_26_1','custom'].flatMap(m=>JSON.parse(fs.readFileSync(`assets/models/${m}/manifest.json`)).items).concat([{id:'context-car',name:'自動車',thumb:'assets/models/previews-v2/context-car-thumb.png'}]);
const known=new Set(entries.map(e=>e.id));for(const e of JSON.parse(fs.readFileSync('assets/models/previews-v2/manifest.json')))if(!known.has(e.id))entries.push({...e,name:e.id});
entries.forEach(e=>{if(e.id==='context-futon_set'){e.thumb='assets/icons/futon.svg';e.name='布団セット（平面記号）';}});
const dir='docs/quality-review/thumbnails';fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch();try {
 const p=await browser.newPage({viewport:{width:1200,height:1100}});await p.goto('http://localhost:8932/');
 const results=[];
 for(let offset=0;offset<entries.length;offset+=48){
 const rows=entries.slice(offset,offset+48);const checks=await p.evaluate(async rows=>{
  document.body.innerHTML='';document.body.style='margin:0;background:#e7e9e4;font:11px system-ui;display:grid;grid-template-columns:repeat(8,150px)';const out=[];
  for(const e of rows){const cell=document.createElement('div');cell.style='height:180px;padding:5px;box-sizing:border-box;overflow:hidden;background:#f6f6f1;border:1px solid #ddd';const img=new Image();img.src='/'+e.thumb;img.style='width:140px;height:140px;object-fit:contain';cell.append(img);const label=document.createElement('div');label.textContent=e.name||e.id;cell.append(label);document.body.append(cell);try{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const cx=c.getContext('2d');cx.drawImage(img,0,0);const px=cx.getImageData(0,0,c.width,c.height).data;let n=0,l=c.width,r=0,t=c.height,b=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(px[(y*c.width+x)*4+3]>32){n++;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}out.push({id:e.id,width:c.width,height:c.height,pixels:n,bounds:[l,t,r,b],edge:l<2||t<2||r>c.width-3||b>c.height-3});}catch(err){out.push({id:e.id,error:String(err)});}}
  return out;
 },rows);results.push(...checks);await p.screenshot({path:`${dir}/sheet-${String(offset/48+1).padStart(2,'0')}.png`});
 }
 fs.writeFileSync(`${dir}/audit.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({count:results.length,issues:results.filter(r=>r.error||r.pixels<100||r.edge)}));
}finally{await browser.close();}
