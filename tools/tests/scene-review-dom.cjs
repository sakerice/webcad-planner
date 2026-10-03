/* Minimal structural DOM for PlanImport review event regressions.
 * It implements browser select/disabled-click semantics and detached nodes; it
 * intentionally has no layout or canvas renderer. Compiler and Apply are real.
 */
class ReviewEvent {
 constructor(type, options={}) { this.type=type; this.bubbles=!!options.bubbles; this.defaultPrevented=false; }
 preventDefault() { this.defaultPrevented=true; }
 stopPropagation() { this.propagationStopped=true; }
}
class ReviewNode {
 constructor(tagName, document, text='') {
  this.nodeType=tagName?1:3; this.tagName=tagName?tagName.toUpperCase():undefined;
  this.localName=tagName; this.ownerDocument=document; this.parentNode=null;
  this.childNodes=[]; this.attributes={}; this.listeners={}; this.style={setProperty(key,value){this[key]=value;}};
  this._text=text; this._value=undefined; this.disabled=false; this.checked=false; this.open=false;
  this.classList={add:(...names)=>{this.className=[...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' ');},
   remove:(...names)=>{this.className=this.className.split(/\s+/).filter(x=>x&&!names.includes(x)).join(' ');},
   contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>{const yes=on===undefined?!this.classList.contains(name):!!on;this.classList[yes?'add':'remove'](name);return yes;}};
  this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase())),set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}});
 }
 get children(){return this.childNodes.filter(n=>n.nodeType===1);}
 get parentElement(){return this.parentNode;}
 get firstChild(){return this.childNodes[0]||null;}
 get lastChild(){return this.childNodes.at(-1)||null;}
 get open(){return this.hasAttribute('open');} set open(v){if(v)this.setAttribute('open','');else this.removeAttribute('open');}
 get isConnected(){return this===this.ownerDocument.body||!!this.parentNode?.isConnected;}
 get id(){return this.getAttribute('id')||'';} set id(v){this.setAttribute('id',v);}
 get className(){return this.getAttribute('class')||'';} set className(v){this.setAttribute('class',v);}
 get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}
 set textContent(v){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this._text=String(v??'');}
 get innerText(){return this.textContent;} set innerText(v){this.textContent=v;}
 set innerHTML(v){if(v!=='')throw Error('Review DOM does not parse HTML; add explicit markup coverage');this.textContent='';}
 get options(){return this.querySelectorAll('option');}
 get value(){
  if(this.tagName==='SELECT')return this._value===undefined?(this.options.find(o=>o.selected)||this.options[0])?.value||'':this._value;
  return this._value===undefined?(this.getAttribute('value')??(this.tagName==='OPTION'?this.textContent:'')):this._value;
 }
 set value(v){v=String(v);this._value=this.tagName==='SELECT'?(this.options.some(o=>o.value===v)?v:''):v;}
 get selectedIndex(){return this.options.findIndex(o=>o.value===this.value);}
 set selectedIndex(v){this.value=this.options[v]?.value||'';}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
 hasAttribute(k){return Object.hasOwn(this.attributes,k);}
 removeAttribute(k){delete this.attributes[k];}
 appendChild(n){n.remove();n.parentNode=this;this.childNodes.push(n);return n;}
 append(...nodes){nodes.forEach(n=>this.appendChild(typeof n==='string'?this.ownerDocument.createTextNode(n):n));}
 removeChild(n){const i=this.childNodes.indexOf(n);if(i<0)throw Error('Not a child');this.childNodes.splice(i,1);n.parentNode=null;return n;}
 replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
 insertBefore(n,before){if(!before)return this.appendChild(n);n.remove();n.parentNode=this;this.childNodes.splice(this.childNodes.indexOf(before),0,n);return n;}
 remove(){if(this.parentNode)this.parentNode.removeChild(this);}
 contains(n){return n===this||this.childNodes.some(child=>child.contains(n));}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
 dispatchEvent(event){
  if(!event.target)event.target=this;event.currentTarget=this;
  if(typeof this['on'+event.type]==='function')this['on'+event.type].call(this,event);
  for(const fn of this.listeners[event.type]||[])fn.call(this,event);
  if(event.bubbles&&!event.propagationStopped&&this.parentNode)this.parentNode.dispatchEvent(event);
  return !event.defaultPrevented;
 }
 click(){if(this.disabled)return;if(this.tagName==='INPUT'&&this.type==='checkbox'){this.checked=!this.checked;this.dispatchEvent(new ReviewEvent('click',{bubbles:true}));this.dispatchEvent(new ReviewEvent('input',{bubbles:true}));this.dispatchEvent(new ReviewEvent('change',{bubbles:true}));}else this.dispatchEvent(new ReviewEvent('click',{bubbles:true}));}
 focus(){this.ownerDocument.activeElement=this;}
 matches(selector){
  const tag=selector.match(/^[a-z][\w-]*/i);if(tag&&this.tagName!==tag[0].toUpperCase())return false;
  const id=selector.match(/#([\w-]+)/);if(id&&this.id!==id[1])return false;
  for(const m of selector.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;
  for(const m of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g))if(m[2]===undefined?!this.hasAttribute(m[1]):this.getAttribute(m[1])!==m[2])return false;
  return this.nodeType===1;
 }
 querySelectorAll(selector){
  const selectors=selector.split(',').map(x=>x.trim()),result=[];
  const visit=n=>{for(const child of n.children){if(selectors.some(s=>child.matches(s)))result.push(child);visit(child);}};visit(this);return result;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){for(let n=this;n;n=n.parentNode)if(n.matches(selector))return n;return null;}
}
function createReviewDocument(){
 const document={createElement(tag){return new ReviewNode(tag.toLowerCase(),document);},createTextNode(text){return new ReviewNode(null,document,String(text));},
  getElementById(id){return document.body.querySelector('#'+id);},querySelector(selector){return document.body.querySelector(selector);},querySelectorAll(selector){return document.body.querySelectorAll(selector);},activeElement:null};
 document.body=document.createElement('body');document.documentElement=document.body;
 return document;
}
module.exports={createReviewDocument,ReviewEvent};
