import assert from 'node:assert/strict';
import {ResultRecovery} from '../web/result_recovery.js';
const node={id:3,type:'AdachiImageCompare'},graph={getNodeById:id=>String(id)==='3'?node:null};
let active=graph,calls=0,fail=true,output=[],terminal=[];
const entry={status:{completed:true,status_str:'success'},outputs:{'3':{adachi_originals:[{filename:'a'}],adachi_results:[{filename:'b'}]}}};
const r=new ResultRecovery({getGraph:()=>active,interval:60000,fetchApi:async path=>{calls++;assert.equal(path,'/history/task');if(fail)throw Error('offline');return {ok:true,json:async()=>({task:entry})};},onOutput:(n,o,id)=>output.push({n,o,id}),onTerminal:(...x)=>terminal.push(x)});
try {
 r.track(graph,'task','3');await r.recover();assert.equal(output.length,0);assert.equal(r.pending.size,1,'network failure retains the task even without any WebSocket events');
 fail=false;await r.recover();assert.equal(output.length,1);assert.equal(output[0].n,node);assert.equal(r.pending.size,0);
 r.track(graph,'task','3');await r.recover();assert.equal(output.length,1,'success cannot replay after adoption');
 r.delivered.clear();r.track(graph,'task','3');active={getNodeById:()=>node};await r.recover();assert.equal(output.length,1,'another graph must not receive a result with the same node ID');
 active=graph;r.track(graph,'task','3');graph.getNodeById=()=>({...node});await r.recover();assert.equal(output.length,1,'reconfigured nodes are not the queued node');graph.getNodeById=id=>String(id)==='3'?node:null;
 r.track(graph,'task','3');entry.outputs={};entry.status.status_str='error';await r.recover();assert.equal(terminal.length,1);assert.equal(r.pending.size,0);
 assert.ok(calls>=3);
} finally {r.destroy();}
console.log('Result recovery: lost notifications, offline retries, duplicate delivery, workflow/node replacement and terminal errors pass');
