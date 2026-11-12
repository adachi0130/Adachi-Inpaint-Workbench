import {T} from './i18n.js';
import {inspectExecutionFlow,executionNode,executionId,graphNodeEntries} from './workspace_flow.js';
// Bind the workbench to existing graph widgets; no model or LoRA is loaded here.
const widget = (node, name) => node?.widgets?.find(w => w.name === name);
const nodeList = graph => graphNodeEntries(graph).map(entry=>entry.node);
const ref = (node, slot = 0) => [String(node.id), slot];
const valueList = w => {
    const values = typeof w?.options?.values === 'function' ? w.options.values() : w?.options?.values;
    return Array.isArray(values) ? values.map(String) : [];
};
const stateKey = 'adachi_workspace_bindings';
const presetController=(nodes,sampler,graph)=>{
    const saved=sampler.properties?.adachi_workspace_connections;
    if(saved && Object.hasOwn(saved,'controllerId'))return nodes.find(n=>n.type==='AdachiGroupPresets'&&n.mode===0&&executionId(graph,n)===saved.controllerId)?.adachiGroupPresets?.model;
    const active=nodes.filter(n=>n.type==='AdachiGroupPresets'&&n.mode===0),local=active.filter(n=>n.graph===sampler.graph),pool=local.length?local:active;
    return pool.length===1?pool[0].adachiGroupPresets?.model:undefined;
};

