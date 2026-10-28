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
