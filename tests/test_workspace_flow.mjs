import assert from 'node:assert/strict';
import {inspectExecutionFlow, applyExecutionBinding} from '../web/workspace_flow.js';

// Execution IDs, filenames and titles deliberately have no relationship to the
// author's personal workflow. Colon IDs represent nodes inside a subgraph.
function fixture(prefix='graph-a') {
    const ids=Object.fromEntries(['checkpoint','clip','vae','modelLora','negativeLora','modelPatch','clipPatch','positive','positive2','negative','combine','control','controlLoader','image','unusedCheckpoint','unusedEncoder','unusedLora','gate','sampler','compare'].map((k,i)=>[k,`${prefix}-${113+i*17}`]));
    ids.positive2=`${prefix}-instance:937`;
    const prompt={},live=new Map();
    function add(key,type,inputs,outputs=[],fields=[]) {
        const id=ids[key];prompt[id]={class_type:type,inputs};
        live.set(id,{id:id.includes(':')?id.split(':').at(-1):id,type,mode:0,
            outputs:outputs.map((o,i)=>typeof o==='string'?{name:o,type:o}:{...o,slot_index:i}),
            inputs:Object.entries(inputs).map(([name,value])=>({name,type:Array.isArray(value)?'CONDITIONING':'STRING'})),
            widgets:fields.map(name=>({name,value:inputs[name]}))});
    }
    add('checkpoint','CheckpointLoaderSimple',{ckpt_name:'arbitrary-custom-model.safetensors'},['MODEL','CLIP','VAE']);
    add('clip','CLIPLoader',{clip_name:'independent-language-encoder.safetensors'},['CLIP']);
    add('vae','VAELoader',{vae_name:'independent-image-vae.safetensors'},['VAE']);
    add('modelLora','Power Lora Loader (rgthree)',{model:[ids.checkpoint,0],clip:[ids.checkpoint,1],
        lora_1:{on:true,lora:'original-model-style.safetensors',strength:.8,strengthTwo:.4},
        lora_9:{on:false,lora:'original-disabled.safetensors',strength:1}},['MODEL','CLIP']);
    add('negativeLora','LoraLoader',{model:[ids.checkpoint,0],clip:[ids.clip,0],lora_name:'original-negative-style.safetensors',strength_model:.6,strength_clip:.3},['MODEL','CLIP']);
    add('modelPatch','ModelSamplingSD3',{model:[ids.modelLora,0],shift:2.7},['MODEL']);
    add('clipPatch','CLIPSetLastLayer',{clip:[ids.modelLora,1],stop_at_clip_layer:-2},['CLIP']);
    add('positive','CLIPTextEncode',{clip:[ids.clipPatch,0],text:'a quiet city'},['CONDITIONING'],['text']);
    add('positive2','CLIPTextEncodeSDXL',{clip:[ids.clipPatch,0],text_g:'city details',text_l:'architecture',width:1024,height:1024},['CONDITIONING'],['text_g','text_l']);
    add('negative','CLIPTextEncode',{clip:[ids.negativeLora,1],text:'blurry'},['CONDITIONING'],['text']);
    add('combine','ConditioningCombine',{conditioning_1:[ids.positive,0],conditioning_2:[ids.positive2,0]},['CONDITIONING']);
    add('controlLoader','ControlNetLoader',{control_net_name:'edge-control.safetensors'},['CONTROL_NET']);
    add('image','LoadImage',{image:'fixture.png'},['IMAGE','MASK']);
    add('control','ControlNetApplyAdvanced',{positive:[ids.combine,0],negative:[ids.negative,0],control_net:[ids.controlLoader,0],image:[ids.image,0],strength:.7},
        [{name:'positive',type:'CONDITIONING'},{name:'negative',type:'CONDITIONING'}]);
    add('unusedCheckpoint','CheckpointLoaderSimple',{ckpt_name:'a-different-family.safetensors'},['MODEL','CLIP','VAE']);
    add('unusedEncoder','CLIPTextEncode',{clip:[ids.unusedCheckpoint,1],text:'unused prompt'},['CONDITIONING'],['text']);
    add('unusedLora','LoraLoader',{model:[ids.unusedCheckpoint,0],clip:[ids.unusedCheckpoint,1],lora_name:'unrelated.safetensors',strength_model:1,strength_clip:1},['MODEL','CLIP']);
    add('gate','AdachiExclusiveSwitch',{active_inputs:1,input_a:[ids.control,0],input_b:[ids.unusedEncoder,0]},['CONDITIONING']);
    add('sampler','AdachiWebUIInpaint',{model:[ids.modelPatch,0],positive:[ids.gate,0],negative:[ids.control,1],vae:[ids.vae,0],image:[ids.image,0],mask:[ids.image,1],steps:23,cfg:5.5},['IMAGE','IMAGE','MASK']);
    add('compare','AdachiImageCompare',{original:[ids.image,0],result:[ids.sampler,0]},['IMAGE']);
    for(const [id,node] of live)node.inputs=Object.entries(prompt[id].inputs).map(([name,value])=>({name,
        type:Array.isArray(value)?live.get(value[0])?.outputs?.[value[1]]?.type||'*':typeof value==='number'?'FLOAT':'STRING'}));
    return {ids,prompt,lookup:id=>live.get(String(id))||null,live};
}
const sorted=values=>[...values].sort();
const entryIds=entries=>sorted(entries.map(e=>String(e.id)));
const effective=(prompt,ref)=>{
    const seen=new Set();
    while(ref && prompt[ref[0]]?.class_type==='AdachiExclusiveSwitch' && !seen.has(ref[0])) {
        seen.add(ref[0]);const n=prompt[ref[0]],flag=n.inputs.active_inputs;
        if(flag!==1 && flag!==2)break;
        ref=n.inputs[flag===1?'input_a':'input_b'];
    }
    return ref;
};
function loraChain(prompt,initial,field) {
    const rows=[],seen=new Set();let ref=initial;
    while(ref && prompt[ref[0]]?.class_type==='LoraLoader') {
        assert.ok(!seen.has(ref[0]),'temporary LoRA chain cannot contain a cycle');seen.add(ref[0]);
        assert.equal(ref[1],field==='model'?0:1,'model and CLIP must use the correct LoRA output slot');
        const n=prompt[ref[0]];rows.unshift(n.inputs);ref=n.inputs[field];
    }
    return {rows,base:ref};
}
const inherit={loraMode:'inherit',loras:[]};

