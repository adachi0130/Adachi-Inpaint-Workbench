import assert from "node:assert/strict";
import {uploadImageWithProgress} from "../web/upload_transport.js";

let current, status = 200;
globalThis.XMLHttpRequest = class {
  constructor() { current = this; this.upload = {}; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) {
    this.body = body;
    this.upload.onprogress({loaded: 40, total: 100, lengthComputable: true});
    this.upload.onload();
    this.status = status;
    this.responseText = '{"name":"test.png"}';
    this.onload();
  }
};

const body = new FormData();
let fallback = 0, phases = [];
const api = {
  user: "alice",
  apiURL: path => `/cloud/proxy/api${path}`,
  async fetchApi(path, options) {
    fallback++;
    assert.equal(path, "/upload/image"); assert.equal(options.body, body);
    return {ok:true, json:async()=>({name:"fallback.png"})};
  },
};
assert.deepEqual(await uploadImageWithProgress(api, body, event => phases.push(event)), {name:"test.png"});
assert.equal(current.method, "POST");
assert.equal(current.url, "/cloud/proxy/api/upload/image");
assert.equal(current.headers["Comfy-User"], "alice");
assert.deepEqual(phases, [{phase:"upload", loaded:40, total:100}, {phase:"processing"}]);
assert.equal(fallback, 0);

status = 401; phases = [];
assert.deepEqual(await uploadImageWithProgress(api, body, event => phases.push(event)), {name:"fallback.png"});
assert.equal(fallback, 1);
assert.equal(phases.at(-2).phase, "authenticated");
assert.equal(phases.at(-1).phase, "processing");
status = 500;
await assert.rejects(uploadImageWithProgress(api, body), /500/);
console.log("Upload transport: real byte progress, proxy URL, multi-user header, auth fallback and server error passed");
let aborted=0;
globalThis.XMLHttpRequest=class {
 constructor(){this.upload={};}open(){}setRequestHeader(){}send(){}abort(){aborted++;this.onabort?.();}
};
await assert.rejects(uploadImageWithProgress(api,body,null,{idleMs:5}),/timed out/);
assert.equal(aborted,1);
const cancel=new AbortController(),pending=uploadImageWithProgress(api,body,null,{signal:cancel.signal});cancel.abort();
await assert.rejects(pending,{name:'AbortError'});assert.equal(aborted,2);
// Overall duration may exceed the inactivity limit as long as real bytes move.
globalThis.XMLHttpRequest=class {
 constructor(){this.upload={};}open(){}setRequestHeader(){}
 send(){let n=0;this.timer=setInterval(()=>{this.upload.onprogress?.({loaded:++n,total:6,lengthComputable:true});if(n===6){clearInterval(this.timer);this.status=200;this.responseText='{"name":"slow.png"}';this.onload();}},3);}
 abort(){clearInterval(this.timer);this.onabort?.();}
};
assert.equal((await uploadImageWithProgress(api,body,null,{idleMs:12})).name,'slow.png');
console.log('Upload transport: inactivity timeout, cancellation and slow advancing uploads pass');
globalThis.XMLHttpRequest=class {
 constructor(){this.upload={};}open(){}setRequestHeader(){}
 send(){this.status=403;this.onload();}abort(){this.onabort?.();}
};
let fallbackSignal;
const stalledAuth={...api,fetchApi:async(_path,options)=>{fallbackSignal=options.signal;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}};
await assert.rejects(uploadImageWithProgress(stalledAuth,body,null,{idleMs:5}),/timed out/);
assert.equal(fallbackSignal.aborted,true,'the authenticated fallback also has a cancellation deadline');
