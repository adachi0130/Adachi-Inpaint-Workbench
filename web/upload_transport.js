import { T } from "./i18n.js";

// Upload through ComfyUI's authenticated frontend API, the same channel the
// comparison downloads use. No raw socket is opened here. When the runtime
// supports streaming request bodies we count the bytes actually sent; otherwise
// we report indeterminate progress instead of inventing a percentage.
export async function uploadImageWithProgress(api, body, onProgress, {signal,idleMs=60000}={}) {
    const controller=new AbortController();let timer,timedOut=false;
    const abort=()=>controller.abort();
    const reset=(ms=idleMs)=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},ms);};
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    try {
        controller.signal.throwIfAborted();reset();
        const response=await sendUpload(api,body,onProgress,controller,reset,idleMs);
        // Some cloud frontends reject the first attempt before their session is
        // attached. Retry once through the same authenticated API.
        if (response.status === 401 || response.status === 403) {
            onProgress?.({phase: "authenticated"});
            reset(idleMs*5);
            const fallback = await api.fetchApi("/upload/image", {method: "POST", body, signal:controller.signal});
            if (!fallback.ok) throw new Error(`${T("Upload failed")} (${fallback.status})`);
            onProgress?.({phase: "processing"});
            return await fallback.json();
        }
        if (!response.ok) throw new Error(`${T("Upload failed")} (${response.status})`);
        onProgress?.({phase: "processing"});
        return await response.json();
    } catch(error) {
        if(timedOut)throw Error(T('Image upload timed out; check the connection and try again'));
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

async function sendUpload(api, body, onProgress, controller, reset, idleMs) {
    const headers = {};
    if (api.user) headers["Comfy-User"] = api.user;
    // Serialize once so the same bytes can be streamed and, if streaming is
    // unavailable, sent again unchanged.
    let bytes = null, contentType = null;
    try {
        const serialized = new Response(body);
        contentType = serialized.headers.get("content-type");
        bytes = await serialized.arrayBuffer();
    } catch { /* keep the original body for a plain send */ }
    if (bytes && typeof ReadableStream === "function") {
        if (contentType) headers["Content-Type"] = contentType;
        const total = bytes.byteLength, chunk = 64 * 1024;
        // pull() runs only when the transport consumes a chunk, so `started`
        // tells a rejected streaming capability apart from a mid-transfer error.
        let started = false;
        const stream = new ReadableStream({
            async pull(c) {
                try {
                    controller.signal.throwIfAborted();
                    if (started >= total) { c.close(); return; }
                    const end = Math.min(started + chunk, total);
                    c.enqueue(new Uint8Array(bytes, started, end - started));
                    started = end; reset();
                    onProgress?.({phase: "upload", loaded: started, total});
                } catch (error) { c.error(error); }
            },
        });
        try {
            return await api.fetchApi("/upload/image", {method: "POST", body: stream, headers, duplex: "half", signal: controller.signal});
        } catch (error) {
            // A cancelled or timed-out upload must surface, not fall back.
            if (controller.signal.aborted) throw error;
            // Bytes already left the browser: retrying would upload twice.
            if (started > 0) throw error;
            // Runtime without streaming uploads: fall through to a plain send.
        }
    }
    onProgress?.({phase: "upload"});
    reset(idleMs);
    return await api.fetchApi("/upload/image", {method: "POST", body, headers: api.user ? {"Comfy-User": api.user} : undefined, signal: controller.signal});
}