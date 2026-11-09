import assert from 'node:assert/strict';
import {inspectWorkbench,selectWorkbenchPipeline} from '../web/workbench_analysis.js';
const graph={_nodes:[{type:'AdachiInlineMask'},{type:'AdachiWebUIInpaint'},
 {type:'AdachiImageCompare'},{type:'AdachiGroupPresets'},
 {type:'CheckpointLoaderSimple'},{type:'Power Lora Loader (rgthree)'}]};
const result=inspectWorkbench(graph);
assert.deepEqual(result.missing,[]);
assert.equal(result.checkpoints.length,1);
assert.equal(result.loras.length,1);
assert.deepEqual(inspectWorkbench(null).missing,['inline_mask','inpaint','compare']);
console.log('Workbench discovery checks passed');

const first={id:10,type:'AdachiInlineMask',mode:0,inputs:[]},second={id:20,type:'AdachiInlineMask',mode:0,inputs:[]},a={id:30,type:'AdachiWebUIInpaint',mode:0,inputs:[{name:'image',link:1}]},b={id:40,type:'AdachiWebUIInpaint',mode:0,inputs:[{name:'image',link:2}]},outA={id:50,type:'AdachiImageCompare',mode:0,inputs:[{name:'result',link:3}]},outB={id:60,type:'AdachiImageCompare',mode:0,inputs:[{name:'result',link:4}]};
const multi={_nodes:[first,second,a,b,outA,outB],links:{1:{origin_id:10},2:{origin_id:20},3:{origin_id:30},4:{origin_id:40}},getNodeById(id){return this._nodes.find(n=>n.id==id);}};multi._nodes.forEach(n=>n.graph=multi);
const chosen=selectWorkbenchPipeline(multi,b);assert.equal(chosen.editor,second);assert.equal(chosen.compare,outB);assert.equal(chosen.ambiguous,false);
b.inputs=[];outB.inputs=[];assert.equal(selectWorkbenchPipeline(multi,b).ambiguous,true,'unconnected ambiguous canvases need an explicit choice');
console.log('Workbench selection: multiple independent pipelines follow actual connections; ambiguity is explicit');
