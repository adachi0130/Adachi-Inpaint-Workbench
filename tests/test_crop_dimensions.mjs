import assert from 'node:assert/strict';
import {syncCropDimensions} from '../web/parameter_bridge.js';
const nodes=new Map(),links={},graph={links,getNodeById:id=>nodes.get(id),_nodes:[]};
const source={id:1,type:'AdachiInlineMask',graph};nodes.set(1,source);graph._nodes.push(source);
const make=(id,type,linkedWidth=false)=>{
 const n={id,type,graph,inputs:[{name:'image',link:id},...(linkedWidth?[{name:'width',link:999}]:[])],widgets:[{name:'width',value:640},{name:'height',value:640}]};
 nodes.set(id,n);graph._nodes.push(n);links[id]={origin_id:1};return n;
};
const sampler=make(2,'AdachiWebUIInpaint'),prepare=make(3,'AdachiInpaintPrepare',true);
syncCropDimensions(source,1024,1536);
assert.deepEqual(sampler.widgets.map(w=>w.value),[1024,1536]);assert.deepEqual(prepare.widgets.map(w=>w.value),[640,1536]);
syncCropDimensions(source,9000,17);assert.deepEqual(sampler.widgets.map(w=>w.value),[8192,64]);
console.log('Crop resolution sync: connected targets, linked-input protection and source-size limits passed');
