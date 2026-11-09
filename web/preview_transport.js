// Read through ComfyUI's authenticated API and report received bytes. The
// deadline measures inactivity, so a slow but advancing cloud download works.
export async function readPreview(fetchApi, path, {signal, onProgress, idleMs=30000, maxBytes=128*1024*1024}={}) {
    const controller=new AbortController();let timer,timedOut=false;
    const abort=()=>controller.abort();
    const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},idleMs);};
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    try {
        reset();
        const response=await fetchApi(path,{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw Object.assign(new Error(`Preview request failed (${response.status})`),{status:response.status});
        const encoded=response.headers?.get('content-encoding');
        const total=encoded && encoded!=='identity'?0:Number(response.headers?.get('content-length'))||0;
        if(total>maxBytes)throw Error('Preview exceeds the image size limit');
        onProgress?.({loaded:0,total});
        let blob;
        if(response.body?.getReader) {
            const reader=response.body.getReader(),chunks=[];let loaded=0;
            try {
                while(true) {
                    const {done,value}=await reader.read();
                    if(done)break;
                    reset();loaded+=value.byteLength;
                    if(loaded>maxBytes)throw Error('Preview exceeds the image size limit');
                    chunks.push(value);onProgress?.({loaded,total});
                }
                if(total && loaded<total)throw Error('Preview download was interrupted');
                blob=new Blob(chunks,{type:response.headers?.get('content-type')||'image/png'});
                onProgress?.({loaded,total:loaded,complete:true});
            } catch(error) {await reader.cancel().catch(()=>{});throw error;}
            finally {reader.releaseLock();}
        } else {
            blob=await response.blob();
            if(blob.size>maxBytes)throw Error('Preview exceeds the image size limit');
            onProgress?.({loaded:blob.size,total:blob.size,complete:true});
        }
        if(!blob.size)throw Error('Empty preview image');
        return blob;
    } catch(error) {
        if(timedOut)throw Error('Preview download timed out');
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
