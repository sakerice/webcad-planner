const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=require('./app-source.cjs').appSource();
const {nativeOutputContextSource,nativeCaptureTransactionSource}=require('./native-output-source.cjs');
const {nativeCaptureModules,installNativeCaptureRuntime}=require('./native-capture-test-support.cjs');
let captureModules;
test.before(async()=>{captureModules=await nativeCaptureModules();});
const VideoPrompt=require('../../assets/js/video-prompt.js');
function fn(name){
 let start=html.indexOf('\nfunction '+name+'(');if(start<0)start=html.indexOf('\nasync function '+name+'(');assert.ok(start>=0,name);start++;
 let depth=0,mode=null;
 for(let i=html.indexOf('{',start);i<html.length;i++){
  const c=html[i],n=html[i+1];if(mode==='line'){if(c==='\n')mode=null;continue;}if(mode==='block'){if(c==='*'&&n==='/'){mode=null;i++;}continue;}
  if(mode){if(c==='\\'){i++;continue;}if(c===mode)mode=null;continue;}
  if(c==='/'&&n==='/'){mode='line';i++;continue;}if(c==='/'&&n==='*'){mode='block';i++;continue;}if(c==='"'||c==="'"||c==='`'){mode=c;continue;}
  if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);
 }
 throw Error('Unclosed '+name);
}
function variable(name){const m=html.match(new RegExp('\\nvar '+name+'\\s*=[^;\\n]*;'));assert.ok(m,name);return m[0];}
function element(tag='div'){
 const classes=new Set(),attrs={},el={tagName:tag.toUpperCase(),style:{},value:'',checked:false,disabled:false,children:[],textContent:'',attrs,
  classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){on=on===undefined?!classes.has(c):on;on?classes.add(c):classes.delete(c);return on;}},
  setAttribute(k,v){attrs[k]=v;if(k==='src')this.src=v;},removeAttribute(k){delete attrs[k];if(k==='src')delete this.src;},getAttribute:k=>attrs[k]??null,
  appendChild(child){child.parentNode=this;this.children.push(child);return child;},removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;},focus(){},select(){}};
 let content='';Object.defineProperty(el,'innerHTML',{get:()=>content,set:v=>{content=v;el.children=[];}});return el;
}
const FUNCTIONS=[
 'setAiDownloadLink','revokeAiRenderDownloadUrls','makeAiDownloadObjectUrl','clearAiRenderDownloadLinks','dataUrlToBlobSync',
 'setAiPackagePreview','setAiInstructionsPreview','aiRenderPackageJsonText','setAiImageDownloadLink','syncAiRenderDownloadLinks','handleAiDownloadLinkClick',
 'openUnityRenderModal','closeUnityRenderModal','setUnityRenderStatus','setUnityRenderImage','setUnityRenderBusy','generateAiRenderPackage',
 'copyAiRenderPrompt','downloadAiRenderPrompt','downloadAiRenderPackageJson','downloadAiRenderImage','downloadAiRenderBundle',
 'videoRenderSourceFromView','videoRenderSourceLabel','videoRenderPresetById','videoRenderSelectedPresetId','videoRenderSelectedPreset',
 'videoRenderFillPresetOptions','videoRenderSourceNoteText','syncVideoRenderSource','videoRenderDurationSec','onVideoRenderDurationInput',
 'videoRenderIncludesGuides','videoRenderNote','setVideoRenderStatus','setVideoRenderImage','setVideoInstructionsPreview',
 'makeVideoDownloadObjectUrl','clearVideoRenderDownloadLinks','syncVideoRenderDownloadLinks','handleVideoDownloadLinkClick',
 'copyVideoRenderPrompt','setVideoRenderBusy','openVideoRenderDialog','closeVideoRenderModal','runVideoRenderPackage','generateVideoRenderPackage',
 'cancelJisPendingOutputs','openJisDrawingDialog','closeJisDrawingDialog','jisSelectSheet','renderJisSheetList','jisCurrentOpts','jisCurrentSvg',
 'jisRerender','jisSetStatus','jisFileBaseName','jisDownloadSvg','jisDownloadPng','jisRemovePrintIframe','jisPrint'];
const VARIABLES=['AI_RENDER_PACKAGE','AI_RENDER_DOWNLOAD_URLS','AI_RENDER_CAPTURE_SPEC','unityRenderBusy','VIDEO_RENDER_PACKAGE','VIDEO_RENDER_UI',
 'VIDEO_RENDER_MIN_DURATION_SEC','VIDEO_RENDER_DOWNLOAD_URLS','VIDEO_RENDER_DL_IDS','JIS_UI','JIS_PNG_JOBS','JIS_PRINT_IFRAME'];
