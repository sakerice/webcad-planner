const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),start=html.indexOf('function disposeMat('),end=html.indexOf('\nvar composer',start);const ctx={Set};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
test('owned ground normal maps are released once, shared model maps remain alive',()=>{
 let ownedCount=0,sharedCount=0,matCount=0;
 const owned={dispose(){ownedCount++;}},shared={dispose(){sharedCount++;}};
 const mat={dispose(){matCount++;},normalMap:owned,userData:{ownedAuxiliaryTextures:[owned,owned]}};
 const seen=new Set();ctx.disposeMat(mat,seen);ctx.disposeMat(mat,seen);
 assert.equal(ownedCount,1);assert.equal(matCount,1);
 ctx.disposeMat({dispose(){},normalMap:shared});assert.equal(sharedCount,0);
});
