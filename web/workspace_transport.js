// Check protocol support before POSTing: old ComfyUI processes may serve the
// updated JavaScript while still running the previous Python node package.
const unavailable = () => new Error('工作台后端尚未加载：请在 ComfyUI 启动器中停止后重新启动服务，再点击检查连接（仅刷新网页不够）');
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
        try { data = await response.json(); } catch { throw new Error(`工作台服务响应无效（${response.status}），请检查代理配置或重启 ComfyUI`); }
        if (!response.ok || !data.valid) {
            const errors = Object.entries(data.node_errors || {}).flatMap(([id,node]) =>
                (node.errors || []).map(e => `#${id} ${e.message || ''}: ${e.details || ''}`));
            const error = new Error(errors.join('\n') || data.error?.message || '工作流检查未通过');
            error.nodeErrors = data.node_errors || {}; throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error(path === 'submit' ? '提交超时，请先检查任务队列，避免重复生成' : '连接检查超时，请检查网络后重试');
        throw error;
    } finally { clearTimeout(timer); }
}
