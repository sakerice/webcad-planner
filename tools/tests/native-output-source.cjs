// Load the actual native output ownership helpers for isolated app-function tests.
const {appSource}=require('./app-source.cjs');
function nativeOutputContextSource(){
 const html=appSource(),start=html.indexOf('\nvar NATIVE_OUTPUT_REQUESTS='),end=html.indexOf('\nfunction revokeAiRenderDownloadUrls(',start);
 if(start<0||end<0)throw Error('Native output context helpers are missing');
 return html.slice(start+1,end);
}
function nativeCaptureTransactionSource(){
 const html=appSource(),start=html.indexOf('\nfunction getActive3DCamera('),end=html.indexOf('\nfunction aiCaptureBoostedRatio(',start);
 if(start<0||end<0)throw Error('Native capture transaction helpers are missing');
 return html.slice(start+1,end);
}
module.exports={nativeOutputContextSource,nativeCaptureTransactionSource};
