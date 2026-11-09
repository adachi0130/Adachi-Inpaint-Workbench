import assert from 'node:assert/strict';
import {inspectWorkbench} from '../web/workbench_analysis.js';
const graph={_nodes:[{type:'AdachiInlineMask'},{type:'AdachiWebUIInpaint'},
 {type:'AdachiImageCompare'},{type:'AdachiGroupPresets'},
 {type:'CheckpointLoaderSimple'},{type:'Power Lora Loader (rgthree)'}]};
const result=inspectWorkbench(graph);
assert.deepEqual(result.missing,[]);
assert.equal(result.checkpoints.length,1);
assert.equal(result.loras.length,1);
assert.deepEqual(inspectWorkbench(null).missing,['inline_mask','inpaint','compare']);
console.log('Workbench discovery checks passed');
