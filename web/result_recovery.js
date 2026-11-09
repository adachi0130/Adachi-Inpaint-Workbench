// Execution notifications are an optimization, not the sole delivery channel.
// Poll only IDs queued by this browser; never guess from another workflow's
// latest history entry or from a coincidentally matching node ID.
import {executionNode,graphNodeEntries} from './workspace_flow.js';
export class ResultRecovery {
    constructor({fetchApi,getGraph,onOutput,onPending=()=>{},onTerminal=()=>{},interval=2500}) {
        Object.assign(this,{fetchApi,getGraph,onOutput,onPending,onTerminal,interval});
        this.pending=new Map();this.delivered=new Set();
    }
    track(graph,promptId,nodeId) {
        const node=executionNode(graph,nodeId),key=`${promptId}:${nodeId}`;
        if(!promptId || node?.type!=='AdachiImageCompare' || this.delivered.has(key) || this.pending.has(key))return;
        this.pending.set(key,{graph,node,promptId,nodeId:String(nodeId),key});
        this.onPending(node);this.schedule(0);
    }
    schedule(ms=this.interval) {clearTimeout(this.timer);if(this.pending.size)this.timer=setTimeout(()=>this.recover(),ms);}
    async recover() {
        if(this.busy)return;this.busy=true;clearTimeout(this.timer);
        const groups=new Map();
        for(const record of this.pending.values()) {
            if(record.graph!==this.getGraph() || executionNode(record.graph,record.nodeId)!==record.node){this.pending.delete(record.key);continue;}
            const records=groups.get(record.promptId)||[];records.push(record);groups.set(record.promptId,records);
        }
        try {
            for(const [promptId,records] of groups) {
                const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
                try {
                    const response=await this.fetchApi(`/history/${encodeURIComponent(promptId)}`,{cache:'no-store',signal:controller.signal});
                    if(!response.ok)continue;
                    const entry=(await response.json())[promptId];if(!entry)continue;
                    for(const r of records) {
                        if(r.graph!==this.getGraph() || executionNode(r.graph,r.nodeId)!==r.node){this.pending.delete(r.key);continue;}
                        const output=entry.outputs?.[r.nodeId];
                        if(output?.adachi_originals?.length && output?.adachi_results?.length) {
                            await this.onOutput(r.node,output,promptId,entry);
                            this.pending.delete(r.key);this.delivered.add(r.key);
                        } else if(entry.status?.completed) {
                            this.pending.delete(r.key);this.onTerminal(r.node,entry,promptId);
                        }
                    }
                } catch {} finally {clearTimeout(timer);}
            }
        } finally {
            while(this.delivered.size>256)this.delivered.delete(this.delivered.values().next().value);
            this.busy=false;this.schedule();
        }
    }
    destroy(){clearTimeout(this.timer);this.pending.clear();}
}

const installed=new WeakMap();
export function installComparisonRecovery(api,getGraph) {
    if(installed.has(api))return installed.get(api);
    const recovery=new ResultRecovery({fetchApi:api.fetchApi.bind(api),getGraph,
        onPending:node=>{const view=node.adachiCompare;if(view){view.pendingOutputs=(view.pendingOutputs||0)+1;view.updateButton();view.loading(view.options.waitingText||'Waiting for the generated image…');}},
        onOutput(node,output,promptId,entry){
            if(node.adachiCompare)node.adachiCompare.pendingOutputs=Math.max(0,(node.adachiCompare.pendingOutputs||0)-1);
            const known=new Set((node.properties.adachi_compare?.results||[]).map(ref=>JSON.stringify([ref.type,ref.subfolder,ref.filename])));
            if(output.adachi_results.some(ref=>!known.has(JSON.stringify([ref.type,ref.subfolder,ref.filename]))))node.onExecuted?.(output);
            else if(node.adachiCompare?.ready)node.adachiCompare.progressBox.hidden=!(node.adachiCompare.pendingOutputs>0);
            node.adachiCompare?.updateButton();
            document.dispatchEvent(new CustomEvent('adachi-result-recovered',{detail:{node,promptId,entry}}));
        },
        onTerminal(node,entry,promptId){
            const view=node.adachiCompare;if(view){view.pendingOutputs=Math.max(0,(view.pendingOutputs||0)-1);view.updateButton();view.progressBox.hidden=!(view.pendingOutputs>0);view.status(view.options.failedText||'Generation failed; check the ComfyUI task history',true);}
            document.dispatchEvent(new CustomEvent('adachi-result-recovered',{detail:{node,promptId,entry}}));
        },
    });
    const queued=api.queuePrompt;
    api.queuePrompt=async function(...args) {
        const graph=getGraph(),nodes=Object.entries(args[1]?.output||{}).filter(([,n])=>n.class_type==='AdachiImageCompare').map(([id])=>id);
        const result=await queued.apply(this,args);
        for(const id of nodes)recovery.track(graph,result.prompt_id,id);
        return result;
    };
    const wake=()=>{
        recovery.schedule(0);
        for(const {node} of graphNodeEntries(getGraph())) {
            const view=node.adachiCompare;
            if(view && !view.ready && !view.loadingActive && view.results.length)view.loadSelected();
        }
    };
    for(const event of ['reconnected','execution_success','execution_error','execution_interrupted'])api.addEventListener(event,()=>recovery.schedule(0));
    api.addEventListener('reconnected',wake);window.addEventListener('online',wake);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
    installed.set(api,recovery);return recovery;
}
