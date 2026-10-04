// Asset-dependent front metadata must not survive an unaudited model replacement.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalogue=require('../assets/js/scene-catalogue.js');
for(const certificate of [catalogue.carCertificate,catalogue.refrigeratorCertificate,catalogue.cabinetCertificate,catalogue.sideboardCertificate,catalogue.sinkCertificate]){
 const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',certificate.url))).digest('hex');
 if(certificate.sourceYaw!==undefined&&require('../assets/js/model-quality.js').sourceYaw(certificate.url)!==certificate.sourceYaw)throw Error('Scene asset normalization changed; re-audit '+certificate.url);
 if(actual!==certificate.sha256)throw Error('Scene asset front certificate no longer matches '+certificate.url+'. Re-audit or remove certification before building.');
}
console.log('Scene asset front certificate verified');
