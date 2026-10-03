// Asset-dependent front metadata must not survive an unaudited model replacement.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const certificate=require('../assets/js/scene-catalogue.js').carCertificate;
const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',certificate.url))).digest('hex');
if(actual!==certificate.sha256)throw Error('Car front certificate no longer matches the active GLB. Re-audit or remove certification before building.');
console.log('Scene asset front certificate verified');
