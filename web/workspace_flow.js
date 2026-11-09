import {T} from './i18n.js';
const link=value=>Array.isArray(value) && value.length===2 && ['string','number'].includes(typeof value[0]) && Number.isInteger(value[1]);
const asRef=value=>link(value)?[String(value[0]),value[1]]:null;
const loraTypes=new Set(['LoraLoader','LoraLoaderModelOnly','Power Lora Loader (rgthree)']);
const staticRouter=api=>api.class_type==='AdachiExclusiveSwitch'||(['ComfySwitchNode','ComfySoftSwitchNode'].includes(api.class_type)&&typeof api.inputs?.switch==='boolean');
const loaderTypes={MODEL:new Set(['CheckpointLoaderSimple','CheckpointLoader','UNETLoader','UNETLoaderGGUF','CheckpointLoaderNF4']),
    CLIP:new Set(['CheckpointLoaderSimple','CheckpointLoader','CLIPLoader','DualCLIPLoader','TripleCLIPLoader','CLIPLoaderGGUF','DualCLIPLoaderGGUF']),
    VAE:new Set(['CheckpointLoaderSimple','CheckpointLoader','VAELoader'])};

function sourceInputs(api) {
    if(['ComfySwitchNode','ComfySoftSwitchNode'].includes(api.class_type)&&typeof api.inputs?.switch==='boolean'){
        const inputs=api.inputs;if(api.class_type==='ComfySoftSwitchNode'){
            if(!Object.hasOwn(inputs,'on_false'))return [inputs.on_true];if(!Object.hasOwn(inputs,'on_true'))return [inputs.on_false];
        }
        return [inputs[inputs.switch?'on_true':'on_false']];
    }
    if(api.class_type==='AdachiExclusiveSwitch') {
        const mask=Number(api.inputs?.active_inputs);
        if(mask===1)return [api.inputs.input_a];if(mask===2)return [api.inputs.input_b];
    }
    return Object.values(api.inputs||{});
}
function ancestors(prompt,refs) {
    const found=new Set(),queue=refs.map(asRef).filter(Boolean);
    while(queue.length){const [id]=queue.pop();if(found.has(id)||!prompt[id])continue;found.add(id);queue.push(...sourceInputs(prompt[id]).map(asRef).filter(Boolean));}
    return found;
}
function origins(prompt,start,type,lookup) {
    const found=[],seen=new Set(),queue=[asRef(start)].filter(Boolean);
    while(queue.length){const [id,slot]=queue.shift(),key=`${id}:${slot}`;if(seen.has(key))continue;seen.add(key);
        const api=prompt[id],node=lookup(id);if(!api)continue;
        if(loaderTypes[type].has(api.class_type)){found.push({id,node,api});continue;}
        if(staticRouter(api)){queue.push(...sourceInputs(api).map(asRef).filter(Boolean));continue;}
        if(loraTypes.has(api.class_type)){const ref=asRef(api.inputs?.[type==='MODEL'?'model':type==='CLIP'?'clip':'vae']);if(ref)queue.push(ref);continue;}
        const typed=(node?.inputs||[]).filter(i=>i.type===type).map(i=>i.name);
        const names=typed.length?typed:Object.keys(api.inputs||{}).filter(name=>new RegExp(`^${type.toLowerCase()}(?:$|[_\\d])`,'i').test(name));
        queue.push(...names.map(name=>asRef(api.inputs[name])).filter(Boolean));
    }
    return found.filter((item,i,all)=>all.findIndex(x=>x.id===item.id)===i);
}
function encoders(prompt,start,lookup) {
    const found=[],seen=new Set(),queue=[asRef(start)].filter(Boolean);
    while(queue.length){const [id,slot]=queue.shift(),key=`${id}:${slot}`;if(seen.has(key))continue;seen.add(key);
        const api=prompt[id],node=lookup(id);if(!api)continue;
        const fields=(node?.widgets||[]).filter(w=>/^(text(?:_[gl])?|prompt)$/i.test(w.name) && typeof w.value==='string').map(w=>w.name);
        const output=node?.outputs?.[slot];
        if(fields.length && (output?.type==='CONDITIONING'||/^CLIPTextEncode/.test(api.class_type))){found.push({id,node,api,fields});continue;}
        if(staticRouter(api)){queue.push(...sourceInputs(api).map(asRef).filter(Boolean));continue;}
        const selected=output?.name && /^(positive|negative)$/i.test(output.name) && asRef(api.inputs?.[output.name]);
        if(selected){queue.push(selected);continue;}
        const names=(node?.inputs||[]).filter(i=>i.type==='CONDITIONING').map(i=>i.name);
        const fallback=Object.keys(api.inputs||{}).filter(name=>/^(positive|negative|conditioning(?:_\d+)?)$/i.test(name));
        queue.push(...(names.length?names:fallback).map(name=>asRef(api.inputs[name])).filter(Boolean));
    }
    return found.filter((item,i,all)=>all.findIndex(x=>x.id===item.id)===i);
}

