import {T} from './i18n.js';
// Check protocol support before POSTing: old ComfyUI processes may serve the
// updated JavaScript while still running the previous Python node package.
const unavailable = () => new Error(T("The workbench backend is not loaded. Stop and restart ComfyUI, then check connections again; refreshing the browser is not enough."));
export async function workspaceRequest(api, path, prepared) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path === 'submit' ? 60000 : 20000);
    try {
        let base;
        for (const candidate of ['/adachi-inpaint/workspace', '/api/adachi-inpaint/workspace']) {
            const probe = await api.fetchApi(`${candidate}/capabilities`, {signal:controller.signal});
            if (!probe.ok) continue;
            let info; try { info = await probe.json(); } catch { continue; }
            if (info.api_version === 1 && info.can_validate) { base = candidate; break; }
        }
        if (!base) throw unavailable();
        const response = await api.fetchApi(`${base}/${path}`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify(prepared), signal:controller.signal,
        });
        if ([404,405].includes(response.status)) throw unavailable();
        let data;
        try { data = await response.json(); } catch { throw new Error(T("Invalid workbench response ({status}); check your proxy settings or restart ComfyUI",{status:response.status})); }
        if (!response.ok || !data.valid) {
            const errors = Object.entries(data.node_errors || {}).flatMap(([id,node]) =>
                (node.errors || []).map(e => {
                    const labels={ckpt_name:T("Main model"),unet_name:T("Main model"),clip_name:T("Text encoder"),vae_name:'VAE',lora_name:'LoRA'};
                    const field=e.extra_info?.input_name,value=e.extra_info?.received_value;
                    if(e.type==='value_not_in_list' && labels[field] && typeof value==='string')return T("{label} not found: {value}",{label:labels[field],value});
                    return `#${id} ${e.message || ''}: ${e.details || ''}`;
                }));
            const error = new Error(errors.join('\n') || data.error?.message || T("Workflow validation failed"));
            error.nodeErrors = data.node_errors || {}; throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error(path === 'submit' ? T("Submission timed out. Check the task queue before retrying to avoid duplicate generations.") : T("Connection check timed out; check your network and retry"));
        throw error;
    } finally { clearTimeout(timer); }
}