export class WorkspaceBindings {
    constructor({graph, sampler, canvas, onChange = () => {}, markChanged = () => {}}) {
        Object.assign(this, {graph, sampler, canvas, onChange, markChanged});
        this.nodes = nodeList(graph);
        this.controller = presetController(this.nodes,sampler,graph);
        this.owner = this.controller?.node || sampler;
        this.owner.properties ??= {};
        this.owner.properties[stateKey] ??= {profiles:{}};
        this.catalog = {checkpoints:[], unets:[], ggufs:[], clipggufs:[], clips:[], vaes:[], loras:[]};
        this.catalogReady = new Set();
        this.profiles = this.controller?.data?.presets?.map(p => ({id:p.id, name:p.name, preset:p})) || [];
        if (!this.profiles.length) this.profiles = [{id:'current',name:T("Current workflow")}];
        this.profileId = this.controller?.data?.activeId || this.profiles[0].id;
        this.resolve();
    }
    resolve() {
        const profile=this.profiles.find(p=>p.id===this.profileId)||this.profiles[0];this.profileId=profile.id;
        const all=this.owner.properties[stateKey].profiles;
        if(!all[this.profileId])all[this.profileId]={loraMode:'inherit',loras:[],useRefiner:!!this.sampler.inputs?.find(i=>i.name==='refiner_model'&&i.link!=null)};
        this.settings=all[this.profileId];this.settings.loras??=[];
        // Retain explicit selections made in older versions without retaining
        // any of the old template IDs or model-family name matching.
        this.settings.loraMode??='override';
        this.settings.textOverrides??={};
        if(this.compiledProfileId===this.profileId)this.updateExecutionGraph(this.compiled,this.samplerId,false);
        else {this.flow=null;this.model=this.clip=this.vae=this.positive=this.negative=this.lora=null;this.promptSources={positive:T("Reading workflow connections"),negative:T("Reading workflow connections")};}
        return profile;
    }
    updateExecutionGraph(output,samplerId=executionId(this.graph,this.sampler),render=true) {
        this.compiled=output;this.compiledProfileId=this.profileId;this.samplerId=String(samplerId);
        this.flow=inspectExecutionFlow(output,this.samplerId,id=>executionNode(this.graph,id));
        this.model=this.flow.modelNodes[0]?.node||null;this.clip=this.flow.clipNodes[0]?.node||null;this.vae=this.flow.vaeNodes[0]?.node||null;
        this.positive=this.flow.encoders.positive.length===1?this.flow.encoders.positive[0].node:null;
        this.negative=this.flow.encoders.negative.length===1?this.flow.encoders.negative[0].node:null;
        this.lora=this.flow.loras[0]?.node||null;
        this.promptSources={positive:T("Actual sampler connections"),negative:T("Actual sampler connections")};
        const signature=JSON.stringify([this.profileId,this.flow.refs,[...this.flow.modelNodes,...this.flow.clipNodes,...this.flow.vaeNodes].map(e=>e.id),Object.entries(this.flow.encoders).map(([kind,items])=>[kind,items.map(e=>[e.id,e.fields])])]);
        // Do not replace a focused textarea for ordinary background validation.
        if(render && signature!==this.routingSignature){this.routingSignature=signature;this.render();}
    }
    changed() { this.markChanged(); this.onChange(this); }
    modelDependencies() {
        const specs={CheckpointLoader:['ckpt_name','checkpoints',T("Main model"),'checkpoints'],CheckpointLoaderSimple:['ckpt_name','checkpoints',T("Main model"),'checkpoints'],
            UNETLoader:['unet_name','unets',T("Main model"),'diffusion_models'],
            UNETLoaderGGUF:['unet_name','ggufs',T("Main model"),'diffusion_models'],
            CLIPLoader:['clip_name','clips',T("Text encoder"),'text_encoders'],
            CLIPLoaderGGUF:['clip_name','clipggufs',T("Text encoder"),'text_encoders'],
            VAELoader:['vae_name','vaes','VAE','vae']};
        const entries=this.flow?[...this.flow.modelNodes,...this.flow.clipNodes,...this.flow.vaeNodes]:[];
        const unique=entries.filter((e,i,all)=>all.findIndex(x=>x.id===e.id)===i);
        return unique.flatMap(entry=>{
            const node=entry.node;
            if(['DualCLIPLoader','TripleCLIPLoader','DualCLIPLoaderGGUF'].includes(node?.type))return [1,2,3].flatMap(index=>{const w=widget(node,'clip_name'+index);return w?[{...entry,widget:w,key:node.type.endsWith('GGUF')?'clipggufs':'clips',label:T("Text encoder {index}",{index}),folder:'text_encoders'}]:[];});
            const spec=specs[node?.type];if(!spec)return [];
            const [name,key,label,folder]=spec,w=widget(node,name);
            if(w)return [{...entry,widget:w,key,label,folder}];
            return [];
        });
    }
    missingDependencies() {
        return this.modelDependencies().filter(d=>this.catalogReady.has(d.key) && d.widget.value && !this.catalog[d.key].includes(String(d.widget.value)));
    }
    refreshProfiles() {
        this.nodes=nodeList(this.graph);
        const controller = presetController(this.nodes,this.sampler,this.graph);
        const signature = JSON.stringify([controller?.node?.id, controller?.data?.activeId, controller?.data?.presets?.map(p=>[p.id,p.name])]);
        if(signature===this.presetSignature)return;
        this.presetSignature=signature;
        this.controller=controller;
        this.owner=controller?.node || this.sampler;
        this.owner.properties ??= {};
        this.owner.properties[stateKey] ??= {profiles:{}};
        this.profiles=controller?.data?.presets?.map(p=>({id:p.id,name:p.name,preset:p})) || [];
        if(!this.profiles.length)this.profiles=[{id:'current',name:T("Current workflow")}];
        this.profileId=controller?.data?.activeId || (this.profiles.some(p=>p.id===this.profileId)?this.profileId:this.profiles[0].id);
        this.resolve();this.render();this.onChange(this);
    }
    selectProfile(id) {
        if (!this.profiles.some(p=>p.id===id)) throw Error(T("The group preset no longer exists"));
        this.profileId=id;
        this.controller?.apply(id);
        this.resolve(); this.render(); this.changed();
    }
    getExecutionBinding() {
        const binding={samplerInputs:{},inputOverrides:{},removeInputs:{},
            loraMode:this.settings.loraMode,loras:this.settings.loras,clipConsumers:this.flow?.clipConsumers||[]};
        if(!this.flow)throw Error(T("Reading workflow connections; please wait"));
        // Final MODEL and CONDITIONING refs remain untouched, including custom
        // model patches, ControlNet and combinations of multiple encoders.
        for(const [kind,entries] of Object.entries(this.flow.encoders))for(const entry of entries)for(const field of entry.fields){
            const target=this.settings.textOverrides[entry.id]||{};
            const legacy=entries.length===1 && field==='text' && Object.hasOwn(this.settings,kind);
            if(Object.hasOwn(target,field)||legacy){binding.inputOverrides[entry.id]??={};binding.inputOverrides[entry.id][field]=Object.hasOwn(target,field)?target[field]:this.settings[kind];}
        }
        if(!this.settings.useRefiner || Number(widget(this.sampler,'refiner_switch')?.value??1)>=1)binding.removeInputs[this.samplerId]=['refiner_model','refiner_positive','refiner_negative'];
        return binding;
    }
    async loadCatalog(fetchApi) {
        this.catalogController?.abort();const controller=this.catalogController=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        const get = async path => {const r=await fetchApi(path,{signal:controller.signal});if(!r.ok)throw Error(T("Model list request failed ({status})",{status:r.status}));return r.json();};
        const sources=[['checkpoints','/object_info/CheckpointLoaderSimple','CheckpointLoaderSimple','ckpt_name'],
            ['unets','/object_info/UNETLoader','UNETLoader','unet_name'],
            ['clips','/object_info/CLIPLoader','CLIPLoader','clip_name'],
            ['vaes','/object_info/VAELoader','VAELoader','vae_name'],['loras','/models/loras']];
        let results;try{results=await Promise.allSettled(sources.map(([,path])=>get(path)));}finally{clearTimeout(timer);}
        if(this.destroyed || this.catalogController!==controller)return;
        results.forEach((result,i)=>{if(result.status!=='fulfilled')return;const [key,,type,input]=sources[i];
            const values=type?result.value?.[type]?.input?.required?.[input]?.[0]:result.value;
            if(Array.isArray(values)){this.catalog[key]=values.map(String);this.catalogReady.add(key);}
        });
        this.catalogError=results.some(r=>r.status==='rejected')?T("Some model lists are unavailable; existing workflow selections remain usable"):'';
        this.render();
    }
    createPanel() { this.root=document.createElement('section');this.root.className='aw-bindings';this.render();return this.root; }
    render() {
        if(!this.root || this.destroyed)return;
        const doc=this.root.ownerDocument;
        const active=doc.activeElement;
        const focus=active?.tagName==='TEXTAREA' && this.root.contains(active)?{
            id:active.dataset.executionId,field:active.dataset.widget,
            start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,scroll:active.scrollTop,
        }:null;
        const el=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
        const row=(label,control)=>{const l=el('label',label);l.append(control);return l;};
        const select=(values,current,change)=>{const s=el('select');for(const [value,label] of values){const o=el('option',label);o.value=value;s.append(o);}s.value=current;s.onchange=()=>change(s.value);return s;};
        this.root.replaceChildren();
        const presets=el('div');presets.className='aw-presets';
        const controllerActive = this.controller && this.controller.node.mode === 0;
        if (!controllerActive) {const multiple=this.nodes.filter(n=>n.type==='AdachiGroupPresets'&&n.mode===0).length>1;const warning=el('p',multiple?T("Multiple group preset controllers found; choose one in Workflow connections."):T("No enabled Group Bypass Presets node; using the current workflow settings."));warning.className='aw-profile-warning';warning.setAttribute('role','status');this.root.append(warning);}
        for(const p of controllerActive ? this.profiles : []){const b=el('button',p.name);b.type='button';b.setAttribute('aria-pressed',String(p.id===this.profileId));b.onclick=()=>this.selectProfile(p.id);presets.append(b);}
        this.root.append(presets);
        const missing=this.missingDependencies();
        if(missing.length){const warning=el('details'),head=el('summary',T("Missing {count} model files",{count:missing.length}));warning.className='aw-model-warning';warning.title=missing.map(d=>T("{label}: {value}",{label:d.label,value:d.widget.value})).join('\n');warning.append(head);
            const list=el('ul');for(const d of missing){const item=el('li',T("{label}: {value}",{label:d.label,value:d.widget.value}));item.append(el('small',`ComfyUI/models/${d.folder}/`));list.append(item);}warning.append(list);this.root.append(warning);}
        const details=el('details'),summary=el('summary',T("Main model and LoRA"));details.append(summary);details.open=!!this.detailsOpen;details.ontoggle=()=>{this.detailsOpen=details.open;};
        const dependencies=this.modelDependencies();
        for(const d of dependencies){const w=d.widget,current=String(w.value||'');const values=[...new Set([...valueList(w),...this.catalog[d.key],current])].filter(Boolean);
            const label=dependencies.filter(x=>x.label===d.label).length>1?`${d.label} · ${d.node.title||d.node.type} #${d.id}`:d.label;const field=row(label,select(values.map(v=>[v,v]),current,v=>{w.value=v;w.callback?.(v,this.canvas,d.node);this.render();this.changed();}));field.title=`ComfyUI/models/${d.folder}/`;details.append(field);}
        if(!dependencies.some(d=>d.node===this.model))details.append(el('p',T("This profile uses the model from the workflow")));
        const loraTitle=el('div','LoRA');details.append(loraTitle);
        const inherit=el('input');inherit.type='checkbox';inherit.checked=this.settings.loraMode==='inherit';inherit.onchange=()=>{this.settings.loraMode=inherit.checked?'inherit':'override';this.render();this.changed();};const inheritRow=row(T("Inherit workflow LoRAs"),inherit);inheritRow.title=T("Keep existing LoRA nodes and both CLIP branches; uncheck to use the custom list below. An empty custom list disables recognized LoRAs.");details.append(inheritRow);
        if(inherit.checked){
            const active=[];for(const entry of this.flow?.loras||[]){const input=entry.api.inputs||{};if(entry.api.class_type==='Power Lora Loader (rgthree)'){for(const value of Object.values(input))if(value?.on && value.lora)active.push(`${value.lora} · ${value.strength??1}`);}else if(input.lora_name && (Number(input.strength_model)||Number(input.strength_clip)))active.push(`${input.lora_name} · ${input.strength_model??1}`);}
            const info=el('small',active.length?active.join(' / '):T("No active LoRAs in the original workflow"));info.title=active.join('\n');details.append(info);
        }
        const customLoras=el('div');customLoras.hidden=inherit.checked;details.append(customLoras);

        if(!this.settings.loras.length)customLoras.append(el('small',T("No LoRA")));
        this.settings.loras.forEach((l,index)=>{
            const line=el('div');line.className='aw-lora-row';
            const names=[...new Set([...this.catalog.loras,l.name].filter(Boolean))];
            const pick=select([['',T("None")],...names.map(n=>[n,n])],l.name||'',v=>{l.name=v;this.changed();});pick.setAttribute('aria-label',T("LoRA {index}",{index:index+1}));
            const strength=el('input');strength.type='number';strength.min='-10';strength.max='10';strength.step='0.05';strength.value=l.strength??1;strength.setAttribute('aria-label',T("LoRA {index} strength",{index:index+1}));strength.onchange=()=>{const n=Number(strength.value);if(Number.isFinite(n)){l.strength=Math.max(-10,Math.min(10,n));strength.value=l.strength;this.changed();}};
            const remove=el('button','×');remove.type='button';remove.title=T("Remove this LoRA");remove.onclick=()=>{this.settings.loras.splice(index,1);this.render();this.changed();};
            line.append(pick,strength,remove);customLoras.append(line);
        });
        const add=el('button',T("＋ Add LoRA"));add.type='button';add.disabled=!this.flow?.refs.model;add.onclick=()=>{this.settings.loras.push({name:'',strength:1});this.render();this.changed();};customLoras.append(add);
        const refiner=el('input');refiner.type='checkbox';refiner.checked=!!this.settings.useRefiner;
        refiner.onchange=()=>{this.settings.useRefiner=refiner.checked;this.changed();};
        details.append(row(T("Use the workflow Refiner (must be compatible with the main model)"),refiner));
        if(this.catalogError)details.append(el('small',this.catalogError));
        this.root.append(details);
        for(const [kind,label] of [['positive',T("Positive prompt")],['negative',T("Negative prompt")]]) {
            const entries=this.flow?.encoders[kind]||[];
            const container=el('details');container.className='aw-prompt-section';container.dataset.promptKind=kind;
            container.append(el('summary',entries.length>1?T("{label} · {count} encoders",{label,count:entries.length}):label));
            const savedOpen=this.sampler.properties?.adachi_workspace_ui?.promptOpen?.[kind];
            let lastOpen=typeof savedOpen==='boolean'?savedOpen:entries.length<=1;
            container.open=lastOpen;
            container.ontoggle=()=>{
                // Native <details> emits asynchronous toggle events even when
                // open is initialized programmatically or an old panel is removed.
                if(!container.isConnected || container.open===lastOpen)return;
                lastOpen=container.open;this.sampler.properties??={};
                let ui=this.sampler.properties.adachi_workspace_ui;
                if(!ui || typeof ui!=='object' || Array.isArray(ui))ui=this.sampler.properties.adachi_workspace_ui={};
                if(!ui.promptOpen || typeof ui.promptOpen!=='object' || Array.isArray(ui.promptOpen))ui.promptOpen={};
                ui.promptOpen[kind]=lastOpen;this.markChanged();
            };
            this.root.append(container);
            if(!entries.length){const info=el('p',this.flow?T("Controlled by the original workflow"):T("Reading connections…"));info.title=T("Encoders are identified from the execution graph; unrecognized conditioning stays controlled by the original workflow");container.append(info);continue;}
            for(const entry of entries)for(const name of entry.fields){
                const w=widget(entry.node,name),linked=Array.isArray(entry.api.inputs?.[name]);
                const saved=this.settings.textOverrides[entry.id]||{},legacy=entries.length===1&&name==='text'?this.settings[kind]:undefined;
                const text=el('textarea');text.rows=kind==='positive'?6:3;
                text.value=saved[name]??legacy??(linked?'':w?.value??entry.api.inputs?.[name]??'');
                text.placeholder=linked?T("Inherit upstream dynamic text; type to override"):'';
                text.dataset.executionId=entry.id;text.dataset.widget=name;
                text.oninput=()=>{this.settings.textOverrides[entry.id]??={};this.settings.textOverrides[entry.id][name]=text.value;this.changed();};
                const title=entries.length>1||entry.fields.length>1?`${label} · ${entry.node?.title||entry.api.class_type} · ${name}`:label;
                text.setAttribute('aria-label',title);const field=row(entries.length===1&&entry.fields.length===1?'':title,text);
                field.title=T("Actual sampler connections · {node} #{id} · {field}. {description}",{node:entry.node?.title||entry.api.class_type,id:entry.id,field:name,description:linked?T("Text comes from upstream; typing creates an override."):T("Changes affect only this encoder; downstream conditioning is preserved.")});
                const reset=el('button','↶');reset.type='button';reset.title=T("Restore {label} from the workflow",{label:title});reset.onclick=()=>{delete this.settings.textOverrides[entry.id]?.[name];if(entries.length===1&&name==='text')delete this.settings[kind];this.render();this.changed();};field.append(reset);container.append(field);
            }
        }
        // Catalog and route discovery can re-render the panel asynchronously.
        // Restore the active prompt and caret only when that field still exists
        // and is visible; switching profile or closing a fold must not steal focus.
        if(focus){
            const target=[...this.root.querySelectorAll('textarea')].find(el=>el.dataset.executionId===focus.id && el.dataset.widget===focus.field);
            if(target && !target.closest('details:not([open])')){
                target.focus({preventScroll:true});
                target.setSelectionRange(focus.start,focus.end,focus.direction);target.scrollTop=focus.scroll;
            }
        }
    }
    destroy() {this.destroyed=true;this.catalogController?.abort();this.root?.remove();}
}