// Inspection preserves the actual producer and discovers editable components
// behind model/CLIP processing; it does not guess from a preset/model name.
for(const prefix of ['renumbered-12001','completely-different-workflow']) {
    const {ids,prompt,lookup}=fixture(prefix),before=structuredClone(prompt);
    const flow=inspectExecutionFlow(prompt,ids.sampler,lookup);
    assert.deepEqual(flow.refs.model,[ids.modelPatch,0]);
    assert.deepEqual(effective(prompt,flow.refs.positive),[ids.control,0]);
    assert.deepEqual(flow.refs.negative,[ids.control,1]);
    assert.deepEqual(flow.refs.vae,[ids.vae,0]);
    assert.deepEqual(entryIds(flow.modelNodes),[ids.checkpoint]);
    assert.deepEqual(entryIds(flow.clipNodes),sorted([ids.checkpoint,ids.clip]));
    assert.deepEqual(entryIds(flow.vaeNodes),[ids.vae]);
    assert.deepEqual(entryIds(flow.loras),sorted([ids.modelLora,ids.negativeLora]));
    assert.deepEqual(entryIds(flow.encoders.positive),sorted([ids.positive,ids.positive2]));
    assert.deepEqual(entryIds(flow.encoders.negative),[ids.negative]);
    const second=flow.encoders.positive.find(e=>e.id===ids.positive2);
    assert.equal(second.node,lookup(ids.positive2),'execution IDs map back to the actual live subgraph node');
    assert.deepEqual(sorted(second.fields),['text_g','text_l']);
    assert.equal(flow.modelNodes[0].api,prompt[ids.checkpoint]);
    assert.deepEqual(prompt,before,'inspection is read-only');
}

// A checkpoint's unused CLIP/VAE outputs must not displace separately wired
// components merely because that checkpoint supplies the MODEL input.
{
    const {ids,prompt,lookup}=fixture();
    prompt[ids.modelLora].inputs.clip=[ids.clip,0];
    const flow=inspectExecutionFlow(prompt,ids.sampler,lookup);
    assert.deepEqual(entryIds(flow.clipNodes),[ids.clip]);
    assert.deepEqual(entryIds(flow.vaeNodes),[ids.vae]);
}

