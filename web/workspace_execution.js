import {T} from './i18n.js';
import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
import {workspaceRequest} from './workspace_transport.js';
import {workspaceRoutingNodes} from './workspace_activation.js';
import {applyExecutionBinding,graphNodeEntries,executionId,executionNode} from './workspace_flow.js';
const graphTasks=new WeakMap();
const link=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]);
function depends(prompt,ref,target,seen=new Set()) {
 if(!link(ref)||seen.has(ref[0]))return false;if(ref[0]===target)return true;seen.add(ref[0]);
 return Object.values(prompt[ref[0]]?.inputs||{}).some(input=>depends(prompt,input,target,seen));
}
export function prepareWorkspacePrompt(options) {
 const graph=app.rootGraph||app.graph;
 const previous=graphTasks.get(graph)||Promise.resolve();
 const task=previous.catch(()=>{}).then(()=>prepareSnapshot(graph,options));graphTasks.set(graph,task);return task;
}
async function prepareSnapshot(graph,{editorNode,samplerNode,compareNode,binding={},getBinding,allowEmpty=false,controller}) {
 if(!editorNode?.adachiEditor?.ready && !allowEmpty)throw Error(T("Upload a source image first"));
 const entries=graphNodeEntries(graph),roots=[editorNode,samplerNode,compareNode];
 if(graph!==(app.rootGraph||app.graph)||roots.some(n=>!entries.some(e=>e.node===n)))throw Error(T("The workflow changed; reopen the workbench"));
 const ids=roots.map(n=>executionId(graph,n)),[editorId,samplerId,compareId]=ids;
 const parents=roots.flatMap(node=>{const path=executionId(graph,node).split(':');return path.slice(0,-1).map((_,i)=>executionNode(graph,path.slice(0,i+1).join(':'))).filter(Boolean);});
 const routers=workspaceRoutingNodes(roots,controller),modes=new Map([...parents,...roots,...routers].map(n=>[n,n.mode]));
 if(editorNode.adachiEditor.ready)editorNode.adachiEditor.flush();let prepared;
 try {
  for(const node of modes.keys())node.mode=0;
  prepared=typeof app.ue_modified_prompt==='function'?await app.ue_modified_prompt():await app.graphToPrompt();
  if(!prepared?.output)throw Error(T("Workflow connections could not be resolved; check bypass states, Get/Set and broadcast connections"));
 } finally {for(const [node,mode]of modes)node.mode=mode;}
 if(graph!==(app.rootGraph||app.graph))throw Error(T("The workflow changed; check connections again"));
 const output=prepared.output,sampler=output[samplerId],compare=output[compareId];
 if(!sampler||!compare||!output[editorId])throw Error(T("The selected image, inpaint or comparison node is missing from the execution graph"));
 // Existing image processors and result postprocessing remain connected. An
 // unconnected workbench can use its explicitly selected inline source/output.
 if(!depends(output,sampler.inputs.image,editorId)){sampler.inputs.image=[editorId,0];sampler.inputs.mask=[editorId,1];}
 else if(!link(sampler.inputs.mask))sampler.inputs.mask=[editorId,1];
 if(!link(compare.inputs.original))compare.inputs.original=[editorId,0];
 if(!depends(output,compare.inputs.result,samplerId))compare.inputs.result=[samplerId,0];
 const resolved=getBinding?await getBinding(output,samplerId):binding;
 const prompt=applyExecutionBinding(output,samplerId,resolved);
 // Keep the editable workflow, including ignored groups and original routers,
 // in PNG metadata. Only the separate API execution graph is specialized.
 const workflow=JSON.parse(JSON.stringify(graph.serialize()));
 return {prompt,compare_id:compareId,client_id:api.clientId||'',extra_data:{extra_pnginfo:{workflow},auth_token_comfy_org:api.authToken,api_key_comfy_org:api.apiKey}};
}
export const validateWorkspace=(prepared,options)=>workspaceRequest(api,'validate',prepared,options);
export const submitWorkspace=prepared=>workspaceRequest(api,'submit',prepared);
