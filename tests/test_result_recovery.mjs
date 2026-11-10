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

const nested={id:8,type:'AdachiImageCompare'},child={getNodeById:id=>String(id)==='8'?nested:null},container={id:5,subgraph:child},root={getNodeById:id=>String(id)==='5'?container:null};
let nestedResult;
const sub=new ResultRecovery({getGraph:()=>root,fetchApi:async()=>({ok:true,json:async()=>({nestedTask:{status:{completed:true,status_str:'success'},outputs:{'5:8':{adachi_originals:[{}],adachi_results:[{}]}}}})}),onOutput:n=>{nestedResult=n;}});
try{sub.track(root,'nestedTask','5:8');await sub.recover();assert.equal(nestedResult,nested);}finally{sub.destroy();}
console.log('Result recovery: native subgraph execution IDs resolve to the queued live comparison');
{
 let resolve,signal,discarded=0,delivered=0;
 const pending=new ResultRecovery({getGraph:()=>graph,onOutput:()=>delivered++,onDiscard:()=>discarded++,
  fetchApi:async(_path,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});
 pending.track(graph,'late','3');const task=pending.recover();pending.destroy();
 assert.equal(signal.aborted,true);assert.equal(discarded,1);
 resolve({ok:true,json:async()=>({late:{status:{completed:true},outputs:{'3':{adachi_originals:[{}],adachi_results:[{}]}}}})});
 await task;assert.equal(delivered,0,'destroyed recovery cannot deliver a late response');
 pending.track(graph,'new','3');assert.equal(pending.pending.size,0);assert.equal(pending.controllers.size,0);
}
