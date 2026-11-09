import assert from 'node:assert/strict';
import {readPreview} from '../web/preview_transport.js';
const bytes=new TextEncoder().encode('image-bytes');
const events=[];
const blob=await readPreview(async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,3));c.enqueue(bytes.slice(3));c.close();}}),{headers:{'content-length':String(bytes.length),'content-type':'image/png'}}),'/preview',{onProgress:e=>events.push(e)});
assert.equal(await blob.text(),'image-bytes');assert.equal(events[1].loaded,3);assert.equal(events[1].total,bytes.length);assert.equal(events.at(-1).complete,true);
const unknown=[];await readPreview(async()=>new Response(bytes),'/preview',{onProgress:e=>unknown.push(e)});assert.equal(unknown[0].total,0);assert.equal(unknown.at(-1).loaded,bytes.length);
await assert.rejects(readPreview(async()=>new Response(bytes,{headers:{'content-length':'99'}}),'/truncated'),/interrupted/);
await assert.rejects(readPreview(async()=>new Response(bytes,{status:404}),'/expired'),e=>e.status===404);
await assert.rejects(readPreview(async()=>new Response(bytes),'/too-large',{maxBytes:3}),/size limit/);
const cancel=new AbortController();
const stalled=(_,options)=>Promise.resolve(new Response(new ReadableStream({start(c){options.signal.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}})));
await assert.rejects(readPreview(stalled,'/stalled',{idleMs:10}),/timed out/);
const pending=readPreview(stalled,'/cancel',{signal:cancel.signal});cancel.abort();await assert.rejects(pending,e=>e.name==='AbortError');
// A long transfer is allowed while actual data continues to arrive.
let ticks=0;await readPreview(async(_,options)=>new Response(new ReadableStream({start(c){const t=setInterval(()=>{if(++ticks===5){clearInterval(t);c.close();}else c.enqueue(bytes);},5);options.signal.addEventListener('abort',()=>{clearInterval(t);c.error(Error('timed out'));});}})),'/slow',{idleMs:20});assert.equal(ticks,5);
console.log('Preview transport: streamed byte progress, unknown length, truncation, expiry, size limit, inactivity timeout, cancellation and slow advancing transfer pass');
