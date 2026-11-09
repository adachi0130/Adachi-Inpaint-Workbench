const stageNames={
    CheckpointLoaderSimple:'加载主模型',UNETLoader:'加载主模型',UNETLoaderGGUF:'加载主模型',
    CLIPLoader:'加载文本编码器',DualCLIPLoader:'加载文本编码器',VAELoader:'加载 VAE',
    CLIPTextEncode:'编码提示词',LoraLoader:'加载 LoRA','Power Lora Loader (rgthree)':'加载 LoRA',
    AdachiInlineMask:'读取原图与蒙版',AdachiWebUIInpaint:'重绘采样准备',
    KSampler:'K 采样器',KSamplerAdvanced:'K 采样器',SamplerCustom:'采样器',
    VAEDecode:'VAE 解码',VAEEncode:'VAE 编码',AdachiImageCompare:'准备对比图片',
};

// Percentages describe the current node's reported steps, not invented overall
// job progress. Nodes without numeric progress use an indeterminate bar.
export class WorkspaceProgress {
    constructor(onChange=()=>{}) {this.onChange=onChange;this.state='idle';this.buffer=[];}
    begin(nodes={},promptId=null) {
        this.nodes=nodes;this.promptId=promptId;this.state='queued';this.label='排队中…';
        this.nodeId=null;this.value=null;this.max=null;this.buffer=[];this.emit();
    }
    attach(promptId) {
        this.promptId=promptId;const events=this.buffer;this.buffer=[];
        for(const [name,data] of events)if(data?.prompt_id===promptId)this.handle(name,data);
    }
    emit(){this.onChange(this);}
    stage(id) {
        const node=this.nodes?.[String(id)],type=node?.class_type;
        return stageNames[type]||node?._meta?.title||type||'正在执行工作流';
    }
    finish(success,message) {
        this.state=success?'complete':'error';this.label=message||(success?'生成完成':'生成已停止');
        this.value=success?1:null;this.max=success?1:null;this.emit();
    }
    connection(connected) {
        if(!['queued','running'].includes(this.state))return;
        this.label=connected?'已重连，等待执行进度…':'连接中断，正在恢复进度…';this.value=this.max=null;this.emit();
    }
    handle(name,data={}) {
        // Older frontends reduce executing payloads to a scalar node ID and
        // dispatch null at completion, including before the submit HTTP reply.
        if(data==null)return false;
        if(name==='executing' && ['string','number'].includes(typeof data))data={node:String(data)};
        if(typeof data!=='object')return false;
        if(!['queued','running'].includes(this.state))return false;
        if(!this.promptId){this.buffer.push([name,data]);if(this.buffer.length>64)this.buffer.shift();return false;}
        if(data.prompt_id && data.prompt_id!==this.promptId)return false;
        if(name==='execution_success'){this.finish(true);return true;}
        if(['execution_error','execution_interrupted'].includes(name)){this.finish(false,data.exception_message||'生成已停止');return true;}
        if(name==='execution_start'){this.state='running';this.label='开始执行…';this.emit();return true;}
        if(name==='execution_cached'){
            if(this.state==='queued'){this.label=`读取缓存 · ${data.nodes?.length||0} 个节点`;this.emit();}return true;
        }
        if(name==='progress_state') {
            const running=Object.entries(data.nodes||{}).filter(([,n])=>n.state==='running');
            if(!running.length)return false;
            const [id,node]=running.at(-1);
            return this.handle('progress',{...node,prompt_id:this.promptId,node:id,
                max:Number(node.max)>1?node.max:0});
        }
        if(name==='executing' && data.node==null && data.node_id==null)return false;
        const id=data.node ?? data.node_id ?? this.nodeId;
        if(id==null || !this.nodes?.[String(id)])return false;
        const changed=String(id)!==this.nodeId;this.nodeId=String(id);this.state='running';
        if(changed || name==='executing'){this.value=this.max=null;}
        const max=Number(data.max),value=Number(data.value);
        if(name==='progress' && Number.isFinite(max) && max>0 && Number.isFinite(value)){
            this.max=max;this.value=Math.max(0,Math.min(max,value));
            const type=this.nodes[this.nodeId]?.class_type;
            this.label=`${type==='AdachiWebUIInpaint'?'重绘采样（K 采样器）':this.stage(id)} · ${this.value} / ${this.max}`;
        } else this.label=this.stage(id);
        this.emit();return true;
    }
}
