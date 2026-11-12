import {T} from './i18n.js';

// A separate transparent image-space layer. It never mutates source Image
// objects held by the workspace's history and is persisted in paint_data.
export class ColorPaint {
    constructor(editor,crop,widget,changed,imageUrl=x=>x){
        Object.assign(this,{editor,crop,widget,changed,imageUrl});this.active=false;this.color='#ff8a32';this.undo=[];this.redo=[];this.revision=0;
        this.layer=document.createElement('canvas');
        const controls=document.createElement('div');controls.className='dd-color-paint';
        this.button=document.createElement('button');this.button.type='button';this.button.textContent='✎';this.button.title=T('Paint image pixels; Alt-click picks a color; Ctrl+wheel changes brush size');this.button.setAttribute('aria-label',this.button.title);
        this.button.onclick=e=>{e.preventDefault();e.stopPropagation();if(!this.widget){editor.status(T('The paint layer is unavailable; update and restart ComfyUI'),true);return;}this.active=!this.active;if(this.active && editor.view==='mask')editor.view='overlay';this.sync();editor.schedule();};
        this.picker=document.createElement('input');this.picker.type='color';this.picker.value=this.color;this.picker.title=T('Brush color');this.picker.setAttribute('aria-label',this.picker.title);this.picker.oninput=()=>{this.color=this.picker.value;};
        this.undoButton=document.createElement('button');this.undoButton.type='button';this.undoButton.textContent='↶';this.undoButton.title=T('Undo color painting');this.undoButton.onclick=()=>this.step(this.undo,this.redo);
        this.redoButton=document.createElement('button');this.redoButton.type='button';this.redoButton.textContent='↷';this.redoButton.title=T('Redo color painting');this.redoButton.onclick=()=>this.step(this.redo,this.undo);
        controls.append(this.button,this.picker,this.undoButton,this.redoButton);crop.bar.prepend(controls);this.controls=controls;
        const draw=editor.options.drawSource,revision=editor.options.sceneRevision;
        editor.options.drawSource=ctx=>{const done=draw?.(ctx);if(!done)ctx.drawImage(editor.image,0,0);if(this.layer.width&&!crop.previewOriginal)ctx.drawImage(this.layer,0,0);return true;};
        editor.options.sceneRevision=()=>`${revision?.()||''}:paint:${this.revision}`;
        const down=editor.pointerDown.bind(editor),move=editor.pointerMove.bind(editor),up=editor.pointerUp.bind(editor);
        editor.pointerDown=e=>{if(this.active && this.restoring){e.preventDefault();e.stopPropagation();return;}if(!this.active||e.button!==0||editor.space||!editor.ready||crop.busy||crop.previewOriginal||(crop.mode==='crop'&&!crop.region?.locked))return down(e);
            e.preventDefault();e.stopPropagation();const p=editor.point(e);if(e.altKey){this.pick(p);return;}
            this.ensure();this.remember();this.redo=[];this.drawing={id:e.pointerId,last:p};editor.pointerId=e.pointerId;editor.canvas.setPointerCapture(e.pointerId);this.segment(p,p);this.sync();};
        editor.pointerMove=e=>{if(!this.drawing||this.drawing.id!==e.pointerId)return move(e);e.preventDefault();e.stopPropagation();const events=e.getCoalescedEvents?.()||[];for(const event of events.length?events:[e]){const p=editor.point(event);this.segment(this.drawing.last,p);this.drawing.last=p;}editor.cursor=editor.point(e);editor.schedule();};
        editor.pointerUp=e=>{if(!this.drawing||this.drawing.id!==e.pointerId)return up(e);e.preventDefault();e.stopPropagation();this.drawing=null;editor.pointerId=null;if(editor.canvas.hasPointerCapture(e.pointerId))editor.canvas.releasePointerCapture(e.pointerId);this.flush();this.sync();};
        this.sync();
    }
    ensure(){const {image}=this.editor;if(!image)return;if(this.layer.width!==image.width||this.layer.height!==image.height){this.layer.width=image.width;this.layer.height=image.height;}}
    segment(a,b){const ctx=this.layer.getContext('2d');ctx.save();const bounds=this.editor.options.paintBounds?.();if(bounds){ctx.beginPath();ctx.rect(bounds.x,bounds.y,bounds.width,bounds.height);ctx.clip();}ctx.strokeStyle=this.color;ctx.fillStyle=this.color;ctx.lineWidth=this.editor.brushSize;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=this.editor.brushOpacity/100;if(a.x===b.x&&a.y===b.y){ctx.beginPath();ctx.arc(a.x,a.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}ctx.restore();this.revision++;this.editor.schedule();}
    pick(p){const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d',{willReadFrequently:true});x.translate(-Math.floor(p.x),-Math.floor(p.y));this.editor.options.drawSource(x);const [r,g,b,a]=x.getImageData(0,0,1,1).data;if(a){this.color='#'+[r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('');this.picker.value=this.color;}}
    flush(){if(!this.widget||!this.layer.width)return;try{this.widget.value=this.layer.toDataURL('image/png');this.changed();}catch(error){this.editor.status(error.message,true);throw error;}}
    async prepareRestore(data,width,height){if(!data)return null;const image=new Image();image.src=data.startsWith('data:')?data:this.imageUrl(data);await image.decode();if(image.width!==width||image.height!==height)throw Error(T('Paint layer dimensions do not match the source image'));return image;}
    commitRestore(image,width,height){this.undo=[];this.redo=[];this.layer.width=width;this.layer.height=height;if(image)this.layer.getContext('2d').drawImage(image,0,0);this.revision++;this.editor.schedule();this.sync();}
    async restore(data){const width=this.editor.image.width,height=this.editor.image.height,loadVersion=this.editor.loadVersion,revision=this.revision,version=this.restoreVersion=(this.restoreVersion||0)+1;this.restoring=true;try{const image=await this.prepareRestore(data,width,height);if(this.editor.destroyed||this.restoreVersion!==version||this.editor.loadVersion!==loadVersion||this.revision!==revision||this.widget?.value!==data)return false;this.commitRestore(image,width,height);return true;}finally{if(this.restoreVersion===version)this.restoring=false;}}
    remember(){this.undo.push(this.layer.toDataURL('image/png'));let bytes=this.undo.reduce((n,s)=>n+s.length*2,0);while(this.undo.length>1&&(this.undo.length>20||bytes>64*1024*1024))bytes-=this.undo.shift().length*2;}
    async step(from,to){if(this.drawing||this.restoring||!from.length)return;this.restoring=true;const current=this.layer.toDataURL('image/png'),data=from.pop(),image=new Image();image.src=data;try{await image.decode();to.push(current);const ctx=this.layer.getContext('2d');ctx.clearRect(0,0,this.layer.width,this.layer.height);ctx.drawImage(image,0,0);this.revision++;this.flush();this.editor.schedule();this.sync();}catch(e){from.push(data);this.editor.status(e.message,true);}finally{this.restoring=false;}}
    clear(){this.undo=[];this.redo=[];this.layer.width=this.layer.height=0;if(this.widget)this.widget.value='';this.revision++;this.sync();}
    destroy(){this.layer.width=this.layer.height=0;this.controls.remove();}
    clearRegion(r){if(!this.layer.width)return;this.remember();this.redo=[];this.layer.getContext('2d').clearRect(r.x,r.y,r.width,r.height);this.revision++;this.flush();this.editor.schedule();this.sync();}
    sync(){this.editor.stage.classList.toggle('dd-color-active',this.active);this.button.classList.toggle('dd-active',this.active);this.button.setAttribute('aria-pressed',String(this.active));this.picker.hidden=this.undoButton.hidden=this.redoButton.hidden=!this.active;this.undoButton.disabled=!this.undo.length;this.redoButton.disabled=!this.redo.length;this.editor.updateButtons?.();}
}
