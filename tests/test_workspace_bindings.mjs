import assert from 'node:assert/strict';
import {WorkspaceBindings} from '../web/workspace_bindings.js';

const nodes = [];
const add = (id,type,widgets=[]) => {const node={id,type,widgets,properties:{},inputs:[],mode:4};nodes.push(node);return node;};
const ckpt=add(518,'CheckpointLoaderSimple',[{name:'ckpt_name',value:'wai.safetensors'}]);
add(359,'CheckpointLoaderSimple',[{name:'ckpt_name',value:'anima.safetensors'}]);
add(357,'CLIPLoader');add(358,'VAELoader');
const sampler=add(501,'AdachiWebUIInpaint',[{name:'refiner_switch',value:1}]);
add(521,'CLIPTextEncode',[{name:'text',value:'positive'}]);
add(520,'CLIPTextEncode',[{name:'text',value:'negative'}]);
add(547,'CLIPTextEncode',[{name:'text',value:'anima positive'}]);
add(16,'CLIPTextEncode',[{name:'text',value:'anima negative'}]);
add(553,'Power Lora Loader (rgthree)',[
    {name:'lora_1',value:{on:true,lora:'old1.safetensors',strength:1}},
    {name:'lora_7',value:{on:true,lora:'old7.safetensors',strength:1}}
]);
add(360,'Power Lora Loader (rgthree)');
const preset=add(524,'AdachiGroupPresets');preset.mode=0;
const applied=[];
preset.adachiGroupPresets={model:{node:preset,data:{activeId:'anima',presets:[{id:'txt',name:'anima文生图'},{id:'anima',name:'anima修图'},{id:'wai',name:'wai修图'}]},apply:id=>{applied.push(id);preset.adachiGroupPresets.model.data.activeId=id;}}};
const graph={_nodes:nodes,getNodeById:id=>nodes.find(n=>String(n.id)===String(id)),links:{}};
const bindings=new WorkspaceBindings({graph,sampler});
assert.equal(bindings.profiles.length,3);
assert.equal(bindings.profileId,'anima');bindings.selectProfile('wai');
let result=bindings.getExecutionBinding();
assert.deepEqual(result.samplerInputs,{model:['518',0],vae:['518',2],positive:['521',0],negative:['520',0]});
assert.deepEqual(result.inputOverrides['521'],{clip:['518',1]});
assert.equal(result.enableNodes.some(n=>n.id===553),false,'no LoRA must bypass the loader');
assert.deepEqual(result.removeInputs['501'],['refiner_model','refiner_positive','refiner_negative']);
bindings.settings.loras=[{name:'new.safetensors',strength:.7}];
result=bindings.getExecutionBinding();
assert.deepEqual(result.samplerInputs.model,['553',0]);
assert.equal(result.inputOverrides['553'].lora_1.lora,'new.safetensors');
assert.equal(result.inputOverrides['553'].lora_1.strength,.7);
assert.equal(result.inputOverrides['553'].lora_7.on,false,'old enabled LoRA rows must not leak into the workspace choice');
bindings.settings.positive='new prompt';
assert.equal(bindings.getExecutionBinding().inputOverrides['521'].text,'new prompt');
bindings.selectProfile('anima');
assert.deepEqual(applied,['wai','anima']);
assert.deepEqual(bindings.getExecutionBinding().samplerInputs.model,['359',0]);
assert.deepEqual(bindings.getExecutionBinding().inputOverrides['547'].clip,['357',0]);
bindings.selectProfile('wai');
assert.equal(bindings.settings.positive,'new prompt');
assert.equal(ckpt.widgets[0].value,'wai.safetensors','read-only discovery must not change a model widget');
console.log('Workspace bindings: existing presets, WAI/Anima mapping, no LoRA, LoRA strengths, prompt edits and profile isolation passed');

preset.mode=4;
const ignored=new WorkspaceBindings({graph,sampler});
assert.equal(ignored.controller,undefined,'ignored group controller must not create preset buttons');
assert.deepEqual(ignored.profiles.map(p=>p.id),['current']);
preset.mode=0;
preset.adachiGroupPresets.model.data.presets.push({id:'fourth',name:'custom branch'});
ignored.refreshProfiles();assert.equal(ignored.profiles.length,4,'preset count comes from active controller');
console.log('Group controller: ignored/missing fallback and dynamic preset count pass');

preset.adachiGroupPresets.model.data.activeId='anima';bindings.refreshProfiles();assert.equal(bindings.profileId,'anima','external preset switching is reflected');