// Inherited LoRA rows and processing nodes survive switch simplification.
{
    const {ids,prompt}=fixture(),before=structuredClone(prompt);
    const result=applyExecutionBinding(prompt,ids.sampler,inherit);
    assert.notEqual(result,prompt);assert.notEqual(result[ids.sampler].inputs,prompt[ids.sampler].inputs);
    assert.deepEqual(result[ids.sampler].inputs.positive,[ids.control,0]);
    assert.deepEqual(result[ids.sampler].inputs.model,[ids.modelPatch,0]);
    for(const key of ['modelLora','negativeLora','modelPatch','clipPatch','control','combine','unusedCheckpoint','unusedEncoder','unusedLora'])assert.deepEqual(result[ids[key]],before[ids[key]],key+' must keep its original fields');
    assert.deepEqual(prompt,before);
}

// Explicitly disabling LoRAs bypasses both output types inside this sampler's
// dependency chain while retaining model-sampling and conditioning processors.
{
    const {ids,prompt}=fixture(),before=structuredClone(prompt);
    const result=applyExecutionBinding(prompt,ids.sampler,{loraMode:'override',loras:[]});
    assert.deepEqual(result[ids.sampler].inputs.model,[ids.modelPatch,0]);
    assert.deepEqual(result[ids.modelPatch].inputs.model,[ids.checkpoint,0]);
    assert.deepEqual(result[ids.clipPatch].inputs.clip,[ids.checkpoint,1]);
    assert.deepEqual(result[ids.negative].inputs.clip,[ids.clip,0]);
    assert.deepEqual(result[ids.positive].inputs.clip,[ids.clipPatch,0]);
    assert.deepEqual(result[ids.sampler].inputs.positive,[ids.control,0]);
    assert.deepEqual(result[ids.sampler].inputs.negative,[ids.control,1]);
    assert.deepEqual(result[ids.control],before[ids.control]);
    assert.deepEqual(result[ids.unusedLora],before[ids.unusedLora]);
    assert.deepEqual(prompt,before,'LoRA overrides only affect the returned execution copy');
}

// Added LoRAs affect MODEL and each explicitly selected CLIP boundary. Distinct
// positive/negative CLIP sources stay distinct and downstream conditions stay put.
{
    const {ids,prompt}=fixture(),before=structuredClone(prompt);
    const chosen=[{name:'custom-one.safetensors',strength:.7,clipStrength:0,on:true},
        {name:'custom-two.safetensors',strength:1.1,clipStrength:.25,on:true},
        {name:'disabled-row.safetensors',strength:9,on:false}];
    const result=applyExecutionBinding(prompt,ids.sampler,{loraMode:'override',loras:chosen,
        clipConsumers:[{id:ids.clipPatch,input:'clip'},{id:ids.negative,input:'clip'}]});
    const model=loraChain(result,result[ids.sampler].inputs.model,'model');
    assert.deepEqual(model.base,[ids.modelPatch,0]);
    assert.deepEqual(model.rows.map(r=>r.lora_name),chosen.slice(0,2).map(r=>r.name));
    assert.deepEqual(model.rows.map(r=>r.strength_model),[.7,1.1]);
    const positive=loraChain(result,result[ids.clipPatch].inputs.clip,'clip');
    const negative=loraChain(result,result[ids.negative].inputs.clip,'clip');
    for(const chain of [positive,negative]) {
        assert.deepEqual(chain.rows.map(r=>r.lora_name),chosen.slice(0,2).map(r=>r.name));
        assert.deepEqual(chain.rows.map(r=>r.strength_clip),[0,.25],'zero CLIP strength must not fall back to model strength');
    }
    assert.deepEqual(positive.base,[ids.checkpoint,1]);assert.deepEqual(negative.base,[ids.clip,0]);
    assert.deepEqual(result[ids.positive].inputs.clip,[ids.clipPatch,0]);
    assert.deepEqual(result[ids.sampler].inputs.positive,[ids.control,0]);assert.deepEqual(result[ids.sampler].inputs.negative,[ids.control,1]);
    assert.deepEqual(result[ids.control],before[ids.control]);assert.deepEqual(result[ids.unusedLora],before[ids.unusedLora]);
    assert.ok(Object.keys(result).some(id=>!Object.hasOwn(prompt,id)),'custom LoRAs are execution-only nodes');
    assert.deepEqual(prompt,before);
}

