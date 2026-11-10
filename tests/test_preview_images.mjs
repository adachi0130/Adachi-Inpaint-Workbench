import assert from 'node:assert/strict';
import {decodePreview,loadPreviewPair} from '../web/preview_images.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const blob=new Blob(['PNG']);
let allocated=0;const revoked=[];
const urls={createObjectURL(){return 'blob:'+ ++allocated;},revokeObjectURL:url=>revoked.push(url)};
class ImageStub{width=512;height=512;decode(){return Promise.resolve();}}
const canceled=new AbortController();canceled.abort();
await assert.rejects(decodePreview(blob,canceled.signal,{urls,ImageClass:ImageStub}),{name:'AbortError'});
assert.equal(allocated,0,'already-canceled decoding never allocates a URL');
class Stalled extends ImageStub{decode(){return new Promise(()=>{});}}
await assert.rejects(decodePreview(blob,new AbortController().signal,{urls,ImageClass:Stalled,timeoutMs:5}),/timed out/);
assert.deepEqual(revoked,['blob:1'],'a stalled decode settles and releases the URL');
class Huge extends ImageStub{width=20000;}
await assert.rejects(decodePreview(blob,new AbortController().signal,{urls,ImageClass:Huge}),/dimensions/);
class Borderline extends ImageStub{width=5500;height=6000;}
await assert.rejects(decodePreview(blob,new AbortController().signal,{urls,ImageClass:Borderline}),/dimensions/);
const abort=new AbortController(),decode=decodePreview(blob,abort.signal,{urls,ImageClass:Stalled});abort.abort();
await assert.rejects(decode,{name:'AbortError'});
assert.equal(revoked.length,4);

// A sibling may finish after the first failure, even if an integration ignores
// cancellation. Wait for it and release its late URL before returning.
const later=deferred(),lost=[];let decodes=0;
const pending=loadPreviewPair(['a','b'],{cached:[null,null],signal:new AbortController().signal,
 loadPreview:async()=>blob,decode:async()=>{if(++decodes===1)throw Error('corrupt PNG');return later.promise;},revoke:url=>lost.push(url)});
await new Promise(r=>setTimeout(r,0));later.resolve({url:'late-url'});
await assert.rejects(pending,/corrupt PNG/);assert.deepEqual(lost,['late-url']);

const bad=new Blob(['bad']),good=new Blob(['good']),cache=[bad,good];let reads=0;
const options={cached:cache,signal:new AbortController().signal,loadPreview:async()=>{reads++;return good;},
 decode:async b=>{if(b===bad)throw Error('invalid pixels');return{url:'good-url'};},revoke:()=>{}};
await assert.rejects(loadPreviewPair(['a','b'],options),/invalid pixels/);
assert.equal(cache[0],null,'invalid downloaded bytes cannot poison every future retry');
await loadPreviewPair(['a','b'],options);assert.equal(reads,1,'retry fetches the corrupt half again and keeps the valid half');
console.log('Preview decoding: pre-cancel, decode timeout, dimension limits, late sibling URL cleanup and corrupt-cache recovery pass');
