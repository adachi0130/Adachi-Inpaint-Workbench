import assert from 'node:assert/strict';
import {CompareViewport} from '../web/compare_viewport.js';
import {ImageCompareView} from '../web/compare.js';
const v=new CompareViewport();
const size=[1000,600,800,400],at=[235,417];
const original=v.transform(...size);
assert.equal(original.scale,1.25);assert.equal(original.y,50);
const pixel=t=>[(at[0]-t.x)/t.scale,(at[1]-t.y)/t.scale];
const initial=pixel(original);
v.zoomAt(...size,...at,-120);
assert.ok(v.zoom>1);const enlarged=v.transform(...size);
assert.ok(Math.abs(pixel(enlarged)[0]-initial[0])<1e-9);
assert.ok(Math.abs(pixel(enlarged)[1]-initial[1])<1e-9,'wheel zoom keeps the image point under the pointer');
v.pan(20,-10);const moved=v.transform(...size);assert.equal(moved.x,enlarged.x+20);assert.equal(moved.y,enlarged.y-10);
for(let i=0;i<500;i++)v.zoomAt(...size,...at,-120);assert.equal(v.zoom,16);
for(let i=0;i<1000;i++)v.zoomAt(...size,...at,120);assert.equal(v.zoom,.1);
v.fit();assert.deepEqual(v.transform(...size),original);
v.zoomAt(0,0,800,400,0,0,120);assert.equal(v.zoom,1);
console.log('Compare viewport: pointer-anchored zoom, panning, limits, fit and zero-size protection pass');

{
 const draws=[];const context={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(image){draws.push(image);}};
 const view=Object.create(ImageCompareView.prototype),before={width:800,height:400},after={width:800,height:400};
 Object.assign(view,{viewport:new CompareViewport(),workspaceZoom:false,displayMode:'compare',ready:true,before,after,hovered:true,split:.5,version:1,divider:{style:{}},canvas:{width:0,height:0,clientWidth:1000,getBoundingClientRect:()=>({width:1000,height:600,left:0,top:0}),getContext:()=>context},options:{onGraphWheel:()=>graphWheels++},schedule:()=>schedules++});
 let graphWheels=0,schedules=0;globalThis.devicePixelRatio=1;
 const event={deltaY:-120,deltaMode:0,clientX:235,clientY:417,preventDefault(){},stopPropagation(){}};
 view.wheel(event);assert.equal(graphWheels,1,'normal graph node wheel must still navigate the workflow');
 view.enableWorkspaceZoom(true);view.wheel(event);assert.equal(graphWheels,1);assert.ok(view.viewport.zoom>1);
 const shared=view.transform();
 view.setDisplayMode('before');view.render();assert.deepEqual(draws.splice(0),[before]);assert.deepEqual(view.transform(),shared);
 view.setDisplayMode('after');view.render();assert.deepEqual(draws.splice(0),[after]);assert.deepEqual(view.transform(),shared);
 view.setDisplayMode('compare');view.render();assert.deepEqual(draws.splice(0),[after,before]);
 view.fitView();assert.equal(view.viewport.zoom,1);assert.ok(schedules>0);
 view.viewport.pan(50,30);view.enableWorkspaceZoom(false);assert.equal(view.displayMode,'compare');assert.equal(view.viewport.panX,0);assert.equal(view.viewport.panY,0);
}
console.log('Compare integration: graph wheel routing, workspace zoom, shared before/after transform, display pixels and teardown reset pass');
