(function(){
const originalFetch=window.fetch.bind(window);
window.fetch=function(input,options){const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return Promise.reject(new Error('ローカル確認: AI・共有・外部通信は接続していません'));return originalFetch(input,options);};
window.WebSocket=function(){throw new Error('ローカル確認: 共有は接続していません');};
window.SCENE_IR_V3_IMAGE_IMPORT=false;
window.addEventListener('DOMContentLoaded',function(){
const offlineNotice='ローカル確認：AI・共同編集・外部APIは利用できません。';
const originalImport=window.openPlanImport;window.openPlanImport=function(){const result=originalImport.apply(this,arguments);const status=document.getElementById('plan-import-status');if(status&&!status.textContent.includes(offlineNotice))status.textContent=offlineNotice+(status.textContent?'\n'+status.textContent:'');return result;};
const importEntry=document.getElementById('plan-import-toolbar-btn');if(importEntry)importEntry.title=offlineNotice;
if(new URLSearchParams(location.search).get('sampleReplay')==='1'){
const status=document.getElementById('plan-import-status'),bar=document.createElement('div');bar.className='unity-render-actions';bar.setAttribute('role','group');bar.setAttribute('aria-label','読み取り済みサンプルのローカル再生');
const b=document.createElement('button');b.className='pbtn sec';b.textContent='読み取り済み3階サンプルを確認';b.onclick=async function(){const body=await(await originalFetch('/local-preview/sample.json')).json();openPlanImport();PlanImport.stageBuildingReview(body);document.getElementById('plan-import-status').textContent='読み取り済みサンプルの再生です。AIは実行していません。各階を確認して部分適用できます。';};bar.append(b);const frozen=document.createElement('button');frozen.className='pbtn sec';frozen.textContent='固定raw 2Fの部分プレビュー（AIなし・未完成）';frozen.onclick=async function(){const response=await originalFetch('/local-preview/frozen-page-2.json'),raw=await response.text(),bytes=new TextEncoder().encode(raw),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!=='c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c')throw new Error('固定rawのhashが一致しません');openPlanImport();PlanImport.stageSceneIR(JSON.parse(raw),{materialization:'bounded-v3',pageScope:['frozen-page-2'],extraction:{rawResponse:raw,rawSha256:hash,kind:'local-readonly-frozen-replay',paidCalls:0}});document.getElementById('plan-import-status').textContent='固定rawの再生です。AIなし。候補・表示仮定を確認し、未配置部分を保持する新しい案で試してください。';};bar.append(frozen);const a=document.createElement('a');a.href='/tools/tests/fixtures/madori-3f.pdf';a.target='_blank';a.textContent=' 元図面PDF';bar.append(a);
if(status)status.after(bar);
}
for(const [name,id,statusId] of [['openShareDialog','share-create-btn','share-status'],['openUnityRenderModal','ai-render-run','unity-render-status'],['openVideoRenderDialog','video-render-run','video-render-status']]){const original=window[name];window[name]=function(){const result=original.apply(this,arguments),run=document.getElementById(id);if(run){run.disabled=true;run.title='ローカル確認ではAI生成・共有接続を実行しません';}const status=document.getElementById(statusId);if(status&&!status.textContent.includes(offlineNotice))status.textContent=offlineNotice+(status.textContent?'\n'+status.textContent:'');return result;};}
for(const id of ['plan-import-file','plan-import-run','share-create-btn','ai-render-run','video-render-run']){const e=document.getElementById(id);if(e){e.disabled=true;e.title='ローカル確認ではAI生成・共有接続を実行しません';}}
});
})();
