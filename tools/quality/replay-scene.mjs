// Dry-run an untouched Scene IR v3 output in a chosen checkout. No Apply or provider calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(!args.includes('--repo')||!args.includes('--input'))throw Error('Usage: node tools/quality/replay-scene.mjs --repo CHECKOUT --input SCENE.json');
const repo=path.resolve(value('--repo')),bytes=fs.readFileSync(path.resolve(value('--input'))),raw=JSON.parse(bytes);
const scene=raw.sceneVersion===3?raw:raw.sceneIR;
if(!scene||scene.sceneVersion!==3)throw Error('Expected declared Scene IR v3; no implicit fallback/repair.');
const require=createRequire(path.join(repo,'package.json')),{runtime}=require(path.join(repo,'tools/tests/scene-fixtures.cjs'));
const c=runtime(),before=JSON.stringify(scene),compiled=c.PlanImport.previewSceneIR(scene,{});
if(JSON.stringify(scene)!==before)throw Error('Source scene changed');
console.log(JSON.stringify({kind:'offline-v3-preview-replay',checkout:repo,inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),providerCalls:0,applied:false,sourceAccuracyVerified:false,sourceScene:scene,compiled,notes:['Same renderer catalogue and existing compiler are exercised with no automatic approvals','canApply/valid are contract/review states, not source reconstruction accuracy scores','Incomplete preview geometry is not an applied or complete building','Actual WebGL appearance, performance and source/PDF accuracy require independent verification']},null,2));
