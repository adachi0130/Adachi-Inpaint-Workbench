// Bind the workbench to existing graph widgets; no model or LoRA is loaded here.
const widget = (node, name) => node?.widgets?.find(w => w.name === name);
const nodeList = graph => Array.from(graph?._nodes || []);
const ref = (node, slot = 0) => [String(node.id), slot];
const valueList = w => {
    const values = typeof w?.options?.values === 'function' ? w.options.values() : w?.options?.values;
    return Array.isArray(values) ? values.map(String) : [];
};
const stateKey = 'adachi_workspace_bindings';

export class WorkspaceBindings {
    constructor({graph, sampler, onChange = () => {}, markChanged = () => {}}) {
        Object.assign(this, {graph, sampler, onChange, markChanged});
        this.nodes = nodeList(graph);
        this.controller = this.nodes.find(n => n.type === 'AdachiGroupPresets')?.adachiGroupPresets?.model;
        this.owner = this.controller?.node || sampler;
        this.owner.properties ??= {};
        this.owner.properties[stateKey] ??= {profiles:{}};
        this.catalog = {checkpoints:[], loras:[]};
        this.profiles = this.controller?.data?.presets?.map(p => ({id:p.id, name:p.name, preset:p})) || [];
        if (!this.profiles.length) this.profiles = [{id:'current',name:'当前工作流'}];
        this.profileId = this.profiles.find(p => /wai/i.test(p.name))?.id || this.controller?.data?.activeId || this.profiles[0].id;
        this.resolve();
    }
    resolve() {
        const profile = this.profiles.find(p => p.id === this.profileId) || this.profiles[0];
        this.profileId = profile.id;
        const byId = id => this.nodes.find(n => String(n.id) === String(id));
        const checkpoints = this.nodes.filter(n => ['CheckpointLoaderSimple','UNETLoader','UNETLoaderGGUF'].includes(n.type));
        const wanted = /wai/i.test(profile.name) ? /wai/i : /anima/i.test(profile.name) ? /anima/i : null;
        this.model = checkpoints.find(n => wanted?.test(String(widget(n,'ckpt_name')?.value || widget(n,'unet_name')?.value))) || checkpoints.find(n=>n.mode===0) || checkpoints[0];
        const isTemplate = byId(501)?.type === 'AdachiWebUIInpaint' && byId(518)?.type === 'CheckpointLoaderSimple' && byId(521)?.type === 'CLIPTextEncode';
        this.isTemplate = isTemplate;
        if (isTemplate && /wai/i.test(profile.name)) {
            this.model = byId(518); this.positive = byId(521); this.negative = byId(520);
            this.clip = this.model; this.clipSlot = 1; this.vae = this.model; this.vaeSlot = 2; this.lora = byId(553) || byId(519);
        } else if (isTemplate && /anima/i.test(profile.name)) {
            this.model = byId(359); this.positive = byId(547); this.negative = byId(16);
            this.clip = byId(357); this.clipSlot = 0; this.vae = byId(358); this.vaeSlot = 0; this.lora = byId(360);
        } else {
            const source = name => {
                const link = this.graph.links?.[this.sampler.inputs?.find(i=>i.name===name)?.link];
                return link ? this.graph.getNodeById(link.origin_id) : null;
            };
            this.positive=source('positive');this.negative=source('negative');
            this.clip=this.model?.type==='CheckpointLoaderSimple'?this.model:null;this.clipSlot=1;
            this.vae=this.model?.type==='CheckpointLoaderSimple'?this.model:null;this.vaeSlot=2;
            this.lora=this.nodes.find(n=>n.type==='Power Lora Loader (rgthree)' && n.mode===0) || this.nodes.find(n=>n.type==='LoraLoader' && n.mode===0);
        }
        const all=this.owner.properties[stateKey].profiles;
        all[this.profileId] ??= {loras:[]};
        this.settings=all[this.profileId];
        this.settings.loras ??= [];
        return profile;
    }
    changed() { this.markChanged(); this.onChange(this); }
    selectProfile(id) {
        if (!this.profiles.some(p=>p.id===id)) throw Error('分组预设不存在');
        this.profileId=id;
        this.controller?.apply(id);
        this.resolve(); this.render(); this.changed();
    }
    getExecutionBinding(id=this.profileId) {
        if (id!==this.profileId) { this.profileId=id; this.resolve(); }
        const binding={enableNodes:[],samplerInputs:{},inputOverrides:{},removeInputs:{}};
        const add=node=>{if(node && !binding.enableNodes.includes(node))binding.enableNodes.push(node);};
        // Generic graphs keep their original routing unless complete core
        // model/conditioning nodes can be identified.
        if (!this.model || !this.clip || !this.vae || this.positive?.type!=='CLIPTextEncode' || this.negative?.type!=='CLIPTextEncode') return binding;
        for(const n of [this.model,this.clip,this.vae,this.positive,this.negative])add(n);
        let model=ref(this.model),clip=ref(this.clip,this.clipSlot);
        const selected=this.settings.loras.filter(l=>l.name && l.on!==false);
        if(selected.length) {
            if(!this.lora)throw Error('工作流中没有可用于此方案的 LoRA 加载器');
            add(this.lora);
            const inputs={model,clip};
            if(this.lora.type==='Power Lora Loader (rgthree)') {
                for(const w of this.lora.widgets || [])if(w.value && typeof w.value.lora==='string')inputs[w.name]={...w.value,on:false};
                selected.forEach((l,i)=>{inputs[`lora_${i+1}`]={on:true,lora:l.name,strength:Number(l.strength ?? 1),strengthTwo:Number(l.clipStrength ?? l.strength ?? 1)};});
            } else {
                if(selected.length>1)throw Error('当前普通 LoRA 节点只能选择一个 LoRA');
                Object.assign(inputs,{lora_name:selected[0].name,strength_model:Number(selected[0].strength ?? 1),strength_clip:Number(selected[0].clipStrength ?? selected[0].strength ?? 1)});
            }
            binding.inputOverrides[String(this.lora.id)]=inputs;
            model=ref(this.lora);clip=ref(this.lora,1);
        }
        Object.assign(binding.samplerInputs,{model,vae:ref(this.vae,this.vaeSlot),positive:ref(this.positive),negative:ref(this.negative)});
        for(const [kind,node] of [['positive',this.positive],['negative',this.negative]]) {
            binding.inputOverrides[String(node.id)]={clip};
            if(Object.hasOwn(this.settings,kind))binding.inputOverrides[String(node.id)].text=this.settings[kind];
        }
        // A stale optional refiner link can point into a different model family.
        // The workspace only uses a refiner when staging is explicitly enabled.
        if(!this.settings.useRefiner || Number(widget(this.sampler,'refiner_switch')?.value ?? 1)>=1) binding.removeInputs[String(this.sampler.id)]=['refiner_model','refiner_positive','refiner_negative'];
        return binding;
    }
    async loadCatalog(fetchApi) {
        const get = async path => {const r=await fetchApi(path);if(!r.ok)throw Error(`模型列表加载失败（${r.status}）`);return r.json();};
        const results=await Promise.allSettled([get('/object_info/CheckpointLoaderSimple'),get('/models/loras')]);
        if(this.destroyed)return;
        if(results[0].status==='fulfilled')this.catalog.checkpoints=results[0].value?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        if(results[1].status==='fulfilled')this.catalog.loras=Array.isArray(results[1].value)?results[1].value:[];
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
        for(const p of this.profiles){const b=el('button',p.name);b.type='button';b.setAttribute('aria-pressed',String(p.id===this.profileId));b.onclick=()=>this.selectProfile(p.id);presets.append(b);}
        this.root.append(presets);
        const details=el('details'),summary=el('summary','主模型与 LoRA');details.append(summary);details.open=!!this.detailsOpen;details.ontoggle=()=>{this.detailsOpen=details.open;};
        const modelWidget=widget(this.model,'ckpt_name') || widget(this.model,'unet_name');
        if(modelWidget){const current=String(modelWidget.value||'');const values=[...new Set([...valueList(modelWidget),...(this.model.type==='CheckpointLoaderSimple'?this.catalog.checkpoints:[]),current])].filter(Boolean);details.append(row('主模型',select(values.map(v=>[v,v]),current,v=>{modelWidget.value=v;modelWidget.callback?.(v);this.changed();})));}
        else details.append(el('p','当前方案的模型由原工作流控制'));
        const loraTitle=el('div','LoRA');details.append(loraTitle);
        if(!this.settings.loras.length)details.append(el('small','不使用 LoRA'));
        this.settings.loras.forEach((l,index)=>{
            const line=el('div');line.className='aw-lora-row';
            const names=[...new Set([...this.catalog.loras,l.name].filter(Boolean))];
            const pick=select([['','不使用'],...names.map(n=>[n,n])],l.name||'',v=>{l.name=v;this.changed();});pick.setAttribute('aria-label',`LoRA ${index+1}`);
            const strength=el('input');strength.type='number';strength.min='-10';strength.max='10';strength.step='0.05';strength.value=l.strength??1;strength.setAttribute('aria-label',`LoRA ${index+1} 强度`);strength.onchange=()=>{const n=Number(strength.value);if(Number.isFinite(n)){l.strength=Math.max(-10,Math.min(10,n));strength.value=l.strength;this.changed();}};
            const remove=el('button','×');remove.type='button';remove.title='移除此 LoRA';remove.onclick=()=>{this.settings.loras.splice(index,1);this.render();this.changed();};
            line.append(pick,strength,remove);details.append(line);
        });
        const add=el('button','＋ 添加 LoRA');add.type='button';add.disabled=!this.lora;add.onclick=()=>{this.settings.loras.push({name:'',strength:1});this.render();this.changed();};details.append(add);
        const refiner=el('input');refiner.type='checkbox';refiner.checked=!!this.settings.useRefiner;
        refiner.onchange=()=>{this.settings.useRefiner=refiner.checked;this.changed();};
        details.append(row('使用工作流中的 Refiner（需与主模型兼容）',refiner));
        if(this.catalogError)details.append(el('small',this.catalogError));
        this.root.append(details);
        for(const [kind,node,label] of [['positive',this.positive,'正面提示词'],['negative',this.negative,'负面提示词']]) {
            const w=widget(node,'text');if(!w)continue;
            const text=el('textarea');text.rows=kind==='positive'?6:3;
            text.value=this.settings[kind] ?? w.value ?? '';
            text.placeholder=node.inputs?.some(i=>i.name==='text' && i.link!=null)?'保持原工作流提示词；输入后以这里为准':'';
            text.oninput=()=>{this.settings[kind]=text.value;this.changed();};
            this.root.append(row(label,text));
        }
    }
    destroy() {this.destroyed=true;this.root?.remove();}
}
