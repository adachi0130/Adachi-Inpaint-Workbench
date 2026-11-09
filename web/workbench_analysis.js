// Read-only discovery for the inpainting workbench. The live graph remains
// authoritative: virtual Get/Set routes and group bypasses are resolved by
// ComfyUI and its installed extensions when a prompt is actually queued.
import {graphNodeEntries,executionNode} from './workspace_flow.js';
export function inspectWorkbench(graph) {
    const nodes = graphNodeEntries(graph).map(entry=>entry.node);
    const find = type => nodes.filter(node => node.type === type);
    const editors = find("AdachiInlineMask");
    const samplers = find("AdachiWebUIInpaint");
    const comparisons = find("AdachiImageCompare");
    const presets = find("AdachiGroupPresets");
    const checkpoints = find("CheckpointLoaderSimple");
    const loras = nodes.filter(node => node.type === "LoraLoader" || node.type === "Power Lora Loader (rgthree)");
    const missing = [];
    if (!editors.length) missing.push("inline_mask");
    if (!samplers.length) missing.push("inpaint");
    if (!comparisons.length) missing.push("compare");
    return { editors, samplers, comparisons, presets, checkpoints, loras, missing };
}

export function upstreamNodes(node,inputName) {
    const found=new Set(),queue=[];
    const addInput=(current,input)=>{const g=current.graph,l=g?.getLink?.(input?.link)??g?.links?.get?.(input?.link)??g?.links?.[input?.link];if(l)queue.push(g.getNodeById(l.origin_id));};
    for(const input of node?.inputs||[])if(!inputName||input.name===inputName)addInput(node,input);
    while(queue.length){const current=queue.shift();if(!current||found.has(current))continue;found.add(current);
        if(current.type==='GetNode'){try{queue.push(current.findSetter?.(current.graph));}catch{}}
        for(const input of current.inputs||[])addInput(current,input);
    }
    return found;
}
export function selectWorkbenchPipeline(graph,preferred,options={}) {
    const nodes=inspectWorkbench(graph),choose=(list,explicit,candidates=[])=>{
        if(explicit&&list.includes(explicit))return {node:explicit,ambiguous:false};
        const pool=candidates.length?candidates:list,active=pool.filter(n=>n.mode===0);
        if(pool.length===1)return {node:pool[0],ambiguous:false};
        if(active.length===1)return {node:active[0],ambiguous:false};
        return {node:active[0]||pool[0],ambiguous:pool.length>1};
    };
    const sampler=choose(nodes.samplers,preferred||options.samplerNode);
    const saved=sampler.node?.properties?.adachi_workspace_connections;
    const editor=choose(nodes.editors,options.editorNode||executionNode(graph,saved?.editorId),nodes.editors.filter(n=>upstreamNodes(sampler.node,'image').has(n)));
    const compare=choose(nodes.comparisons,options.compareNode||executionNode(graph,saved?.compareId),nodes.comparisons.filter(n=>upstreamNodes(n,'result').has(sampler.node)));
    return {...nodes,editor:editor.node,sampler:sampler.node,compare:compare.node,ambiguous:sampler.ambiguous||editor.ambiguous||compare.ambiguous};
}
