// End-to-end browser orchestration + real Worker routes, with a fake hosted
// provider. These tests never invoke fetch against a live external service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fixtures = require('./fixtures/extraction/synthetic.json');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
for (const outcome of ['repaired','still-invalid','quota','network','no-render']) {
  test(`invalid extraction gets at most one repair and never becomes applicable: ${outcome}`,async()=>{
    const {handleAi} = await import('../../worker/routes-ai.mjs');
    const valid={floors:[structuredClone(fixtures[0])]};
    const invalid=structuredClone(valid); invalid.floors[0].rooms[1].parts[0].x0=999;
    const env={OPENAI_API_KEY:'synthetic-test-key-not-a-credential'};
    let providerPosts=0, revisions=0;
    const provider=async req=>{
      if(req.method==='POST') {
        providerPosts++;
        return Response.json({id:'resp_test'+providerPosts,status:'queued'});
      }
      const page=req.url.endsWith('resp_test1') || outcome==='still-invalid' ? invalid : valid;
      return Response.json({status:'completed',output:[{content:[{text:JSON.stringify(page)}]}],usage:{input_tokens:10,output_tokens:20,total_tokens:30}});
    };
    const els=new Map();
    const context={console,Promise,setTimeout,clearTimeout,DATA:{rooms:[{id:'existing'}]},document:undefined};
    context.self=context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('assets/js/plan-import.js','utf8'),context);
    context.document={getElementById:id=>{
      if(id==='plan-import-quota') return null;
      if(!els.has(id)) els.set(id,{style:{},disabled:false,textContent:'',value:'',classList:{add(){},remove(){}}});
      return els.get(id);
    }};
    context.PlanReviewDraw={drawPage:()=>outcome==='no-render'?null:PNG};
    context.fetch=async(path,options)=>{
      if(path==='/api/ai/revise-plan') {
        revisions++;
        assert.equal(context.PlanImport.state.result,null);
        assert.equal(els.get('plan-import-apply').disabled,true);
        if(outcome==='quota') return Response.json({error:'ai_quota_exceeded'},{status:429});
        if(outcome==='network') throw Error('mock disconnect');
      }
      const req=new Request('https://example.test'+path,options);
      const res=await handleAi(req,env,new URL(req.url),{fetchImpl:provider});
      if(path==='/api/ai/plan-result' && JSON.parse(options.body).revised!==true) {
        const body=await res.clone().json();
        assert.equal(res.status,422);
        assert.equal(body.plan,undefined);
        assert.equal(body.revisionCandidate,true);
        assert.equal(body.revise.skipAll,false);
        assert.equal(body.pages.length,1);
      }
      return res;
    };
    context.PlanImport.state.pages=[PNG];
    await context.runPlanImport();
    assert.equal(revisions,outcome==='no-render'?0:1);
    assert.equal(context.PlanImport.state.busy,false);
    assert.equal(JSON.stringify(context.DATA),'\{"rooms":[{"id":"existing"}]}');
    if(outcome==='repaired') {
      assert.ok(context.PlanImport.state.result.plan);
      assert.equal(context.PlanImport.state.result.usage.calls,2);
      assert.equal(els.get('plan-import-apply').disabled,false);
    } else {
      assert.equal(context.PlanImport.state.result,null);
      assert.equal(els.get('plan-import-apply').disabled,true);
    }
    assert.equal(providerPosts,['repaired','still-invalid'].includes(outcome)?2:1);
  });
}