function syntheticPlan(marker='A'){return {marker,walls:[{id:'wall-'+marker,floor:1,x1:0,y1:0,x2:2000,y2:0}],rooms:[],items:[],floors:[1,2]};}
function runtime(view='3d-int'){
 const els=new Map(),captures=[],downloads=[],images=[],blobs=new Map(),revoked=[],timers=[],gates=new Map(),pngCallbacks=[],iframes=[];
 const el=id=>{if(!els.has(id))els.set(id,element(/(?:img)$/.test(id)?'img':/(?:dl-)/.test(id)?'a':'div'));return els.get(id);};
 const buttons=[element('button'),element('button')];buttons[1].classList.add('unity-render-close');
 const noop=()=>{},body=element('body');
 async function step(name){const gate=gates.get(name);if(gate){gates.delete(name);gate.enter();await gate.promise;}}
 const ctx={console,VideoPrompt,Blob,TextEncoder,Uint8Array,Set,Map,Date,JSON,Array,Object,Promise,atob:x=>Buffer.from(x,'base64').toString('binary'),
  __editorPlanId:'plan-a',DATA:syntheticPlan(),ST:{view,floor:1,selected:null,multiSelected:[]},LIGHT_SETTINGS:{hour:12,northDeg:0},
  document:{getElementById:el,querySelectorAll:()=>buttons,querySelector:()=>null,documentElement:{classList:{add:noop}},addEventListener:noop,body,
   createElement(tag){const out=element(tag);if(tag==='canvas'){out.getContext=()=>({fillRect:noop,drawImage:noop});out.toBlob=cb=>pngCallbacks.push(cb);}
    if(tag==='iframe'){out.contentWindow={focus:noop,print(){out.printCount=(out.printCount||0)+1;},document:{fonts:{ready:new Promise(resolve=>out.resolveFonts=resolve)}}};iframes.push(out);}return out;}},
  URL:{createObjectURL(blob){const url='blob:anonymous/'+(blobs.size+1);blobs.set(url,blob);return url;},revokeObjectURL:url=>revoked.push(url)},
  Image:function(){images.push(this);},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout:noop,
  navigator:{clipboard:{writeText:async text=>downloads.push({clipboard:text})}},isSecureContext:true,
  isUnityRenderFeatureEnabled:()=>true,syncUnityRenderServerInput:noop,syncAiRenderSource:noop,
  ensureAiRenderableView:async()=>{await step('ensure');ctx.ST.view='3d-int';return true;},isAiCaptureView:()=>ctx.ST.view!=='2d',
  waitFrame:async()=>step('frame'),
  captureCurrent3DDataUrl(){captures.push(['base',ctx.DATA.marker]);return 'data:image/png;base64,'+Buffer.from(ctx.DATA.marker.repeat(1300)).toString('base64');},
  captureSegmentation3DDataUrl(){captures.push(['seg',ctx.DATA.marker]);return 'data:image/png;base64,'+'A'.repeat(1300);},
  captureInstance3DData(){captures.push(['instance',ctx.DATA.marker]);return {dataUrl:'data:image/png;base64,'+'A'.repeat(1300),legend:[{id:'wall-'+ctx.DATA.marker,type:'wall',floor:1}]};},
  captureAiOverrideGuideDataUrl(kind){captures.push([kind,ctx.DATA.marker]);return 'data:image/png;base64,'+'A'.repeat(1300);},
  buildAiRenderMetadata(legend){return {version:2,createdAt:'2026-01-01T00:00:00Z',marker:ctx.DATA.marker,instanceLegend:legend,segmentationLegend:[]};},
  makeEdgeDataUrlFromSegmentation:async()=>{await step('edge');return 'data:image/png;base64,'+'A'.repeat(1300);},
  buildAiRenderPrompt:meta=>'image-'+meta.marker,
  dataUrlToBytes:async url=>{await step('bytes');return new TextEncoder().encode(url);},
  makeZipBlob:files=>({files:files.map(f=>({name:f.name,content:new TextDecoder().decode(f.bytes)}))}),
  downloadBlobFile:(filename,blob)=>downloads.push({filename,blob}),downloadTextFile:(filename,text)=>downloads.push({filename,text}),
  downloadDataUrl:(filename,dataUrl)=>downloads.push({filename,dataUrl}),
  resolveVideoPreset:(source,id)=>({id:id||'anonymous',label:'anonymous'}),videoDaylightDescriptor:()=>({hour:ctx.LIGHT_SETTINGS.hour}),
  planSubjectBoundsMm:()=>({minX:0,minY:0,maxX:2000,maxY:2000}),planEmptyFloorRefusal:()=>null,
  waitForPlanFloorTopImages:async()=>{await step('top');return {images:1,pending:0};},
  capturePlan2dDataUrl(){captures.push(['plan',ctx.DATA.marker]);ctx.PLAN_CAPTURE_VIEW={};return 'data:image/png;base64,'+Buffer.from(ctx.DATA.marker.repeat(1300)).toString('base64');},
  planCaptureScaleForVideo:()=>1,planCapturePlaceholderRoster:()=>[],
  decodePngDataUrlToImageData:async()=>{await step('decode');return {width:100,height:100};},
  planSubjectFrameRatio:()=>1,planInstanceList:()=>[{id:'wall-'+ctx.DATA.marker,floor:1,type:'wall'}],
  composeVideoPromptOrThrow:opt=>'video-'+opt.legend[0].id,videoPackageJson:opt=>opt,videoHeightModelRecord:()=>({marker:ctx.DATA.marker}),
  videoShadowLiftRecord:()=>({}),videoPlanWithheldRecord:()=>({}),aiCaptureViewMode:()=>ctx.ST.view,videoRenderViewRefusalText:()=>'',
  LockTiers:{tableFor:()=>({}),tierOf:()=>1},ShadowLift:{measure:()=>[],curveFor:()=>({}),apply:x=>x},
  imageDataToPngDataUrl:()=> 'data:image/png;base64,'+'A'.repeat(1300),videoCameraDescriptor:()=>({posM:[0,1,0]}),
  planContextBoundsMm:()=>({}),drawPlanCameraOverlay:async plan=>{await step('overlay');return plan;},aiSegmentationLegend:()=>[],
  JISDRAW:{availableSheets:()=>ctx.DATA.floors.map(floor=>({kind:'plan',key:floor,label:floor+'F'})),
   buildFloorPlanSvg:floor=>'<svg viewBox="0 0 420 297"><text>'+ctx.DATA.marker+'-'+floor+'</text></svg>',buildElevationSvg:()=>'<svg></svg>'},
  elevationDirCode:x=>x,alert:noop};
 installNativeCaptureRuntime(ctx,captureModules);
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(VARIABLES.map(variable).join('\n')+'\n'+nativeOutputContextSource()+'\n'+nativeCaptureTransactionSource()+'\n'+FUNCTIONS.map(fn).join('\n'),ctx);
 el('jis-scale').value='auto';el('jis-paper').value='a3';el('video-render-duration').value='8';
 function pause(name){let release,enter;const promise=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>enter=resolve);gates.set(name,{promise,enter});return {name,release,entered};}
 function switchPlan(marker='B'){ctx.DATA=syntheticPlan(marker);ctx.__editorPlanId='plan-'+marker.toLowerCase();ctx.invalidateNativeOutputs();}
 return {ctx,el,buttons,captures,downloads,images,blobs,revoked,timers,pngCallbacks,iframes,pause,switchPlan};
}
const tick=()=>new Promise(setImmediate);
async function waitForGate(gate,pending,timeoutMs=5000){
 let timer;
 try{
  await Promise.race([gate.entered,Promise.resolve(pending).then(()=>{throw Error('generation completed before '+gate.name+' gate');},error=>{throw Error('generation failed before '+gate.name+' gate',{cause:error});}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timed out waiting for '+gate.name+' gate')),timeoutMs);})]);
 }finally{clearTimeout(timer);}
}
test('async gate reports early completion/failure instead of waiting forever',async()=>{
 const gate={name:'unreached',entered:new Promise(()=>{})};
 await assert.rejects(waitForGate(gate,Promise.resolve(null)),/generation completed before unreached gate/);
 const failure=Error('capture setup regression');
 await assert.rejects(waitForGate(gate,Promise.reject(failure)),error=>error.message==='generation failed before unreached gate'&&error.cause===failure);
});
test('async gate has a bounded failure path for a stalled generation',async()=>{
 const never=new Promise(()=>{});
 await assert.rejects(waitForGate({name:'stalled',entered:never},never,10),/timed out waiting for stalled gate/);
});

test('completed image/video outputs remain native packages and the exact anonymous source is unchanged',async()=>{
 const r=runtime(),before=JSON.stringify(r.ctx.DATA),image=await r.ctx.generateAiRenderPackage();
 assert.equal(image.metadata.marker,'A');assert.equal(image.prompt,'image-A');assert.equal(JSON.stringify(r.ctx.DATA),before);
 assert.ok(image.zipBlob.files.find(f=>f.name==='ai-render-package.json').content.includes('"marker": "A"'));
 assert.ok(!JSON.stringify(image).includes('_nativeOutputContext'));
 r.ctx.closeUnityRenderModal();r.ctx.openUnityRenderModal();assert.equal(r.ctx.AI_RENDER_PACKAGE,image);assert.ok(r.ctx.isNativeOutputPackageCurrent(image));
 r.ctx.ST.view='2d';const video=await r.ctx.runVideoRenderPackage();assert.ok(video);assert.equal(video.packageJson.instances[0].id,'wall-A');
 assert.ok(video.zipBlob.files.find(f=>f.name==='package.json').content.includes('wall-A'));assert.equal(JSON.stringify(r.ctx.DATA),before);
 assert.ok(r.captures.every(c=>c[1]==='A'));assert.equal(r.downloads.length,0);
});
for(const phase of ['ensure','frame','edge','bytes'])test('image plan switch during '+phase+' cannot publish/download old output',async()=>{
 const r=runtime(),gate=r.pause(phase),pending=r.ctx.generateAiRenderPackage();await waitForGate(gate,pending);
 r.switchPlan();r.ctx.openUnityRenderModal();const newStatus=r.el('unity-render-status').textContent;gate.release();assert.equal(await pending,null);
 assert.equal(r.ctx.AI_RENDER_PACKAGE,null);assert.equal(r.el('unity-render-status').textContent,newStatus);assert.equal(r.ctx.unityRenderBusy,false);assert.equal(r.downloads.length,0);
 if(phase==='ensure'||phase==='frame')assert.equal(r.captures.length,0);
});
for(const kind of ['image','video'])test(kind+' exact same-ID source edits reject late output and allow retry',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int'),gate=r.pause(kind==='video'?'decode':'edge');
 const pending=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(gate,pending);r.ctx.DATA.walls[0].x2=3000;gate.release();assert.equal(await pending,null);
 assert.match(r.el(kind==='image'?'unity-render-status':'video-render-status').textContent,/元の間取りが変更/);
 assert.equal(kind==='image'?r.ctx.unityRenderBusy:r.ctx.VIDEO_RENDER_UI.busy,false);
 const retry=kind==='image'?await r.ctx.generateAiRenderPackage():await r.ctx.runVideoRenderPackage();assert.ok(retry);assert.equal(retry._nativeOutputContext.snapshot,JSON.stringify(r.ctx.DATA));
});
for(const kind of ['image','video'])test(kind+' identity-only source change cancels request and releases its busy state',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int'),gate=r.pause(kind==='video'?'decode':'edge');
 const pending=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(gate,pending);
 r.ctx.__editorPlanId='anonymous-new-identity';gate.release();assert.equal(await pending,null);
 assert.equal(kind==='image'?r.ctx.unityRenderBusy:r.ctx.VIDEO_RENDER_UI.busy,false);assert.equal(r.downloads.length,0);
});
for(const kind of ['image','video'])test(kind+' same-ID Undo-shaped DATA replacement releases busy and preserves newer source',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int'),gate=r.pause(kind==='video'?'decode':'edge');
 const pending=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(gate,pending);
 r.ctx.DATA=JSON.parse(JSON.stringify(r.ctx.DATA));r.ctx.DATA.walls[0].x2=3000;const replacement=r.ctx.DATA;gate.release();assert.equal(await pending,null);
 assert.equal(kind==='image'?r.ctx.unityRenderBusy:r.ctx.VIDEO_RENDER_UI.busy,false);assert.equal(r.ctx.DATA,replacement);
 assert.match(r.el(kind==='image'?'unity-render-status':'video-render-status').textContent,/元の間取りが変更/);
 assert.ok(kind==='image'?await r.ctx.generateAiRenderPackage():await r.ctx.runVideoRenderPackage());
});
for(const kind of ['image','video'])test(kind+' close/reopen cancels old completion without overwriting newer results or inputs',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int'),gate=r.pause(kind==='video'?'top':'edge');r.el('video-render-note').value='anonymous note';r.el('ai-render-style-input').value='anonymous style';
 const old=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(gate,old);
 if(kind==='image'){r.ctx.closeUnityRenderModal();r.ctx.openUnityRenderModal();}else{r.ctx.closeVideoRenderModal();r.ctx.openVideoRenderDialog();}
 const newer=kind==='image'?await r.ctx.generateAiRenderPackage():await r.ctx.runVideoRenderPackage(),status=r.el(kind==='image'?'unity-render-status':'video-render-status').textContent;
 assert.ok(newer);gate.release();assert.equal(await old,null);assert.equal(kind==='image'?r.ctx.AI_RENDER_PACKAGE:r.ctx.VIDEO_RENDER_PACKAGE,newer);
 assert.equal(r.el(kind==='image'?'unity-render-status':'video-render-status').textContent,status);assert.equal(r.el('video-render-note').value,'anonymous note');assert.equal(r.el('ai-render-style-input').value,'anonymous style');
});
for(const kind of ['image','video'])test(kind+' stale failure/finally cannot reset a newer request still busy',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int'),phase=kind==='video'?'top':'edge',oldGate=r.pause(phase);
 const old=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(oldGate,old);
 const newGate=r.pause(phase),newer=kind==='image'?r.ctx.generateAiRenderPackage():r.ctx.runVideoRenderPackage();await waitForGate(newGate,newer);
 const status=r.el(kind==='image'?'unity-render-status':'video-render-status').textContent;oldGate.release();assert.equal(await old,null);
 assert.equal(kind==='image'?r.ctx.unityRenderBusy:r.ctx.VIDEO_RENDER_UI.busy,true);assert.equal(r.el(kind==='image'?'unity-render-status':'video-render-status').textContent,status);
 newGate.release();assert.ok(await newer);assert.equal(kind==='image'?r.ctx.unityRenderBusy:r.ctx.VIDEO_RENDER_UI.busy,false);
});
test('runtime-only texture references do not invalidate the exact serialized plan source',async()=>{
 const r=runtime(),texture={anonymous:true};texture.self=texture;r.ctx.DATA.items.push({id:'anonymous-item',_texObj:texture});
 const pkg=await r.ctx.generateAiRenderPackage();assert.ok(pkg);r.ctx.DATA.items[0]._texObj={replacement:true};assert.equal(r.ctx.isNativeOutputPackageCurrent(pkg),true);
 r.ctx.DATA.items[0].id='changed-item';assert.equal(r.ctx.isNativeOutputPackageCurrent(pkg),false);
});
for(const phase of ['top','decode','bytes'])test('video plan source cannot mix plans during '+phase,async()=>{
 const r=runtime('2d'),gate=r.pause(phase),pending=r.ctx.runVideoRenderPackage();await waitForGate(gate,pending);r.switchPlan();gate.release();assert.equal(await pending,null);
 assert.equal(r.ctx.VIDEO_RENDER_PACKAGE,null);assert.equal(r.ctx.VIDEO_RENDER_UI.busy,false);assert.equal(r.downloads.length,0);assert.ok(r.captures.every(c=>c[1]==='A'));
 if(phase==='top')assert.equal(r.captures.length,0);
});
test('3D video interrupts before its next live capture after a plan switch',async()=>{
 const r=runtime(),gate=r.pause('decode'),pending=r.ctx.runVideoRenderPackage();await waitForGate(gate,pending);r.switchPlan();gate.release();assert.equal(await pending,null);
 assert.deepEqual(r.captures.map(x=>x[0]),['base','instance']);assert.equal(r.ctx.VIDEO_RENDER_PACKAGE,null);
});
test('committed switch revokes both native download URL bags and resets JIS, preserving inputs',async()=>{
 const r=runtime();await r.ctx.generateAiRenderPackage();r.ctx.ST.view='2d';await r.ctx.runVideoRenderPackage();r.ctx.openJisDrawingDialog();r.ctx.jisSelectSheet('plan',2);
 const urls=[...r.ctx.AI_RENDER_DOWNLOAD_URLS,...r.ctx.VIDEO_RENDER_DOWNLOAD_URLS];assert.ok(urls.length>0);r.el('video-render-note').value='keep note';r.switchPlan();
 assert.ok(urls.every(url=>r.revoked.includes(url)));assert.equal(r.ctx.JIS_UI.sheet,null);assert.equal(r.el('jis-drawing-overlay').style.display,'none');assert.equal(r.el('jis-preview').innerHTML,'');
 assert.equal(r.ctx.AI_RENDER_PACKAGE,null);assert.equal(r.ctx.VIDEO_RENDER_PACKAGE,null);assert.equal(r.el('video-render-note').value,'keep note');
 r.ctx.openJisDrawingDialog();assert.equal(r.ctx.JIS_UI.sheet.key,1);assert.ok(r.el('jis-preview').innerHTML.includes('B-1'));
});
for(const kind of ['image','video'])test(kind+' stale download link is blocked even for same-ID edits',async()=>{
 const r=runtime(kind==='video'?'2d':'3d-int');if(kind==='image')await r.ctx.generateAiRenderPackage();else await r.ctx.runVideoRenderPackage();r.ctx.DATA.walls[0].x2=3000;
 let prevented=false;const event={currentTarget:r.el(kind==='image'?'ai-dl-bundle':'video-dl-bundle'),preventDefault(){prevented=true;}};
 assert.equal(kind==='image'?r.ctx.handleAiDownloadLinkClick(event):r.ctx.handleVideoDownloadLinkClick(event),false);assert.equal(prevented,true);assert.equal(r.downloads.length,0);
 assert.equal(kind==='image'?r.ctx.AI_RENDER_PACKAGE:r.ctx.VIDEO_RENDER_PACKAGE,null);
});
test('image download waiting for generation does not adopt another plan/newer package',async()=>{
 const r=runtime(),gate=r.pause('edge'),old=r.ctx.downloadAiRenderPrompt();await waitForGate(gate,old);r.switchPlan();const newer=await r.ctx.generateAiRenderPackage();gate.release();await old;
 assert.equal(r.ctx.AI_RENDER_PACKAGE,newer);assert.equal(r.downloads.length,0);
 await r.ctx.downloadAiRenderPrompt();assert.equal(r.downloads[0].text,'image-B');
});
test('fallback image ZIP encoding retains a local package and blocks download after source change',async()=>{
 const r=runtime(),pkg=await r.ctx.generateAiRenderPackage();pkg.zipBlob=null;const gate=r.pause('bytes'),pending=r.ctx.downloadAiRenderBundle();await waitForGate(gate,pending);r.switchPlan();gate.release();await pending;assert.equal(r.downloads.length,0);
});
test('JIS PNG cancels loading immediately on close and revokes its temporary URL once',()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisDownloadPng();const img=r.images[0],callback=img.onload,url=img.src;
 r.ctx.closeJisDrawingDialog();assert.equal(img.onload,null);assert.equal(r.ctx.JIS_PNG_JOBS.size,0);assert.equal(r.revoked.filter(u=>u===url).length,1);callback();assert.equal(r.downloads.length,0);
});
for(const change of ['switch','edit','close','select'])test('JIS pending PNG canvas callback cannot download after '+change,()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisSelectSheet('plan',2);r.ctx.jisDownloadPng();r.images[0].onload();assert.equal(r.pngCallbacks.length,1);
 if(change==='switch')r.switchPlan();if(change==='edit')r.ctx.DATA.walls[0].x2=3000;if(change==='close')r.ctx.closeJisDrawingDialog();if(change==='select')r.ctx.jisSelectSheet('plan',1);
 r.pngCallbacks[0](new Blob(['anonymous PNG']));assert.equal(r.downloads.length,0);assert.equal(r.ctx.JIS_PNG_JOBS.size,0);
});
test('JIS PNG keeps its source sheet filename and current snapshot on successful export',()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisSelectSheet('plan',2);r.ctx.jisDownloadPng();r.images[0].onload();r.pngCallbacks[0](new Blob(['anonymous PNG']));
 assert.match(r.downloads[0].filename,/^jis-plan2f-\d{8}\.png$/);assert.equal(r.ctx.JIS_PNG_JOBS.size,0);
});
test('JIS delayed font/timeout print cannot start after close, switch or a newer print',async()=>{
 for(const change of ['close','switch','edit','newer']){
  const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisPrint();const old=r.iframes[0];old.onload();
  if(change==='close')r.ctx.closeJisDrawingDialog();if(change==='switch')r.switchPlan();if(change==='edit')r.ctx.DATA.walls[0].x2=3000;if(change==='newer')r.ctx.jisPrint();
  old.resolveFonts();await tick();for(const timer of r.timers)timer();assert.equal(old.printCount||0,0);assert.equal(old.parentNode,null);
 }
});
test('JIS successful print remains single-shot and active print document is retained on dialog close',async()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisPrint();const iframe=r.iframes[0];iframe.onload();iframe.resolveFonts();await tick();r.ctx.closeJisDrawingDialog();
 assert.equal(iframe.printCount,1);assert.ok(iframe.parentNode);r.timers[0]();assert.equal(iframe.printCount,1);iframe.contentWindow.onafterprint();assert.equal(iframe.parentNode,null);
});
function withPane(r){
 const c=r.ctx,noop=()=>{};Object.assign(c,{EDITOR_PANE:'anonymous-pane',comparisonCatalogueReady:Promise.resolve(),_jsonImportRequest:0,DRAG:{},HISTORY:[],REDO_HISTORY:[],DIRTY:false,
  WALL_H:2400,nextId:2,_defaultPlanPending:false,WALK:{active:false},camExt:null,orbit:null,ren:null,sc3:null,composer:null,_pmremGen:null,_envRT:null,_modelCache:{},_texCache:{},
  parent:{ParallelEditors:{activeId:null,modelPool:{resources:new Set()}}},addEventListener:noop,removeEventListener:noop,render3DNow:noop,
  stageJsonImport:text=>({data:JSON.parse(text)}),applyJsonImport(staged,options){c.installOptions=options;c.DATA=staged.data;},
  toggleGrid(){c.ST.showGrid=!c.ST.showGrid;},toggleDim(){c.ST.showDim=!c.ST.showDim;},draw2d:noop,rebuild3D:noop,syncNorthUi:noop,syncHeightDefaultsUI:noop,updateProps:noop,renderSaveButtonState:noop,invalidate3D:noop,resetView:noop,
  clearDirty(){c.DIRTY=false;},AssetPackPicker:{getSelection:()=>null,setSelection(value){if(value==='fail')throw Error('anonymous restoration failure');}},
  serializeDataSnapshot:()=>JSON.stringify(c.DATA)});
 vm.runInContext(fs.readFileSync('assets/js/parallel-editors.js','utf8'),c);
}
test('EditorPane failed install retains completed outputs, source, inputs and original DATA; successful install resets them',async()=>{
 const r=runtime(),image=await r.ctx.generateAiRenderPackage(),old=r.ctx.DATA;r.ctx.openJisDrawingDialog();r.el('video-render-note').value='keep';withPane(r);
 await assert.rejects(r.ctx.EditorPane.install(syntheticPlan('B'),{cataloguePack:'fail'}),/restoration failure/);
 assert.equal(r.ctx.DATA,old);assert.equal(r.ctx.AI_RENDER_PACKAGE,image);assert.ok(r.ctx.isNativeOutputPackageCurrent(image));assert.equal(r.ctx.JIS_UI.sheet.key,1);assert.equal(r.el('video-render-note').value,'keep');
 assert.equal(r.ctx.installOptions.deferNativeOutputReset,true);assert.equal(await r.ctx.EditorPane.install(syntheticPlan('B')),true);assert.equal(r.ctx.AI_RENDER_PACKAGE,null);assert.equal(r.ctx.JIS_UI.sheet,null);
});
test('pane disposal cancels native asynchronous output and clears completed URL bags once',async()=>{
 const r=runtime(),gate=r.pause('edge'),pending=r.ctx.generateAiRenderPackage();await waitForGate(gate,pending);withPane(r);const epoch=r.ctx.NATIVE_OUTPUT_REQUESTS.epoch;
 r.ctx.EditorPane.dispose();r.ctx.EditorPane.dispose();gate.release();assert.equal(await pending,null);assert.equal(r.ctx.NATIVE_OUTPUT_REQUESTS.epoch,epoch+1);assert.equal(r.ctx.AI_RENDER_PACKAGE,null);
});

