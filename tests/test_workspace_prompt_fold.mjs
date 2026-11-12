import assert from 'node:assert/strict';
import {WorkspaceBindings} from '../web/workspace_bindings.js';

class Element {
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.isConnected=true;this.attributes={};}
    append(...nodes){for(const node of nodes)node.parentElement=this;this.children.push(...nodes);}
    replaceChildren(...nodes){this.children.forEach(child=>{child.isConnected=false;});this.children=[...nodes];}
    setAttribute(name,value){this.attributes[name]=value;}
    remove(){this.isConnected=false;}
    contains(node){return this===node||this.children.some(child=>child.contains?.(node));}
    querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tagName===tag.toUpperCase()?[child]:[]),...child.querySelectorAll(tag)]);}
    closest(){let node=this;while(node){if(node.tagName==='DETAILS'&&!node.open)return node;node=node.parentElement;}return null;}
    focus(){this.ownerDocument.activeElement=this;}
    setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
}
const doc={createElement:tag=>new Element(tag,doc)};globalThis.document=doc;
const sampler={id:1,type:'AdachiWebUIInpaint',mode:0,properties:{},inputs:[],widgets:[]};
const controller={id:2,type:'AdachiGroupPresets',mode:0,properties:{}};
controller.adachiGroupPresets={model:{node:controller,data:{activeId:'one',presets:[{id:'one',name:'One'},{id:'two',name:'Two'}]},apply(id){this.data.activeId=id;}}};
const graph={_nodes:[sampler,controller],getNodeById:id=>graph._nodes.find(n=>String(n.id)===String(id)),links:{}};
let changed=0,checks=0;
const binding=new WorkspaceBindings({graph,sampler,markChanged:()=>changed++,onChange:()=>checks++});
const entry=(id,text)=>({id,node:{type:'CLIPTextEncode',widgets:[{name:'text',value:text}]},api:{class_type:'CLIPTextEncode',inputs:{text}},fields:['text']});
const positive=entry('p','positive original'),negative=entry('n','negative original');
const flow=(positives=[positive])=>({encoders:{positive:positives,negative:[negative]},modelNodes:[],clipNodes:[],vaeNodes:[],loras:[],refs:{},clipConsumers:[]});
binding.flow=flow();binding.samplerId='1';binding.createPanel();
const section=kind=>binding.root.children.find(x=>x.dataset.promptKind===kind);
const textarea=group=>group.children.flatMap(x=>x.children||[]).find(x=>x.tagName==='TEXTAREA');
assert.equal(section('positive').open,true);assert.equal(section('negative').open,true);
let positivePanel=section('positive');positivePanel.ontoggle();
assert.equal(changed,0,'initial native toggle does not dirty the workflow');
positivePanel.open=false;positivePanel.ontoggle();
assert.equal(changed,1);assert.equal(checks,0,'folding is cosmetic and does not trigger workflow validation');
assert.equal(sampler.properties.adachi_workspace_ui.promptOpen.positive,false);
assert.equal(section('negative').open,true,'fold states are independent');
const n=textarea(section('negative'));n.value='edited negative';n.oninput();n.setSelectionRange(3,7,'forward');n.scrollTop=12;n.focus();
assert.deepEqual(binding.getExecutionBinding().inputOverrides.n,{text:'edited negative'});
binding.render();assert.equal(section('positive').open,false);assert.equal(section('negative').open,true);
assert.equal(doc.activeElement,textarea(section('negative')),'asynchronous panel rendering retains the focused prompt');
assert.equal(doc.activeElement.selectionStart,3);assert.equal(doc.activeElement.selectionEnd,7);assert.equal(doc.activeElement.scrollTop,12);
positivePanel.open=true;positivePanel.ontoggle();
assert.equal(sampler.properties.adachi_workspace_ui.promptOpen.positive,false,'events from detached panels cannot override current state');
binding.selectProfile('two');assert.equal(section('positive').open,false);
section('negative').open=false;section('negative').ontoggle();
binding.selectProfile('one');binding.flow=flow();binding.samplerId='1';binding.render();
assert.equal(section('positive').open,false);assert.equal(section('negative').open,false);
assert.deepEqual(binding.getExecutionBinding().inputOverrides.n,{text:'edited negative'},'profile changes preserve prompt overrides');
const restoredSampler={...sampler,properties:JSON.parse(JSON.stringify(sampler.properties))};
const restoredGraph={_nodes:[restoredSampler],getNodeById:()=>restoredSampler,links:{}};
const restored=new WorkspaceBindings({graph:restoredGraph,sampler:restoredSampler});restored.flow=flow();restored.createPanel();
assert.equal(restored.root.children.find(x=>x.dataset.promptKind==='positive').open,false);
assert.equal(restored.root.children.find(x=>x.dataset.promptKind==='negative').open,false,'saved workflow retains both folds');
delete restoredSampler.properties.adachi_workspace_ui;
restored.flow=flow([positive,entry('p2','other')]);restored.render();
const multi=restored.root.children.find(x=>x.dataset.promptKind==='positive');
assert.equal(multi.open,false,'existing multi-encoder panels default to collapsed');
assert.equal(multi.children.filter(x=>x.tagName==='LABEL').length,2,'all encoder fields remain available');
console.log('Workspace prompt folding: independent states, cosmetic toggles, profile/workflow persistence, stale events and multi-encoder prompts pass');
