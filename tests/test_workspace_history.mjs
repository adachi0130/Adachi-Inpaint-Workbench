import assert from "node:assert/strict";
import {WorkspaceHistory,captureSourceState,restoreSourceState} from "../web/workspace_history.js";

class Raster {
    constructor(pixels) { this.pixels = pixels; this.width = 4; this.height = 3; }
    toDataURL() { return JSON.stringify({pixels:this.pixels}); }
}
const decode = async data => new Raster(JSON.parse(data).pixels);
const source = name => ({src:name, width:4,height:3});
const context = prefix => ({mask:new Raster(prefix+"-mask"), baseMask:new Raster(prefix+"-base"),history:[{type:"brush",points:[{x:1,y:2}]}],future:[{type:"erase",points:[{x:2,y:1}]}],lastMask:prefix+"-serialized",dirty:false});
const widgetNames=["image","mask_data","source_data","edit_mode","crop_state","blend_data","layer_image"];
function node() {
    const n={properties:{},widgets:widgetNames.map(name=>({name,value:name})),graph:{setDirtyCanvas(){}}};
    const e=n.adachiEditor={...context("repaint"),image:source("original"),ready:true,loadVersion:1,maskRevision:0,pan:{x:1,y:2},zoom:2,keepFit:true,view:"overlay",filename:{textContent:"original.png"},sizeLabel:{},embed:{checked:false},flush(){},schedule(){},updateButtons(){}};
    n.adachiCrop={contexts:{blend:context("blend")},target:"mask",layer:source("layer"),cropWidth:512,cropHeight:768,revision:0,acceptVersion:0,sync(){},syncPreset(){},stopOriginalPreview(){}};
    return n;
}

{
 const n=node(),e=n.adachiEditor,c=n.adachiCrop;
 n.widgets.find(w=>w.name==="edit_mode").value="crop";
 n.widgets.find(w=>w.name==="crop_state").value=JSON.stringify({locked:true,x:1,y:2,width:512,height:768,job:"job-a"});
 const before=captureSourceState(n);
 e.mask.pixels="edited";e.history[0].points[0].x=99;e.image=source("adopted");c.layer=source("new-layer");c.target="blend";
 n.widgets.find(w=>w.name==="crop_state").value="{}";
 await restoreSourceState(n,before,{decode});
 assert.equal(e.image.src,"original");assert.equal(c.layer.src,"layer");
 assert.equal(e.mask.pixels,"repaint-mask");assert.equal(e.baseMask.pixels,"repaint-base");
 assert.equal(c.contexts.blend.mask.pixels,"blend-mask");assert.equal(c.target,"mask");
 assert.equal(e.history[0].points[0].x,1);assert.equal(e.future[0].type,"erase");
 assert.equal(JSON.parse(n.widgets.find(w=>w.name==="crop_state").value).job,"job-a");
 assert.deepEqual(e.pan,{x:1,y:2});assert.equal(e.zoom,2);assert.equal(e.keepFit,true);
 assert.notEqual(e.mask,before.contexts.mask.mask);
 e.mask.pixels="changed-again";await restoreSourceState(n,before,{decode});assert.equal(e.mask.pixels,"repaint-mask");
}
{
 const n=node(),c=n.adachiCrop,e=n.adachiEditor;
 c.contexts.mask=context("saved-repaint");Object.assign(e,context("active-blend"));c.target="blend";
 const before=captureSourceState(n);e.mask.pixels="lost";await restoreSourceState(n,before,{decode});
 assert.equal(e.mask.pixels,"active-blend-mask");assert.equal(c.contexts.mask.mask.pixels,"saved-repaint-mask");assert.equal(c.target,"blend");
}
{
 const n=node(),before=captureSourceState(n),old=n.adachiEditor.image;
 await assert.rejects(restoreSourceState(n,before,{decode:async()=>{throw Error("broken PNG")}}),/broken PNG/);
 assert.equal(n.adachiEditor.image,old);
 await assert.rejects(restoreSourceState(n,before,{decode:async data=>{n.adachiEditor.loadVersion++;return decode(data)}}),/image changed/);
 assert.equal(n.adachiEditor.image,old);
}
{
 const n=node(),h=new WorkspaceHistory(n,{maxEntries:3});h.checkpoint("original");
 await h.transact("adopted",async()=>{n.adachiEditor.image=source("adopted");n.widgets[0].value="adopted.png"});
 assert.equal(h.entries.length,2);assert.equal(h.current.label,"adopted");assert.equal(h.entries[0].state.image.src,"original");
 const count=h.entries.length;await assert.rejects(h.transact("failed",async()=>{throw Error("upload failed")}),/upload failed/);assert.equal(h.entries.length,count);assert.equal(h.busy,false);
 for(let i=0;i<6;i++){n.adachiEditor.image=source("next"+i);n.widgets[0].value="next"+i;h.checkpoint("next"+i);}
 assert.equal(h.entries.length,3);assert.equal(h.entries[0].label,"original");assert.equal(h.current.label,"next5");
 n.adachiEditor.stroke={};assert.throws(()=>h.checkpoint("stroke"),/Finish the current edit/);
}
console.log("Workspace source history: repaint/blend pixels, crop state, layer, commands, failure atomicity and retention passed");
{
 const n=node(),before=captureSourceState(n),created=[];
 let count=0;
 await assert.rejects(restoreSourceState(n,before,{decode:async data=>{if(++count===2)throw Error('bad base');const c=await decode(data);created.push(c);return c;}}),/bad base/);
 assert.equal(created[0].width,0,'a partial decode failure frees already allocated masks');
 assert.equal(n.adachiEditor.image,before.image);
 for(const change of [()=>n.adachiEditor.maskRevision++,()=>n.adachiCrop.revision++]){
  await assert.rejects(restoreSourceState(n,before,{decode:async data=>{change();return decode(data);}}),/image changed/);
  assert.equal(n.adachiEditor.image,before.image,'a completed stroke or crop change during decoding is preserved');
 }
 await assert.rejects(restoreSourceState(n,before,{decode:async data=>{n.graph=null;return decode(data);}}),/image changed/);
}