// Primitive edits can target an encoder inside a subgraph without replacing
// its CLIP or the downstream ControlNet/conditioning route.
{
    const {ids,prompt}=fixture(),before=structuredClone(prompt);
    prompt[ids.sampler].inputs.positive=[ids.control,0];
    prompt[ids.sampler].inputs.refiner_model=[ids.checkpoint,0];
    const result=applyExecutionBinding(prompt,ids.sampler,{...inherit,
        inputOverrides:{[ids.positive2]:{text_g:'edited global prompt'}},
        removeInputs:{[ids.sampler]:['refiner_model']}});
    assert.equal(result[ids.positive2].inputs.text_g,'edited global prompt');
    assert.equal(result[ids.positive2].inputs.text_l,before[ids.positive2].inputs.text_l);
    assert.deepEqual(result[ids.positive2].inputs.clip,before[ids.positive2].inputs.clip);
    assert.deepEqual(result[ids.control],before[ids.control]);
    assert.deepEqual(result[ids.gate],before[ids.gate],'unreachable routers must remain untouched');
    assert.equal(Object.hasOwn(result[ids.sampler].inputs,'refiner_model'),false);
    assert.equal(prompt[ids.positive2].inputs.text_g,before[ids.positive2].inputs.text_g);
    assert.ok(Object.hasOwn(prompt[ids.sampler].inputs,'refiner_model'));
}

// Selecting B is deterministic; unresolved/invalid selectors may be rejected
// explicitly or left intact for validation, but must never silently select A.
{
    const {ids,prompt,lookup}=fixture();prompt[ids.gate].inputs.active_inputs=2;
    const flow=inspectExecutionFlow(prompt,ids.sampler,lookup);
    assert.deepEqual(entryIds(flow.encoders.positive),[ids.unusedEncoder]);
    assert.deepEqual(applyExecutionBinding(prompt,ids.sampler,inherit)[ids.sampler].inputs.positive,[ids.unusedEncoder,0]);
    for(const flags of [0,3,-1]) {
        prompt[ids.gate].inputs.active_inputs=flags;
        try {
            const result=applyExecutionBinding(prompt,ids.sampler,inherit);
            assert.deepEqual(result[ids.sampler].inputs.positive,[ids.gate,0]);
            assert.deepEqual(result[ids.gate].inputs,prompt[ids.gate].inputs);
        } catch(error) {
            assert.notEqual(error.name,'TypeError');
            assert.match(error.message,/唯一|歧义|互斥|启用|exclusive|ambiguous|enabled|branch|input/i);
        }
    }
}

console.log('Workspace execution flow: dynamic IDs, processing chains, split CLIP sources, multi-encoder conditioning, inherited/overridden LoRAs, switch safety and immutable unrelated branches pass');

// Real Vue-backed widget rows are proxies; ComfyUI transmits their JSON data.
{
 const {ids,prompt}=fixture();prompt[ids.modelLora].inputs.lora_1=new Proxy({on:true,lora:'vue-row.safetensors',strength:.4},{});
 const copy=applyExecutionBinding(prompt,ids.sampler,inherit);assert.equal(copy[ids.modelLora].inputs.lora_1.lora,'vue-row.safetensors');
}

{
 const {ids,prompt,lookup}=fixture();prompt[ids.gate]={class_type:'ComfySwitchNode',inputs:{switch:false,on_true:[ids.control,0],on_false:[ids.unusedEncoder,0]}};
 assert.deepEqual(entryIds(inspectExecutionFlow(prompt,ids.sampler,lookup).encoders.positive),[ids.unusedEncoder]);
 assert.deepEqual(applyExecutionBinding(prompt,ids.sampler,inherit)[ids.sampler].inputs.positive,[ids.gate,0],'native switch execution is preserved');
 prompt[ids.gate]={class_type:'ComfySoftSwitchNode',inputs:{switch:true,on_false:[ids.unusedEncoder,0]}};
 assert.deepEqual(entryIds(inspectExecutionFlow(prompt,ids.sampler,lookup).encoders.positive),[ids.unusedEncoder]);
}