test('actual native metadata/normalization chain is snapshot-stable for staged normal and admitted legacy plans',async()=>{
 const {appearanceContext,settingsFixture}=require('./legacy-appearance-support.cjs');
 const {memoryIDB}=require('./plan-library-test-support.cjs');
 const Repository=require('../../assets/js/plan-repository-lab.js'),crypto=require('node:crypto').webcrypto;
 const actualNames=['normalizeLegacyFurnitureItems','snapCeilingFixturesToCeiling','snapOutdoorCeilingFixturesToRoof',
  'currentUnityCameraSettings','buildUnityRenderRequest','buildUnityRenderPlan','collectAiMaterialSummary','buildAiRenderMetadata','explicitFloorMetadata'];
 const constantNames=['PLAN_FIX_CEILING_FIXTURES','PLAN_FIX_OUTDOOR_CEILING_FIXTURES','CEILING_FIXTURE_TOP_MM','FLOOR_USE_DEFINITIONS'];
 const constants=constantNames.map(name=>{const m=html.match(new RegExp('^var '+name+'\\s*=[\\s\\S]+?;','m'));assert.ok(m,name);return m[0];});
 for(const admitted of [false,true]){
  const original=settingsFixture();original.marker='A';original.walls[0].exteriorColor='#abcdef';
  original.exteriorWallSettings.walls[7]={color:null,texture:null,textureFlipX:false,textureFlipY:false,opaque:{retain:[null,false,'anonymous']}};
  let repo,cap,raw,payload=original;
  if(admitted){
   original.items.push({id:91,type:'tv',floor:1,x:100,y:200,w:400,d:300,opaque:{retain:['anonymous legacy item',null,false]}});
   const mem=memoryIDB();global.IDBKeyRange=mem.keyRange;repo=Repository.create({indexedDB:mem.idb,crypto,name:'webcad-plan-library-lab-anonymous-native-output-metadata'});
   raw='  '+JSON.stringify(original)+'\n';const imported=await repo.importSource({sourceId:'anonymous-metadata-source',kind:'plan',raw});
   const review=await repo.prepareLegacyCopy(imported.plans[0].planId);await repo.createLegacyCopy(review,'anonymous-metadata-copy','Anonymous metadata copy','anonymous-metadata-create');
   const loaded=await repo.read('anonymous-metadata-copy');payload=loaded.payload;cap=await repo.admission('anonymous-metadata-copy',payload);
  }else original.walls.forEach((wall,index)=>wall.id=index+1);
  const c=appearanceContext(original);Object.assign(c,{ST:{selected:null,view:'3d-int',floor:1},camExt:null,orbit:null,PlanLibrary:repo?{repo}:null,
   getFmpItem:()=>null,bestFmpType:type=>type,isPlanAnnotationType:()=>false,isContextExteriorItemType:()=>false,
   aiCaptureViewMode:()=>c.ST.view,aiSegmentationLegend:()=>({}),isUnityRenderableView:()=>true});
  vm.runInContext(constants.join('\n')+'\n'+actualNames.map(fn).join('\n'),c);
  c.DATA=c.stageJsonImport(JSON.stringify(payload),cap).data;c.__legacyPlanAdmission=cap||null;
  const before=c.serializeDataSnapshot(),dormant=JSON.stringify(c.DATA.exteriorWallSettings.faces),wallMap=JSON.stringify(c.DATA.exteriorWallSettings.walls);
  const r=runtime();r.ctx.DATA=c.DATA;r.ctx.ST=c.ST;
  // Both extracted contexts represent one editor. Metadata reads must observe
  // the same live camera and transaction as the actual package generator.
  c.camExt=r.ctx.camExt;c.orbit=r.ctx.orbit;c.aiCaptureTarget=()=>c.orbit.target;
  Object.defineProperty(c,'AI_CAPTURE_TRANSACTION',{get:()=>r.ctx.AI_CAPTURE_TRANSACTION});
  r.ctx.buildAiRenderMetadata=function(...args){
   assert.ok(c.AI_CAPTURE_TRANSACTION,'actual metadata reads occur inside the capture transaction');
   assert.equal(c.AI_CAPTURE_TRANSACTION,r.ctx.AI_CAPTURE_TRANSACTION,'metadata observes the same owned transaction');
   assert.equal(c.camExt,c.AI_CAPTURE_TRANSACTION.camera,'metadata describes the captured camera');
   return c.buildAiRenderMetadata(...args);
  };
  const pkg=await r.ctx.generateAiRenderPackage();assert.ok(pkg,r.el('unity-render-status').textContent);
  assert.equal(c.serializeDataSnapshot(),before);assert.equal(pkg._nativeOutputContext.snapshot,before);
  assert.equal(JSON.stringify(c.DATA.exteriorWallSettings.faces),dormant);assert.equal(JSON.stringify(c.DATA.exteriorWallSettings.walls),wallMap);
  assert.equal(pkg.metadata.counts.walls,c.DATA.walls.length);assert.ok(pkg.metadata.materials.wallMaterials.length>0);
  assert.equal(pkg.metadata.camera.camX,r.ctx.camExt.position.x);assert.equal(pkg.metadata.camera.camY,r.ctx.camExt.position.y);assert.equal(pkg.metadata.camera.camZ,r.ctx.camExt.position.z);
  const live=c.DATA,selection=live.walls[0],history=['anonymous undo'],redo=['anonymous redo'],light={northDeg:83,hour:10};
  Object.assign(c,{ST:{...c.ST,selected:selection},HISTORY:history,REDO_HISTORY:redo,DIRTY:true,LIGHT_SETTINGS:light,__editorPlanId:'anonymous-source-id'});
  const request=c.buildUnityRenderRequest(before),id=c.nextId;
  request.plan.walls[0].x2=99999;request.plan.exteriorWallSettings.faces['new-detached-face']={color:'#ff0000'};
  assert.equal(c.DATA,live);assert.equal(c.serializeDataSnapshot(),before);assert.equal(c.ST.selected,selection);assert.equal(c.nextId,id);
  assert.equal(c.HISTORY,history);assert.equal(c.REDO_HISTORY,redo);assert.equal(c.DIRTY,true);assert.equal(c.LIGHT_SETTINGS,light);assert.equal(c.__editorPlanId,'anonymous-source-id');
  for(const owner of ['normalizeLegacyFurnitureItems','ensureObjectIds','ensureExteriorWallSettings','ensureInteriorWallSettings','ensureRoofAppearance','syncExteriorWallSettings','buildUnityRenderPlan','currentUnityCameraSettings']){
   const originalOwner=c[owner];c[owner]=()=>{c.DATA.marker='copy mutation before throw';c.nextId=9999;c.ST.selected=null;throw Error('anonymous '+owner);};
   assert.throws(()=>c.buildUnityRenderRequest(before),new RegExp(owner));c[owner]=originalOwner;
   assert.equal(c.DATA,live);assert.equal(c.serializeDataSnapshot(),before);assert.equal(c.ST.selected,selection);assert.equal(c.nextId,id);
   assert.equal(c.HISTORY,history);assert.equal(c.REDO_HISTORY,redo);assert.equal(c.DIRTY,true);assert.equal(c.LIGHT_SETTINGS,light);assert.equal(c.__editorPlanId,'anonymous-source-id');
  }
  assert.throws(()=>c.buildUnityRenderRequest('{'),{name:'SyntaxError'});assert.equal(c.DATA,live);assert.equal(c.ST.selected,selection);
  if(!admitted){
   c.DATA.rooms.push({id:'first-room',floor:1,x:0,y:0,w:2400,d:2400});delete c.DATA.planFixes.ceilingFixtureElev;
   r.ctx.ST=c.ST;const firstRoomSource=c.serializeDataSnapshot(),firstRoom=await r.ctx.generateAiRenderPackage();
   assert.ok(firstRoom,r.el('unity-render-status').textContent);assert.equal(c.serializeDataSnapshot(),firstRoomSource);
   assert.equal(c.DATA.planFixes.ceilingFixtureElev,undefined);assert.equal(firstRoom.metadata.counts.rooms,1);
  }
  if(admitted){assert.equal(c.DATA.items[0].type,'tv');assert.equal((await repo.list('rawSources'))[0].raw,raw);}
 }
});

