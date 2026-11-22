import assert from "node:assert/strict";
import {uploadImageWithProgress} from "../web/upload_transport.js";

// The transport now uses ComfyUI's authenticated fetchApi channel. These tests
// exercise byte progress, the multi-user header, auth fallback, server errors,
// inactivity timeouts and cancellation against that channel.

function streamingApi({status=200, name="test.png", onSend}={}) {
  let calls=0, lastOptions=null;
  return {
    user: "alice",
    get calls(){return calls;},
    get lastOptions(){return lastOptions;},
    async fetchApi(path, options) {
      calls++; lastOptions=options;
      assert.equal(path, "/upload/image");
      assert.equal(options.method, "POST");
      // Drain the streamed body so byte progress is observable.
      let received=0;
      if (options.body && typeof options.body.getReader === "function") {
        const reader=options.body.getReader();
        while (true) {
          const {done,value}=await reader.read();
          if (done) break;
          received+=value.byteLength;
        }
      }
      onSend?.(received);
      return {ok:status>=200&&status<300, status, json:async()=>({name})};
    },
  };
}

const body = new FormData();
body.append("image", new Blob([new Uint8Array(100)]), "test.png");

// 1. Successful upload reports real byte progress and the multi-user header.
{
  let phases=[], received=0;
  const api=streamingApi({onSend:r=>received=r});
  const result=await uploadImageWithProgress(api, body, e=>phases.push(e));
  assert.deepEqual(result, {name:"test.png"});
  assert.equal(api.lastOptions.headers["Comfy-User"], "alice");
  assert.ok(received>0, "the streamed body carried real bytes");
  assert.ok(phases.some(p=>p.phase==="upload"&&p.total>0&&p.loaded===p.total), "byte progress reached 100%");
  assert.equal(phases.at(-1).phase, "processing");
  assert.equal(api.calls, 1, "no fallback on success");
}

// 2. A 401 triggers one authenticated retry through the same API.
{
  let phases=[], calls=0;
  const api={
    user:"alice",
    async fetchApi(path, options){
      calls++;
      if (options.body && typeof options.body.getReader==="function") {
        const r=options.body.getReader(); while(!(await r.read()).done){}
      }
      return calls===1
        ? {ok:false, status:401, json:async()=>({})}
        : {ok:true, status:200, json:async()=>({name:"fallback.png"})};
    },
  };
  const result=await uploadImageWithProgress(api, body, e=>phases.push(e));
  assert.deepEqual(result, {name:"fallback.png"});
  assert.equal(calls, 2);
  assert.equal(phases.at(-2).phase, "authenticated");
  assert.equal(phases.at(-1).phase, "processing");
}

// 3. Server errors surface with the status code.
{
  const api=streamingApi({status:500});
  await assert.rejects(uploadImageWithProgress(api, body), /500/);
}
console.log("Upload transport: byte progress, multi-user header, auth fallback and server error passed");

// 4. Inactivity timeout: a stalled fetchApi is aborted and reports a timeout.
{
  const api={
    user:"alice",
    fetchApi:(_path,options)=>options.signal.aborted?Promise.reject(new DOMException("Aborted","AbortError")):new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})),
  };
  await assert.rejects(uploadImageWithProgress(api, body, null, {idleMs:20}), /timed out/);
}

// 5. External cancellation propagates as AbortError.
{
  const api={
    user:"alice",
    fetchApi:(_path,options)=>options.signal.aborted?Promise.reject(new DOMException("Aborted","AbortError")):new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})),
  };
  const cancel=new AbortController();
  const pending=uploadImageWithProgress(api, body, null, {signal:cancel.signal});
  cancel.abort();
  await assert.rejects(pending, {name:"AbortError"});
}

// 6. A slow but advancing stream still completes within a generous idle budget.
{
  const api={
    user:"alice",
    async fetchApi(_path,options){
      const r=options.body.getReader();
      while (true) { const {done}=await r.read(); if (done) break; await new Promise(res=>setTimeout(res,2)); }
      return {ok:true, status:200, json:async()=>({name:"slow.png"})};
    },
  };
  assert.equal((await uploadImageWithProgress(api, body, null, {idleMs:50})).name, "slow.png");
}
console.log("Upload transport: inactivity timeout, cancellation and slow advancing uploads pass");

// 7. The authenticated fallback also has a cancellation deadline.
{
  let fallbackSignal;
  const api={
    user:"alice",
    async fetchApi(_path,options){
      if (options.body && typeof options.body.getReader==="function") {
        const r=options.body.getReader(); while(!(await r.read()).done){}
        return {ok:false, status:403, json:async()=>({})};
      }
      fallbackSignal=options.signal;
      if(options.signal.aborted)return Promise.reject(new DOMException("Aborted","AbortError"));
      return new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
    },
  };
  await assert.rejects(uploadImageWithProgress(api, body, null, {idleMs:20}), /timed out/);
  assert.equal(fallbackSignal.aborted, true, "the authenticated fallback also has a cancellation deadline");
}