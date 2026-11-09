import { app } from '../../scripts/app.js';
import { api } from '../../scripts/api.js';
import { inspectWorkbench } from './workbench_analysis.js';
import { WorkspaceBindings } from './workspace_bindings.js';
import { WorkspaceHistory } from './workspace_history.js';
import { prepareWorkspacePrompt, validateWorkspace, submitWorkspace } from './workspace_execution.js';
import { syncCurrentDimensions } from './parameter_bridge.js?v=0.8.2';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
const btn=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
const icons={edit:'<path d="m14 3 7 7-11 11H3v-7L14 3Z"/><path d="m11 6 7 7"/>',compare:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20M3 8h9M3 13h9M3 18h9"/>',side:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 12h12m-3-3 3 3-3 3"/>',theme:'<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>'};
const iconButton=(label,kind,fn)=>{const b=btn('',fn);b.title=label;b.setAttribute('aria-label',label);b.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;b.className='aw-icon';return b;};
let currentWorkspace=null;
export class Workspace {
 constructor(samplerNode=null){
  this.preferredSampler=samplerNode;this.mounts=[];this.disposers=[];this.closed=false;this.running=false;this.checkVersion=0;
  this.root=el('div','','adachi-workspace');this.root.adachiWorkspace=this;this.root.setAttribute('role','dialog');this.root.setAttribute('aria-label','安达重绘工作台');
  const head=el('header'),title=el('h1','安达工作台');head.append(title);
  this.status=el('span','正在读取当前工作流…','aw-status');this.themeButton=iconButton('切换主题','theme',()=>this.toggleTheme());head.append(this.status,this.themeButton,btn('检查连接',()=>this.check()),btn('返回工作流',()=>this.close()));this.root.append(head);
  const main=el('main'),canvas=el('section','','aw-canvas'),toolbar=el('div','','aw-toolbar');
  this.tabs={edit:iconButton('编辑蒙版','edit',()=>this.show('edit')),compare:iconButton('滑动对比','compare',()=>this.show('compare'))};
  this.sideButton=iconButton('查看前图','side',()=>this.show(this.view==='before'?'after':'before'));
  toolbar.append(this.tabs.edit,this.tabs.compare,this.sideButton);
  toolbar.append(el('span','','spacer'));this.adoptButton=btn('采用',()=>this.adopt());this.adoptButton.title='采用当前结果作为下一轮原图，保留蒙版；下方可回退或选择之前的原图';this.adoptButton.className='primary';toolbar.append(this.adoptButton);
  this.surface=el('div','','aw-surface');this.still=el('img','','aw-result-image');this.still.alt='当前选择的前图或重绘结果';this.still.hidden=true;this.surface.append(this.still);
  const foot=el('div','','aw-footer');this.undoButton=btn('↶ 回退',()=>this.restoreHistory('undo'));this.originalButton=btn('初始原图',()=>this.restoreHistory('original'));this.historySelect=el('select');this.historySelect.setAttribute('aria-label','选择已采用原图');this.historySelect.onchange=()=>this.restoreHistory(Number(this.historySelect.value));foot.append(this.undoButton,this.originalButton,this.historySelect);
  this.footer=foot;this.undoButton.title='回退到之前的原图，同时恢复蒙版和裁切状态';this.originalButton.title='恢复本次工作流会话中的初始原图';this.historySelect.title='选择之前采用或上传的原图';this.note=el('div','','aw-note');canvas.append(toolbar,this.surface,foot,this.note);
  this.side=el('aside');this.side.append(el('h2','工作流设置'));this.settings=el('div');this.params=el('div','','aw-parameters');this.runButton=btn('生成',()=>this.run());this.runButton.className='primary';this.runButton.style.width='100%';this.side.append(this.settings,this.runButton,this.params);main.append(canvas,this.side);this.root.append(main);
  this.root.addEventListener('keydown',e=>{if(e.key==='Escape'&&e.target===this.root)this.close();});
  this.root.addEventListener('pointerdown',e=>e.stopPropagation());document.body.append(this.root);document.body.classList.add('adachi-workspace-open');
  // Render first. Discovery/catalog and actual server validation run afterward.
  let theme='light';try{theme=localStorage.getItem('adachi-workspace-theme')||theme;}catch{}this.setTheme(theme);
  setTimeout(()=>this.initialize().catch(e=>this.setStatus(e.message,'error')),0);
 }
 setTheme(theme){this.root.dataset.theme=theme==='dark'?'dark':'light';const label=this.root.dataset.theme==='dark'?'切换为白色主题':'切换为黑色主题';this.themeButton.title=label;this.themeButton.setAttribute('aria-label',label);try{localStorage.setItem('adachi-workspace-theme',this.root.dataset.theme);}catch{}}
 toggleTheme(){this.setTheme(this.root.dataset.theme==='dark'?'light':'dark');}
 setStatus(text,state='pending'){if(this.closed)return;this.status.textContent=text;this.status.title=text;this.status.dataset.state=state;}
 mount(element,target,canvas=false){
  if(!element?.parentNode)throw Error('控件尚未初始化，请稍后重新打开');
  const marker=document.createComment('workspace');element.before(marker);this.mounts.push({element,marker,style:element.getAttribute('style')});target.append(element);if(canvas)element.classList.add('aw-embedded');
 }
 async initialize(){
  if(this.closed)return;this.graph=app.graph;this.nodes=inspectWorkbench(this.graph);
  this.editorNode=this.nodes.editors.find(n=>n.mode===0)||this.nodes.editors[0];this.sampler=this.preferredSampler||this.nodes.samplers.find(n=>n.mode===0)||this.nodes.samplers[0];this.compareNode=this.nodes.comparisons.find(n=>n.mode===0)||this.nodes.comparisons[0];
  this.editor=this.editorNode?.adachiEditor;this.compare=this.compareNode?.adachiCompare;
  if(!this.editor||!this.sampler?.adachiWorkbench||!this.compare)throw Error('当前工作流需要内联蒙版、安达重绘工作台和图像对比节点');
  this.history=this.editorNode.adachiWorkspaceHistory ||= new WorkspaceHistory(this.editorNode);
  this.history.onChange=()=>this.syncHistory();
  this.history.onRestore=()=>{syncCurrentDimensions(this.editorNode);app.canvas?.emitBeforeChange?.();app.canvas?.emitAfterChange?.();this.show('edit');this.scheduleCheck();};
  if(this.editor.ready)await this.history.checkpoint('打开时原图');
  this.mount(this.editor.root,this.surface,true);this.mount(this.compare.root,this.surface,true);this.mount(this.sampler.adachiWorkbench.root,this.params);
  // The dock can wrap on narrow screens or with long history labels. Keep
  // crop/result controls above its measured height instead of a fixed offset.
  const dockObserver=new ResizeObserver(()=>{
   this.root.style.setProperty('--aw-history-height',`${this.footer.getBoundingClientRect().height}px`);
   const crop=this.editorNode.adachiCrop?.bar;
   if(crop)this.root.style.setProperty('--aw-crop-height',`${crop.getBoundingClientRect().height}px`);
  });
  dockObserver.observe(this.footer);if(this.editorNode.adachiCrop?.bar)dockObserver.observe(this.editorNode.adachiCrop.bar);
  this.disposers.push(()=>dockObserver.disconnect());
  const editorWheel=this.editor.options.onGraphWheel,compareWheel=this.compare.options.onGraphWheel;
  this.editor.options.onGraphWheel=()=>{};this.compare.options.onGraphWheel=()=>{};
  this.disposers.push(()=>{this.editor.options.onGraphWheel=editorWheel;this.compare.options.onGraphWheel=compareWheel;});
  this.bindings=new WorkspaceBindings({graph:this.graph,sampler:this.sampler,onChange:()=>this.scheduleCheck(),markChanged:()=>{app.canvas?.emitBeforeChange?.();app.canvas?.emitAfterChange?.();}});
  this.settings.append(this.bindings.createPanel());
  this.bindings.loadCatalog(api.fetchApi.bind(api)).then(()=>this.scheduleCheck()).catch(e=>this.setStatus(e.message,'error'));
  const oldAdopt=this.compare.options.onAdopt;
  this.compare.options.onAdopt=(...args)=>this.history.transact('采用重绘结果',()=>oldAdopt(...args));
  this.disposers.push(()=>{this.compare.options.onAdopt=oldAdopt;});
  const oldLoad=this.compare.loadSelected;
  this.compare.loadSelected=async(...args)=>{const result=await oldLoad.apply(this.compare,args);if(!this.closed){this.show(this.view||'edit');this.updateButtons();}return result;};
  this.disposers.push(()=>{this.compare.loadSelected=oldLoad;});
  const oldUpload=this.editor.upload;
  this.editor.upload=async(...args)=>{await oldUpload(...args);if(this.editor.ready&&!this.closed){await this.history.checkpoint('上传原图');this.syncHistory();this.scheduleCheck();}};
  this.disposers.push(()=>{this.editor.upload=oldUpload;});
  const onExecuted=this.compareNode.onExecuted;
  this.compareNode.onExecuted=(output)=>{const ret=onExecuted?.call(this.compareNode,output);if(output?.adachi_results?.length){this.show('compare');this.note.textContent='';this.updateButtons();}return ret;};
  this.disposers.push(()=>{this.compareNode.onExecuted=onExecuted;});
  const event=(name,fn)=>{api.addEventListener(name,fn);this.disposers.push(()=>api.removeEventListener(name,fn));};
  event('progress',e=>{if(this.running&&(!e.detail.prompt_id||e.detail.prompt_id===this.promptId))this.setStatus(`正在生成 ${e.detail.value} / ${e.detail.max}`);});
  const recovered=e=>{if(e.detail.node!==this.compareNode || e.detail.promptId!==this.promptId)return;this.running=false;this.sampler.adachiWorkspaceTask=null;this.runButton.disabled=false;this.runButton.textContent='生成';this.setStatus(e.detail.entry.status?.status_str==='success'?'生成完成':'生成失败，请查看 ComfyUI 任务历史',e.detail.entry.status?.status_str==='success'?'ok':'error');this.updateButtons();};
  document.addEventListener('adachi-result-recovered',recovered);this.disposers.push(()=>document.removeEventListener('adachi-result-recovered',recovered));
  for(const name of ['execution_success','execution_error','execution_interrupted'])event(name,e=>{if(e.detail.prompt_id===this.promptId){this.running=false;this.sampler.adachiWorkspaceTask=null;this.runButton.disabled=false;this.runButton.textContent='生成';this.setStatus(name==='execution_success'?'生成完成':e.detail.exception_message||'生成已停止',name==='execution_success'?'ok':'error');}});
  this.timer=setInterval(()=>{if(app.graph!==this.graph||this.editor.destroyed)this.close();else this.updateButtons();},500);
  this.pollTimer=setInterval(()=>this.pollResult(),2500);
  this.promptId=this.sampler.adachiWorkspaceTask;this.running=!!this.promptId;if(this.running){this.compareNode.adachiTrackPrompt?.(this.promptId);this.runButton.disabled=true;this.runButton.textContent='生成中…';}this.show('edit');this.syncHistory();this.scheduleCheck();
 }
 syncHistory(){if(!this.history)return;this.historySelect.replaceChildren();this.history.entries.forEach((item,i)=>{const o=el('option',`${i+1} · ${item.label}`);o.value=i;this.historySelect.append(o);});this.historySelect.value=String(this.history.index);this.undoButton.disabled=!this.history.canUndo;this.originalButton.disabled=this.history.index===0;}
 updateButtons(){const busy=this.running||this.preparing;this.adoptButton.disabled=!this.compare?.ready||!!this.compare?.busy||this.compare?.pendingOutputs>0||busy;this.tabs.compare.disabled=!this.compare?.ready;this.sideButton.disabled=!this.compare?.ready;if(!this.preparing)this.bindings?.refreshProfiles();if(this.editor)this.editor.root.inert=!!busy;this.settings.inert=!!busy;this.params.inert=!!busy;this.historySelect.disabled=busy||!!this.history?.busy;this.undoButton.disabled=busy||!this.history?.canUndo;this.originalButton.disabled=busy||this.history?.index<=0;if(this.compare?.adoptButton)this.compare.adoptButton.disabled=this.adoptButton.disabled;}
 show(which){this.view=which;if(this.editor)this.editor.root.hidden=which!=='edit';if(this.compare)this.compare.root.hidden=which!=='compare';this.still.hidden=!['before','after'].includes(which);if(!this.still.hidden){const image=which==='before'?this.compare?.before:this.compare?.after;if(image)this.still.src=image.src;}for(const [id,b]of Object.entries(this.tabs)){b.classList.toggle('active',id===which);b.setAttribute('aria-pressed',String(id===which));}this.sideButton.classList.toggle('active',['before','after'].includes(which));this.sideButton.setAttribute('aria-pressed',String(which==='before'));this.sideButton.title=which==='before'?'查看后图':'查看前图';this.sideButton.setAttribute('aria-label',this.sideButton.title);this.editor?.schedule();this.compare?.schedule();}
 async adopt(){if(!this.compare?.ready||this.running)return;await this.compare.adopt();this.syncHistory();this.updateButtons();if(!this.compare.message.classList.contains('dd-error')){this.show('compare');this.note.textContent='';this.scheduleCheck();}}
 async restoreHistory(which){try{if(this.running||this.history?.busy)return;if(which==='undo')await this.history.undo();else if(which==='original')await this.history.original();else await this.history.restore(which);this.syncHistory();}catch(e){this.setStatus(e.message,'error');}}
 scheduleCheck(){clearTimeout(this.checkTimer);this.checkTimer=setTimeout(()=>this.check(),200);}
 prepare(){
  const task=(this.prepareTask||Promise.resolve()).catch(()=>{}).then(async()=>{
   if(this.closed||app.graph!==this.graph)throw Error('工作流已切换');
   if(!this.editor?.ready)throw Error('请先上传原图');
   const binding=this.bindings.getExecutionBinding();
   this.preparing=true;this.updateButtons();
   try{return await prepareWorkspacePrompt({editorNode:this.editorNode,samplerNode:this.sampler,compareNode:this.compareNode,binding});}
   finally{this.preparing=false;if(!this.closed)this.updateButtons();}
  });
  this.prepareTask=task;return task;
 }
 async check(){const version=++this.checkVersion;if(this.closed||this.running)return false;this.setStatus('后台检查中…');try{const prepared=await this.prepare();const result=await validateWorkspace(prepared);if(this.closed||version!==this.checkVersion)return false;if(result.valid===false||result.ok===false)throw Error(result.error?.message||result.error||'工作流检查未通过');this.setStatus('检查通过 · 可以生成','ok');return true;}catch(e){if(version===this.checkVersion)this.setStatus(e.message||String(e),'error');return false;}}
 async run() {
  if(this.running)return;
  this.runButton.disabled=true; this.runButton.textContent='检查中…';
  const seed=this.sampler?.widgets?.find(w=>w.name==='seed'), oldSeed=seed?.value;
  try {
   for(const widget of this.sampler.widgets || []) widget.beforeQueued?.();
   const prepared=await this.prepare();
   await validateWorkspace(prepared);
   if(this.closed)return;
   this.running=true; this.updateButtons();
   const queued=await submitWorkspace(prepared);
   this.promptId=queued.prompt_id;
   this.compareNode.adachiTrackPrompt?.(this.promptId);
   this.sampler.adachiWorkspaceTask=this.promptId;
   for(const widget of this.sampler.widgets || []) widget.afterQueued?.();
   this.sampler.adachiParameters.refresh();
   this.runButton.textContent='生成中…'; this.setStatus('已进入生成队列');
  } catch(e) {
   this.running=false;
   if(seed)seed.value=oldSeed;
   this.setStatus(e.message||String(e),'error');
  } finally {
   if(!this.running){this.runButton.disabled=false;this.runButton.textContent='生成';}
   this.updateButtons();
  }
 }

 async pollResult(){if(!this.running||!this.promptId||this.polling||this.closed)return;this.polling=true;try{const r=await api.fetchApi(`/history/${encodeURIComponent(this.promptId)}`);if(!r.ok)return;const all=await r.json(),entry=all[this.promptId];if(!entry?.status?.completed)return;const output=entry.outputs?.[String(this.compareNode.id)];if(output)this.compareNode.onExecuted(output);this.running=false;this.sampler.adachiWorkspaceTask=null;this.runButton.disabled=false;this.runButton.textContent='生成';this.setStatus(entry.status.status_str==='success'?'生成完成':'生成失败，请查看 ComfyUI 错误信息',entry.status.status_str==='success'?'ok':'error');}catch{}finally{this.polling=false;}}
 close(){if(this.closed)return;this.closed=true;++this.checkVersion;clearInterval(this.timer);clearInterval(this.pollTimer);clearTimeout(this.checkTimer);for(const dispose of this.disposers.reverse())dispose();if(this.history){this.history.onChange=null;this.history.onRestore=null;}this.bindings?.destroy();for(const {element,marker,style}of this.mounts.reverse()){element.classList.remove('aw-embedded');element.hidden=false;element.inert=false;if(marker.parentNode)marker.replaceWith(element);if(style===null)element.removeAttribute('style');else element.setAttribute('style',style);}this.root.remove();document.body.classList.remove('adachi-workspace-open');this.editor?.schedule();this.compare?.schedule();this.compare?.updateButton();currentWorkspace=null;}
}
app.registerExtension({name:'Adachi.InpaintWorkspace',setup(){
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./workspace.css?v=theme3',import.meta.url).href;document.head.append(css);
 document.addEventListener('adachi-open-workspace',event=>{if(!currentWorkspace)currentWorkspace=new Workspace(event.detail?.sampler||null);});
}});
