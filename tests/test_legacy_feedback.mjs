import assert from 'node:assert/strict';
import {removeLegacyFeedback} from '../web/legacy_feedback.js';
const make=()=>({nodes:[{id:1,type:'AdachiInlineMask',inputs:[{name:'result',link:10},{name:'image',link:11}],outputs:[]},{id:2,type:'Source',inputs:[],outputs:[{links:[10,11]}]}],links:[[10,2,0,1,0,'IMAGE'],[11,2,0,1,1,'STRING']]});
const graph=make();graph.definitions={subgraphs:[make()]};removeLegacyFeedback(graph);
for(const g of [graph,...graph.definitions.subgraphs]){
 assert.deepEqual(g.nodes[0].inputs,[{name:'image',link:11}]);assert.deepEqual(g.links,[[11,2,0,1,0,'STRING']]);assert.deepEqual(g.nodes[1].outputs[0].links,[11]);
}
removeLegacyFeedback(graph);assert.equal(graph.links.length,1);
const modern=make();modern.links=modern.links.map(([id,origin_id,origin_slot,target_id,target_slot,type])=>({id,origin_id,origin_slot,target_id,target_slot,type}));removeLegacyFeedback(modern);assert.equal(modern.links.length,1);assert.equal(modern.links[0].target_slot,0);
const orphan=make();orphan.nodes[0].inputs=[{name:'image',link:null}];removeLegacyFeedback(orphan);assert.equal(orphan.links.length,0);
console.log('Legacy feedback migration: tuple/object links, slot reindexing, nested graphs, orphan cleanup and idempotence passed');
