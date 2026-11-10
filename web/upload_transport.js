import { T } from "./i18n.js";

// XMLHttpRequest reports bytes sent, unlike fetch. Keep ComfyUI's API URL and
// per-user header; the browser automatically sends same-origin session cookies.
export async function uploadImageWithProgress(api, body, onProgress, {signal,idleMs=60000}={}) {
    const controller=new AbortController();let timer,timedOut=false;
    const abort=()=>controller.abort();
    const reset=(ms=idleMs)=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},ms);};
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    try {
    controller.signal.throwIfAborted();reset();
    const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let settled=false,lastLoaded=0;
        const finish=(fn,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',cancel);xhr.onload=xhr.onerror=xhr.onabort=null;xhr.upload.onprogress=xhr.upload.onload=null;fn(value);};
        const cancel=()=>{xhr.abort();finish(reject,new DOMException(T('Upload was cancelled'),'AbortError'));};
        controller.signal.addEventListener('abort',cancel,{once:true});
        xhr.open("POST", api.apiURL("/upload/image"));
        if (api.user) xhr.setRequestHeader("Comfy-User", api.user);
        xhr.upload.onprogress = event => {if(event.loaded>lastLoaded){lastLoaded=event.loaded;reset();}onProgress?.({phase: "upload", loaded: event.loaded, total: event.lengthComputable ? event.total : 0});};
        xhr.upload.onload = () => {reset();onProgress?.({phase: "processing"});};
        xhr.onload = () => finish(resolve,xhr);
        xhr.onerror = () => finish(reject,new Error(T("Network error while uploading image")));
        xhr.onabort = () => finish(reject,new DOMException(T("Upload was cancelled"),'AbortError'));
        try{xhr.send(body);}catch(error){finish(reject,error);}
    });

    // Some cloud frontends wrap fetchApi with an authentication mechanism that
    // is not exposed to XHR. Retry rejected authentication through that same
    // frontend API, without inventing upload percentages for the fallback.
    if (response.status === 401 || response.status === 403) {
        onProgress?.({phase: "authenticated"});
        // fetch cannot expose upload byte progress. Give authenticated uploads
        // a larger bounded budget rather than applying XHR's inactivity limit.
        reset(idleMs*5);
        const fallback = await api.fetchApi("/upload/image", {method: "POST", body, signal:controller.signal});
        if (!fallback.ok) throw new Error(`${T("Upload failed")} (${fallback.status})`);
        onProgress?.({phase: "processing"});
        return await fallback.json();
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`${T("Upload failed")} (${response.status})`);
    try { return JSON.parse(response.responseText); }
    catch { throw new Error(T("Invalid upload response")); }
    } catch(error) {
        if(timedOut)throw Error(T('Image upload timed out; check the connection and try again'));
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
