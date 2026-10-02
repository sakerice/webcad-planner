// Reproducible public extraction packet; no fixture truth or raw extractions are inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),dir=path.join(root,'docs/scene-ir');
const {schema}=require('../assets/js/scene-ir-v3.js');
fs.writeFileSync(path.join(dir,'schema-v3.json'),JSON.stringify(schema,null,2)+'\n');
const files=['schema-v3.json','extraction-prompt-v3.txt','capabilities-v3.json'];
const manifest={contract:'scene-ir-v3-source-preview.1',version:3,routeDefault:'v1',files:Object.fromEntries(files.map(file=>[file,{sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')}]))};
fs.writeFileSync(path.join(dir,'freeze-v3.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
