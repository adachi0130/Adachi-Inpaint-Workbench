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
        if (!this.profiles.length) this.profiles = [{id:'current',name:'当前工作流'}];
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
        else {this.flow=null;this.model=this.clip=this.vae=this.positive=this.negative=this.lora=null;this.promptSources={positive:'正在读取工作流连接',negative:'正在读取工作流连接'};}
        return profile;
    }
    updateExecutionGraph(output,samplerId=executionId(this.graph,this.sampler),render=true) {
        this.compiled=output;this.compiledProfileId=this.profileId;this.samplerId=String(samplerId);
        this.flow=inspectExecutionFlow(output,this.samplerId,id=>executionNode(this.graph,id));
        this.model=this.flow.modelNodes[0]?.node||null;this.clip=this.flow.clipNodes[0]?.node||null;this.vae=this.flow.vaeNodes[0]?.node||null;
        this.positive=this.flow.encoders.positive.length===1?this.flow.encoders.positive[0].node:null;
        this.negative=this.flow.encoders.negative.length===1?this.flow.encoders.negative[0].node:null;
        this.lora=this.flow.loras[0]?.node||null;
        this.promptSources={positive:'实际采样器连线',negative:'实际采样器连线'};
        const signature=JSON.stringify([this.profileId,this.flow.refs,[...this.flow.modelNodes,...this.flow.clipNodes,...this.flow.vaeNodes].map(e=>e.id),Object.entries(this.flow.encoders).map(([kind,items])=>[kind,items.map(e=>[e.id,e.fields])])]);
        // Do not replace a focused textarea for ordinary background validation.
        if(render && signature!==this.routingSignature){this.routingSignature=signature;this.render();}
    }
    changed() { this.markChanged(); this.onChange(this); }
    modelDependencies() {
        const specs={CheckpointLoader:['ckpt_name','checkpoints','主模型','checkpoints'],CheckpointLoaderSimple:['ckpt_name','checkpoints','主模型','checkpoints'],
            UNETLoader:['unet_name','unets','主模型','diffusion_models'],
            UNETLoaderGGUF:['unet_name','ggufs','主模型','diffusion_models'],
            CLIPLoader:['clip_name','clips','文本编码器','text_encoders'],
            CLIPLoaderGGUF:['clip_name','clipggufs','文本编码器','text_encoders'],
            VAELoader:['vae_name','vaes','VAE','vae']};
        const entries=this.flow?[...this.flow.modelNodes,...this.flow.clipNodes,...this.flow.vaeNodes]:[];
        const unique=entries.filter((e,i,all)=>all.findIndex(x=>x.id===e.id)===i);
        return unique.flatMap(entry=>{
            const node=entry.node;
            if(['DualCLIPLoader','TripleCLIPLoader','DualCLIPLoaderGGUF'].includes(node?.type))return [1,2,3].flatMap(index=>{const w=widget(node,'clip_name'+index);return w?[{...entry,widget:w,key:node.type.endsWith('GGUF')?'clipggufs':'clips',label:'文本编码器 '+index,folder:'text_encoders'}]:[];});
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
        if(!this.profiles.length)this.profiles=[{id:'current',name:'当前工作流'}];
        this.profileId=controller?.data?.activeId || (this.profiles.some(p=>p.id===this.profileId)?this.profileId:this.profiles[0].id);
        this.resolve();this.render();this.onChange(this);
    }
    selectProfile(id) {
        if (!this.profiles.some(p=>p.id===id)) throw Error('分组预设不存在');
        this.profileId=id;
        this.controller?.apply(id);
        this.resolve(); this.render(); this.changed();
    }
    getExecutionBinding() {
        const binding={samplerInputs:{},inputOverrides:{},removeInputs:{},
            loraMode:this.settings.loraMode,loras:this.settings.loras,clipConsumers:this.flow?.clipConsumers||[]};
        if(!this.flow)throw Error('正在读取工作流连接，请稍候');
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
        const get = async path => {const r=await fetchApi(path);if(!r.ok)throw Error(`模型列表加载失败（${r.status}）`);return r.json();};
        const sources=[['checkpoints','/object_info/CheckpointLoaderSimple','CheckpointLoaderSimple','ckpt_name'],
            ['unets','/object_info/UNETLoader','UNETLoader','unet_name'],
            ['clips','/object_info/CLIPLoader','CLIPLoader','clip_name'],
            ['vaes','/object_info/VAELoader','VAELoader','vae_name'],['loras','/models/loras']];
        const results=await Promise.allSettled(sources.map(([,path])=>get(path)));
        if(this.destroyed)return;
        results.forEach((result,i)=>{if(result.status!=='fulfilled')return;const [key,,type,input]=sources[i];
            const values=type?result.value?.[type]?.input?.required?.[input]?.[0]:result.value;
            if(Array.isArray(values)){this.catalog[key]=values.map(String);this.catalogReady.add(key);}
        });
        this.catalogError=results.some(r=>r.status==='rejected')?'部分模型列表不可用，可保留工作流中的现有选择':'';
        this.render();
    }
    createPanel() { this.root=document.createElement('section');this.root.className='aw-bindings';this.render();return this.root; }
    render() {
        if(!this.root || this.destroyed)return;
        const doc=this.root.ownerDocument;
        const el=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
        const row=(label,control)=>{const l=el('label',label);l.append(control);return l;};
        const select=(values,current,change)=>{const s=el('select');for(const [value,label] of values){const o=el('option',label);o.value=value;s.append(o);}s.value=current;s.onchange=()=>change(s.value);return s;};
        this.root.replaceChildren();
        const presets=el('div');presets.className='aw-presets';
        const controllerActive = this.controller && this.controller.node.mode === 0;
        if (!controllerActive) {const multiple=this.nodes.filter(n=>n.type==='AdachiGroupPresets'&&n.mode===0).length>1;const warning=el('p',multiple?'存在多个分组预设控制器，请在工作流连接中选择。':'未启用组忽略预设节点，当前使用原工作流设置。');warning.className='aw-profile-warning';warning.setAttribute('role','status');this.root.append(warning);}
        for(const p of controllerActive ? this.profiles : []){const b=el('button',p.name);b.type='button';b.setAttribute('aria-pressed',String(p.id===this.profileId));b.onclick=()=>this.selectProfile(p.id);presets.append(b);}
        this.root.append(presets);
        const missing=this.missingDependencies();
        if(missing.length){const warning=el('details'),head=el('summary',`缺少 ${missing.length} 份模型文件`);warning.className='aw-model-warning';warning.title=missing.map(d=>`${d.label}：${d.widget.value}`).join('\n');warning.append(head);
            const list=el('ul');for(const d of missing){const item=el('li',`${d.label}：${d.widget.value}`);item.append(el('small',`ComfyUI/models/${d.folder}/`));list.append(item);}warning.append(list);this.root.append(warning);}
        const details=el('details'),summary=el('summary','主模型与 LoRA');details.append(summary);details.open=!!this.detailsOpen;details.ontoggle=()=>{this.detailsOpen=details.open;};
        const dependencies=this.modelDependencies();
        for(const d of dependencies){const w=d.widget,current=String(w.value||'');const values=[...new Set([...valueList(w),...this.catalog[d.key],current])].filter(Boolean);
            const label=dependencies.filter(x=>x.label===d.label).length>1?`${d.label} · ${d.node.title||d.node.type} #${d.id}`:d.label;const field=row(label,select(values.map(v=>[v,v]),current,v=>{w.value=v;w.callback?.(v,this.canvas,d.node);this.render();this.changed();}));field.title=`ComfyUI/models/${d.folder}/`;details.append(field);}
        if(!dependencies.some(d=>d.node===this.model))details.append(el('p','当前方案的模型由原工作流控制'));
        const loraTitle=el('div','LoRA');details.append(loraTitle);
        const inherit=el('input');inherit.type='checkbox';inherit.checked=this.settings.loraMode==='inherit';inherit.onchange=()=>{this.settings.loraMode=inherit.checked?'inherit':'override';this.render();this.changed();};const inheritRow=row('沿用工作流 LoRA',inherit);inheritRow.title='保留原有 LoRA 节点及正负 CLIP 分支；取消后使用下方自定义列表，空列表即禁用已识别的 LoRA';details.append(inheritRow);
        if(inherit.checked){
            const active=[];for(const entry of this.flow?.loras||[]){const input=entry.api.inputs||{};if(entry.api.class_type==='Power Lora Loader (rgthree)'){for(const value of Object.values(input))if(value?.on && value.lora)active.push(`${value.lora} · ${value.strength??1}`);}else if(input.lora_name && (Number(input.strength_model)||Number(input.strength_clip)))active.push(`${input.lora_name} · ${input.strength_model??1}`);}
            const info=el('small',active.length?active.join(' / '):'原工作流没有启用的 LoRA');info.title=active.join('\n');details.append(info);
        }
        const customLoras=el('div');customLoras.hidden=inherit.checked;details.append(customLoras);

        if(!this.settings.loras.length)customLoras.append(el('small','不使用 LoRA'));
        this.settings.loras.forEach((l,index)=>{
            const line=el('div');line.className='aw-lora-row';
            const names=[...new Set([...this.catalog.loras,l.name].filter(Boolean))];
            const pick=select([['','不使用'],...names.map(n=>[n,n])],l.name||'',v=>{l.name=v;this.changed();});pick.setAttribute('aria-label',`LoRA ${index+1}`);
            const strength=el('input');strength.type='number';strength.min='-10';strength.max='10';strength.step='0.05';strength.value=l.strength??1;strength.setAttribute('aria-label',`LoRA ${index+1} 强度`);strength.onchange=()=>{const n=Number(strength.value);if(Number.isFinite(n)){l.strength=Math.max(-10,Math.min(10,n));strength.value=l.strength;this.changed();}};
            const remove=el('button','×');remove.type='button';remove.title='移除此 LoRA';remove.onclick=()=>{this.settings.loras.splice(index,1);this.render();this.changed();};
            line.append(pick,strength,remove);customLoras.append(line);
        });
        const add=el('button','＋ 添加 LoRA');add.type='button';add.disabled=!this.flow?.refs.model;add.onclick=()=>{this.settings.loras.push({name:'',strength:1});this.render();this.changed();};customLoras.append(add);
        const refiner=el('input');refiner.type='checkbox';refiner.checked=!!this.settings.useRefiner;
        refiner.onchange=()=>{this.settings.useRefiner=refiner.checked;this.changed();};
        details.append(row('使用工作流中的 Refiner（需与主模型兼容）',refiner));
        if(this.catalogError)details.append(el('small',this.catalogError));
        this.root.append(details);
        for(const [kind,label] of [['positive','正面提示词'],['negative','负面提示词']]) {
            const entries=this.flow?.encoders[kind]||[];
            if(!entries.length){const info=el('p',label+'：'+(this.flow?'由原工作流控制':'正在读取连接…'));info.title='通过实际执行图查找编码器；无法明确识别的条件保留原工作流';this.root.append(info);continue;}
            const container=entries.length>1?el('details'):this.root;
            if(entries.length>1){container.append(el('summary',`${label} · ${entries.length} 个编码器`));this.root.append(container);}
            for(const entry of entries)for(const name of entry.fields){
                const w=widget(entry.node,name),linked=Array.isArray(entry.api.inputs?.[name]);
                const saved=this.settings.textOverrides[entry.id]||{},legacy=entries.length===1&&name==='text'?this.settings[kind]:undefined;
                const text=el('textarea');text.rows=kind==='positive'?6:3;
                text.value=saved[name]??legacy??(linked?'':w?.value??entry.api.inputs?.[name]??'');
                text.placeholder=linked?'沿用上游动态文本；输入后覆盖':'';
                text.dataset.executionId=entry.id;text.dataset.widget=name;
                text.oninput=()=>{this.settings.textOverrides[entry.id]??={};this.settings.textOverrides[entry.id][name]=text.value;this.changed();};
                const title=entries.length>1||entry.fields.length>1?`${label} · ${entry.node?.title||entry.api.class_type} · ${name}`:label;
                text.setAttribute('aria-label',title);const field=row(title,text);
                field.title=`实际采样器连线 · ${entry.node?.title||entry.api.class_type} #${entry.id} · ${name}。${linked?'文本来自上游；主动输入才覆盖。':'修改仅影响所选编码器，保留下游条件处理。'}`;
                const reset=el('button','↶');reset.type='button';reset.title='恢复工作流中的'+title;reset.onclick=()=>{delete this.settings.textOverrides[entry.id]?.[name];if(entries.length===1&&name==='text')delete this.settings[kind];this.render();this.changed();};field.append(reset);container.append(field);
            }
        }

    }
    destroy() {this.destroyed=true;this.root?.remove();}
}