test('a repeated JIS print leaves the active print document intact until afterprint',async()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisPrint();const active=r.iframes[0];active.onload();active.resolveFonts();await tick();
 r.ctx.jisPrint();assert.equal(r.iframes.length,1);assert.ok(active.parentNode);assert.match(r.el('jis-status').textContent,/前の印刷/);
 active.contentWindow.onafterprint();r.ctx.jisPrint();assert.equal(r.iframes.length,2);
});
test('a failed JIS print releases the pending print document and allows retry',async()=>{
 const r=runtime();r.ctx.openJisDrawingDialog();r.ctx.jisPrint();const failed=r.iframes[0];failed.contentWindow.print=()=>{throw Error('anonymous print failure');};failed.onload();failed.resolveFonts();await tick();
 assert.equal(failed.parentNode,null);assert.equal(r.ctx.JIS_PRINT_IFRAME,null);r.ctx.jisPrint();assert.equal(r.iframes.length,2);
});

test('native 2D auto-switch runs the real wall-material read chain without changing the requested source',async()=>{
 const {appearanceContext,settingsFixture}=require('./legacy-appearance-support.cjs');
 const plan=settingsFixture();plan.marker='A';plan.walls.forEach((wall,index)=>wall.id=index+1);
 const c=appearanceContext(plan);c.DATA=c.stageJsonImport(JSON.stringify(plan)).data;
 const THREE=await import('data:text/javascript;base64,'+fs.readFileSync('assets/vendor/three/build/three.module.js').toString('base64'));
 Object.assign(c,{THREE,getTexture3D:()=>null,makeExteriorLightingMaterial:opts=>new THREE.MeshStandardMaterial(opts),makeInteriorLightingMaterial:opts=>new THREE.MeshStandardMaterial(opts)});
 vm.runInContext(['makeExteriorWallMaterial','makeInteriorWallMaterial','resolveSkirtingForFace'].map(fn).join('\n'),c);
 const r=runtime('2d');r.ctx.DATA=c.DATA;c.ST=r.ctx.ST;r.ctx.isUnityRenderableView=()=>r.ctx.ST.view!=='2d';
 Object.assign(c.DATA.walls[0],{sScale:1,sX:0,sY:0});c.ST.selected=c.DATA.walls[0];
 Object.assign(c,{document:r.ctx.document,isLightItemType:()=>false,getFmpItem:()=>null,ILABELS:{},explicit2DSelection:()=>[c.ST.selected],isPlanAnnotationType:()=>false,
  isMobileLayout:()=>false,selectedLockControlHtml:()=>'',objectIdLabel:item=>item.id,stackOrderControlsHtml:()=>'',wallHeightMm:()=>2400,
  wallFootOffsetMm:()=>0,wallTopSide:()=> 'both',baseFloorSelectHtml:()=>'',floorHasSkipLevel:()=>false,wallFaceCoveredByOtherWalls:()=>false,
  renderFaceRuleControls:()=>'<span>anonymous face controls</span>',selectedModelFinishesHtml:()=>'',selectedDeleteButtonHtml:()=>'',setPropsBodyHtml(body,markup){body.innerHTML=markup;}});
 vm.runInContext(fn('updateProps'),c);
 const source=c.serializeDataSnapshot(),materials=[];
 r.ctx.setView=view=>{r.ctx.ST.view=view;for(const wall of c.DATA.walls){
  for(const face of c.getWallExteriorSpans(wall))materials.push(c.makeExteriorWallMaterial(wall,wall.floor,2.4,face));
  for(const face of c.getWallInteriorFaces(wall)){materials.push(c.makeInteriorWallMaterial(wall,2.4,face));c.resolveSkirtingForFace(wall,face);}
 }c.updateProps();};
 vm.runInContext(fn('ensureAiRenderableView'),r.ctx);
 const pkg=await r.ctx.generateAiRenderPackage();assert.ok(pkg,r.el('unity-render-status').textContent);assert.ok(materials.length>0);
 assert.equal(c.serializeDataSnapshot(),source);assert.equal(pkg._nativeOutputContext.snapshot,source);assert.equal(r.ctx.ST.view,'3d-ext');assert.ok(r.el('props-body').innerHTML.includes('face-card'));
 materials.forEach(material=>material.dispose());
});
test('native rendering face reads keep sparse saved values exact while deliberate face edits remain write-through',()=>{
 const {appearanceContext,settingsFixture}=require('./legacy-appearance-support.cjs');
 const plan=settingsFixture();plan.walls.forEach((wall,index)=>wall.id=index+1);const c=appearanceContext(plan);c.DATA=c.stageJsonImport(JSON.stringify(plan)).data;
 vm.runInContext(['resolveSkirtingForFace','updateExteriorFaceSetting','updateInteriorFaceSetting'].map(fn).join('\n'),c);
 let saves=0;Object.assign(c,{saveState:()=>saves++,updateProps(){},ren:null,renderExteriorWallPanel(){}});
 const wall=c.DATA.walls[0],ext=c.getWallExteriorSpans(wall)[0],int=c.getWallInteriorFaces(wall)[0],before=c.serializeDataSnapshot();
 c.resolveExteriorFaceAppearance(wall,ext);c.resolveInteriorFaceAppearance(wall,int);c.resolveSkirtingForFace(wall,int);assert.equal(c.serializeDataSnapshot(),before);
 c.updateExteriorFaceSetting(wall.id,c.exteriorFaceKey(wall,ext),'color','#123456',false);
 c.updateInteriorFaceSetting(wall.id,c.interiorFaceKey(wall,int),'color','#654321',false);
 assert.equal(c.DATA.exteriorWallSettings.faces[c.exteriorFaceKey(wall,ext)].color,'#123456');
 assert.equal(c.DATA.interiorWallSettings.faces[c.interiorFaceKey(wall,int)].color,'#654321');assert.equal(saves,2);
 assert.deepEqual(JSON.parse(JSON.stringify(c.DATA.exteriorWallSettings.faces.unknown_face_format)),plan.exteriorWallSettings.faces.unknown_face_format);
});
