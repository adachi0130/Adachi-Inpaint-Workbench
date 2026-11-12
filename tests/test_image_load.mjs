import assert from 'node:assert/strict';
globalThis.location=new URL('https://example.test/app');let calls=[];
globalThis.Image=class {set src(value){this.url=value;if(!value)return;calls.push(value);queueMicrotask(()=>calls.length<3?this.onerror?.():this.onload?.());}};
const {loadImage}=await import('../web/image_load.js');
const image=await loadImage('/view?filename=test.png',{retry:true,delays:[0,0]});assert.equal(calls.length,3);assert.match(image.url,/_adachi_retry=2/);
calls=[];await assert.rejects(loadImage('data:image/png;base64,invalid',{retry:true,delays:[0,0]}));assert.equal(calls.length,1);
calls=[];const c=new AbortController();c.abort();await assert.rejects(loadImage('/view?filename=test.png',{retry:true,signal:c.signal}),{name:'AbortError'});assert.equal(calls.length,0);
console.log('Fresh uploaded image loading: bounded retry, cache bypass, non-network image and cancellation passed');
