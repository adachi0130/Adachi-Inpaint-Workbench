import assert from 'node:assert/strict';
class Element {
  constructor(tag){this.tag=tag;this.style={};this.dataset={};this.classList={toggle(){}};this.children=[];this.width=0;this.height=0;this.value='';}
  append(...children){this.children.push(...children)} setAttribute(){} hasPointerCapture(){return false} setPointerCapture(){}
  getContext(){return {save(){},restore(){},beginPath(){},rect(){},clip(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},translate(){},clearRect(){},drawImage(){},getImageData(){return {data:[12,34,56,255]}}};}
  toDataURL(){return 'data:image/png;base64,paint';}
}
globalThis.document={createElement:tag=>new Element(tag)};globalThis.ResizeObserver=class {observe(){} disconnect(){}};
globalThis.Image=class {constructor(){this.width=16;this.height=12;} async decode(){if(this.src==='bad')throw Error('bad image');}};
const {ColorPaint}=await import('../web/color_paint.js');
const editor={image:{width:16,height:12},ready:true,view:'overlay',brushSize:8,brushOpacity:100,stage:new Element('div'),root:new Element('div'),canvas:new Element('canvas'),options:{drawSource:()=>false},point:e=>({x:e.x,y:e.y}),pointerDown(){},pointerMove(){},pointerUp(){},schedule(){},status(){}};
const crop={mode:'mask',bar:new Element('div'),region:{locked:false}},widget={value:''};let changes=0;
const paint=new ColorPaint(editor,crop,widget,()=>changes++);paint.button.onclick({preventDefault(){},stopPropagation(){}});
const event={button:0,pointerId:1,x:2,y:3,preventDefault(){},stopPropagation(){}};
editor.pointerDown(event);assert.equal(editor.pointerId,1);editor.pointerUp(event);assert.equal(editor.pointerId,null);assert.match(widget.value,/data:image\/png/);assert.equal(changes,1);
const saved=widget.value;editor.pointerDown({...event,altKey:true});assert.equal(paint.color,'#0c2238');assert.equal(widget.value,saved);
await assert.rejects(()=>paint.prepareRestore('bad',16,12));await assert.rejects(()=>paint.prepareRestore('anything',17,12));
const loaded=await paint.prepareRestore('anything',16,12);paint.commitRestore(loaded,16,12);assert.equal(paint.undo.length,0);
paint.clearRegion({x:0,y:0,width:4,height:4});assert.equal(changes,2);paint.clear();assert.equal(widget.value,'');
widget.value='old';let finish;paint.prepareRestore=()=>new Promise(resolve=>{finish=resolve});const restoring=paint.restore('old');paint.clear();finish(new Image());assert.equal(await restoring,false);assert.equal(paint.layer.width,0);assert.equal(paint.restoring,false);
console.log('Color painting: stroke commits, Alt sampling, immutable restore validation and region clearing pass');
