import assert from 'node:assert/strict';
import {workspaceRequest} from '../web/workspace_transport.js';
let posts=0;const reply=(status,data)=>({status,ok:status<300,json:async()=>data});
await assert.rejects(workspaceRequest({fetchApi:async(p,o)=>{if(o.method)posts++;return reply(405,{});}},'submit',{}),/后端尚未加载/);assert.equal(posts,0);
const seen=[];
const api={fetchApi:async(p,o)=>{seen.push(p);if(p==='/adachi-inpaint/workspace/capabilities')return reply(404,{});if(p.endsWith('/capabilities'))return reply(200,{api_version:1,can_validate:true});return reply(200,{valid:true});}};
assert.equal((await workspaceRequest(api,'validate',{})).valid,true);assert.equal(seen.at(-1),'/api/adachi-inpaint/workspace/validate');
await assert.rejects(workspaceRequest({fetchApi:async(p)=>p.endsWith('/capabilities')?reply(200,{api_version:1,can_validate:true}):reply(400,{valid:false,error:{message:'bad model'}})},'submit',{}),/bad model/);
console.log('Workspace transport: missing backend blocks submission, /api proxy fallback and validation errors pass');
