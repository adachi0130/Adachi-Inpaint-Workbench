import assert from 'node:assert/strict';
import {ImageCompareView} from '../web/compare.js';
const view=Object.create(ImageCompareView.prototype),events=[];
Object.assign(view,{ready:true,pendingOutputs:0,targetSelect:{value:'7'},results:[{}],index:0,progressBox:{hidden:true},refreshTargets(){},updateButton(){},status(s,e){events.push(['status',s,e]);},loading(s,v){this.progressBox.hidden=false;events.push(['progress',s,v]);},options:{async onAdopt(id,image,{onProgress}){onProgress({phase:'download',loaded:20,total:100});onProgress({phase:'upload',loaded:30,total:100});onProgress({phase:'processing'});}}});
await view.adopt();assert.equal(view.busy,false);assert.equal(view.progressBox.hidden,true);const progress=events.filter(e=>e[0]==='progress');assert.equal(progress.length,4);assert.equal(progress[1][2][0].loaded,20);assert.equal(progress[2][2][0].loaded,30);
view.options.onAdopt=async()=>{throw Error('network failure')};await view.adopt();assert.equal(view.progressBox.hidden,true);assert.equal(view.busy,false);assert(events.some(e=>e[0]==='status'&&e[1]==='network failure'&&e[2]));
console.log('Adoption progress: actual download/upload bytes, loading phase and failed retry cleanup passed');