export function inspectExecutionFlow(prompt,samplerId,lookup=()=>null) {
    const api=prompt[String(samplerId)],refs={};
    for(const name of ['model','positive','negative','vae'])refs[name]=asRef(api?.inputs?.[name]);
    const positive=encoders(prompt,refs.positive,lookup),negative=encoders(prompt,refs.negative,lookup);
    const allEncoders=[...positive,...negative].filter((item,i,all)=>all.findIndex(x=>x.id===item.id)===i);
    const consumers=allEncoders.filter(e=>asRef(e.api.inputs?.clip)).map(e=>({id:e.id,input:'clip'}));
    const clipNodes=consumers.flatMap(e=>origins(prompt,prompt[e.id].inputs[e.input],'CLIP',lookup)).filter((e,i,all)=>all.findIndex(x=>x.id===e.id)===i);
    return {refs,modelNodes:origins(prompt,refs.model,'MODEL',lookup),clipNodes,
        vaeNodes:origins(prompt,refs.vae,'VAE',lookup),encoders:{positive,negative},clipConsumers:consumers,
        loras:[...ancestors(prompt,Object.values(refs))].filter(id=>loraTypes.has(prompt[id].class_type)).map(id=>({id,node:lookup(id),api:prompt[id]}))};
}

export function executionNode(graph,id) {
    const path=String(id).split(':');let node;
    for(let i=0;i<path.length;i++){node=graph?.getNodeById(path[i]);if(!node && /^-?\d+$/.test(path[i]))node=graph?.getNodeById(Number(path[i]));if(!node)return null;if(i<path.length-1)graph=node.subgraph;}
    return node;
}

export function graphNodeEntries(graph,prefix=[],seen=new Set()) {
    if(!graph || seen.has(graph))return [];seen.add(graph);
    return Array.from(graph._nodes||[]).flatMap(node=>{
        const path=[...prefix,String(node.id)];
        return [{id:path.join(':'),node,graph},...graphNodeEntries(node.subgraph,path,seen)];
    });
}
export const executionId=(graph,node)=>graphNodeEntries(graph).find(entry=>entry.node===node)?.id;

// Rewrite only the chosen sampler's ancestry. Other output branches keep their
// graph definitions; the backend subsequently queues only the comparison target.
export function applyExecutionBinding(original,samplerId,binding={}) {
    // Native widget values can be Vue proxies (for example rgthree LoRA
    // rows). Copy using the same JSON boundary as ComfyUI's queue request.
    const prompt=JSON.parse(JSON.stringify(original)),id=String(samplerId),sampler=prompt[id];
    if(!sampler)throw Error(T("The selected inpaint node is missing from the execution graph"));
    Object.assign(sampler.inputs,binding.samplerInputs||{});
    for(const [key,inputs] of Object.entries(binding.inputOverrides||{})){
        if(!prompt[key])throw Error(T("The selected parameter node is missing from the execution graph #{id}",{id:key}));Object.assign(prompt[key].inputs,inputs);
    }
    for(const [key,names] of Object.entries(binding.removeInputs||{}))for(const name of names)if(prompt[key])delete prompt[key].inputs[name];
    const scope=()=>new Set([id,...ancestors(prompt,Object.values(sampler.inputs))]);
    const collapse=(candidates,choose)=>{
        const resolve=(value,seen=new Set())=>{
            const ref=asRef(value);if(!ref || !candidates.has(ref[0]))return ref;
            if(seen.has(ref[0]))return null;seen=new Set(seen);seen.add(ref[0]);
            const next=choose(prompt[ref[0]],ref[1]);return next?resolve(next,seen):null;
        };
        for(const key of scope())if(!candidates.has(key))for(const [name,value] of Object.entries(prompt[key]?.inputs||{})){
            const ref=asRef(value);if(ref && candidates.has(ref[0])){const result=resolve(ref);if(result && prompt[result[0]])prompt[key].inputs[name]=result;}
        }
    };
    const switches=new Set([...scope()].filter(key=>prompt[key]?.class_type==='AdachiExclusiveSwitch' && [1,2].includes(Number(prompt[key].inputs.active_inputs))));
    collapse(switches,(api,slot)=>slot===0?api.inputs[Number(api.inputs.active_inputs)===1?'input_a':'input_b']:null);
    if(binding.loraMode==='override') {
        const loras=new Set([...scope()].filter(key=>loraTypes.has(prompt[key]?.class_type)));
        collapse(loras,(api,slot)=>slot===0?api.inputs.model:slot===1?api.inputs.clip:null);
        const selected=(binding.loras||[]).filter(l=>l.name && l.on!==false);
        if(selected.length){
            const baseModel=asRef(sampler.inputs.model);if(!baseModel)throw Error(T("Connect a main model before adding LoRAs"));
            let nextId=-1000000;
            const fresh=()=>{while(prompt[String(nextId)])nextId--;return String(nextId--);};
            const consumers=(binding.clipConsumers||[]).filter(c=>asRef(prompt[c.id]?.inputs?.[c.input]));
            const unique=new Map();for(const c of consumers){const ref=asRef(prompt[c.id].inputs[c.input]),key=JSON.stringify(ref);if(!unique.has(key))unique.set(key,{ref,consumers:[]});unique.get(key).consumers.push(c);}
            const chains=unique.size?[...unique.values()]:[{ref:null,consumers:[]}];
            chains.forEach((chain,index)=>{
                let model=baseModel,clip=chain.ref;
                for(const l of selected){const key=fresh(),inputs={model,lora_name:l.name,strength_model:Number(l.strength??1)};
                    if(clip)Object.assign(inputs,{clip,strength_clip:Number(l.clipStrength??l.strength??1)});
                    prompt[key]={class_type:clip?'LoraLoader':'LoraLoaderModelOnly',inputs};model=[key,0];if(clip)clip=[key,1];
                }
                if(index===0)sampler.inputs.model=model;
                for(const c of chain.consumers)prompt[c.id].inputs[c.input]=clip;
            });
        }
    }
    return prompt;
}
