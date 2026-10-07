/* Production modal markup in the existing structural DOM; no layout acceptance. */
const fs=require('node:fs'),vm=require('node:vm');
const {createReviewDocument,ReviewEvent}=require('./scene-review-dom.cjs');
function parseModal(document,html){
 const start=html.indexOf('<div id="plan-import-modal"'),end=html.indexOf('<div id="unity-render-modal"',start),source=html.slice(start,end).replace(/<!--[\s\S]*?-->/g,'');
 const stack=[document.body],voidTags=new Set(['input','img','br','hr','meta','link']);
 for(const token of source.match(/<[^>]*>|[^<]+/g)||[]){
  if(token.startsWith('</')){const tag=token.slice(2,-1).trim().toLowerCase();if(stack.at(-1).localName!==tag)throw Error('Unbalanced modal '+tag+' / '+stack.at(-1).localName);stack.pop();continue;}
  if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)[1].toLowerCase(),node=document.createElement(tag),tail=token.slice(tag.length+1,-1);
   for(const m of tail.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){const key=m[1],value=m[2]??m[3]??m[4]??'';node.setAttribute(key,value);if(['type','accept','name'].includes(key))node[key]=value;if(key==='value')node.value=value;if(key==='style')for(const part of value.split(';')){const i=part.indexOf(':');if(i>0)node.style[part.slice(0,i).trim()]=part.slice(i+1).trim();}}
   stack.at(-1).appendChild(node);if(!voidTags.has(tag))stack.push(node);
  }else stack.at(-1).appendChild(document.createTextNode(token));
 }
 if(stack.length!==1)throw Error('Unclosed modal '+stack.at(-1).localName);
 return document.getElementById('plan-import-modal');
}
function visibleText(node){
 if(node.hidden||node.style.display==='none'||node.hasAttribute('hidden'))return '';
 if(node.tagName==='SELECT')return (node.options.find(o=>o.value===node.value)||{}).textContent||'';
 if(node.tagName==='DETAILS'&&!node.open)return node.children.filter(c=>c.tagName==='SUMMARY').map(visibleText).join('');
 return node._text+node.childNodes.map(visibleText).join('');
}
function setup(){const {runtime}=require('./scene-fixtures.cjs'),c=runtime();c.document=createReviewDocument();c.Event=ReviewEvent;parseModal(c.document,fs.readFileSync('index.html','utf8'));vm.runInContext(fs.readFileSync('assets/js/scene-review-flow.js','utf8'),c);c.SceneReviewFlow.mount();for(const node of c.document.querySelectorAll('[onclick]'))node.addEventListener('click',event=>{c.__clickNode=node;c.__clickEvent=event;vm.runInContext('(function(event){'+node.getAttribute('onclick')+'}).call(__clickNode,__clickEvent)',c);});return c;}
module.exports={parseModal,visibleText,setup};
