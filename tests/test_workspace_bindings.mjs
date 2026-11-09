import assert from 'node:assert/strict';
import {WorkspaceBindings} from '../web/workspace_bindings.js';
const nodes=[];
const add=(id,type,values={},inputs=[],outputs=[])=>{const n={id,type,mode:0,properties:{},widgets:Object.entries(values).map(([name,value])=>({name,value})),inputs,outputs:outputs.map(type=>({type,name:type}))};nodes.push(n);return n;};
const unrelated=add('old-unrelated','CheckpointLoaderSimple',{ckpt_name:'do-not-pick.safetensors'});
const a=add('base-a','CheckpointLoaderSimple',{ckpt_name:'custom-A.safetensors'});
const b=add('base-b','UNETLoader',{unet_name:'anything-B.safetensors'});
const clip=add('separate-encoder','CLIPLoader',{clip_name:'language.safetensors'});
const vae=add('separate-vae','VAELoader',{vae_name:'image.safetensors'});
const posA=add('encode-a','CLIPTextEncode',{text:'original A'},[{name:'clip',type:'CLIP'}],['CONDITIONING']);
const negA=add('negative-a','CLIPTextEncode',{text:'negative A'},[{name:'clip',type:'CLIP'}],['CONDITIONING']);
const posB=add('encode-b','CLIPTextEncode',{text:'original B'},[{name:'clip',type:'CLIP'}],['CONDITIONING']);
const negB=add('negative-b','CLIPTextEncode',{text:'negative B'},[{name:'clip',type:'CLIP'}],['CONDITIONING']);
add('model-patch','ModelSamplingSD3',{},[{name:'model',type:'MODEL'}],['MODEL']);
const sampler=add('workbench','AdachiWebUIInpaint',{refiner_switch:.8},[{name:'model',type:'MODEL'},{name:'positive',type:'CONDITIONING'},{name:'negative',type:'CONDITIONING'},{name:'vae',type:'VAE'}]);
const controller=add('preset-owner','AdachiGroupPresets');const applied=[];
controller.adachiGroupPresets={model:{node:controller,data:{activeId:'one',presets:[{id:'one',name:'Portrait'},{id:'two',name:'Studio'}]},apply(id){this.data.activeId=id;applied.push(id);}}};
const graph={_nodes:nodes,getNodeById:id=>nodes.find(n=>String(n.id)===String(id)),links:{}};
const p=(kind)=>{
 const root=kind==='one'?'base-a':'base-b',positive=kind==='one'?'encode-a':'encode-b',negative=kind==='one'?'negative-a':'negative-b';
 return {[root]:{class_type:graph.getNodeById(root).type,inputs:{}},'separate-encoder':{class_type:'CLIPLoader',inputs:{}},'separate-vae':{class_type:'VAELoader',inputs:{}},
  'model-patch':{class_type:'ModelSamplingSD3',inputs:{model:[root,0]}},
  [positive]:{class_type:'CLIPTextEncode',inputs:{clip:kind==='one'?[root,1]:['separate-encoder',0],text:'base text'}},
  [negative]:{class_type:'CLIPTextEncode',inputs:{clip:kind==='one'?[root,1]:['separate-encoder',0],text:'negative text'}},
  workbench:{class_type:'AdachiWebUIInpaint',inputs:{model:['model-patch',0],positive:[positive,0],negative:[negative,0],vae:kind==='one'?[root,2]:['separate-vae',0]}}};
};
const x=new WorkspaceBindings({graph,sampler});assert.equal(x.profileId,'one');assert.equal(x.model,null,'discovery cannot guess from filenames or active loader order');
x.updateExecutionGraph(p('one'),'workbench');assert.equal(x.model,a);assert.notEqual(x.model,unrelated);assert.equal(x.positive,posA);assert.equal(x.getExecutionBinding().loraMode,'inherit');
assert.deepEqual(x.getExecutionBinding().samplerInputs,{},'final model-processing references are preserved');
x.settings.positive='custom A';assert.deepEqual(x.getExecutionBinding().inputOverrides['encode-a'],{text:'custom A'});
x.settings.loraMode='override';x.settings.loras=[{name:'style.safetensors',strength:.7}];assert.equal(x.getExecutionBinding().loras[0].name,'style.safetensors');
x.selectProfile('two');x.updateExecutionGraph(p('two'),'workbench');assert.equal(x.model,b);assert.equal(x.clip,clip);assert.equal(x.vae,vae);assert.equal(x.positive,posB);assert.equal(x.getExecutionBinding().loraMode,'inherit');assert.equal(x.getExecutionBinding().inputOverrides['encode-b'],undefined);
x.selectProfile('one');x.updateExecutionGraph(p('one'),'workbench');assert.equal(x.settings.positive,'custom A');assert.deepEqual(applied,['two','one']);
controller.mode=4;const ignored=new WorkspaceBindings({graph,sampler});assert.equal(ignored.controller,undefined);assert.deepEqual(ignored.profiles.map(p=>p.id),['current']);
controller.mode=0;controller.adachiGroupPresets.model.data.presets.push({id:'new',name:'Any other title'});ignored.refreshProfiles();assert.equal(ignored.profiles.length,3);
controller.adachiGroupPresets.model.data.activeId='two';ignored.refreshProfiles();assert.equal(ignored.profileId,'two');
console.log('Workspace bindings: arbitrary IDs and titles, actual loader/CLIP/VAE routes, preserved model patches, inherited/custom LoRAs, per-profile edits and dynamic controllers pass');
