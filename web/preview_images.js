// A failed half of a comparison must not leave its sibling decoding in the
// background, retain a corrupt blob forever, or leak a late object URL.
export async function decodePreview(blob, signal, {ImageClass=globalThis.Image, urls=URL, timeoutMs=20000}={}) {
    signal?.throwIfAborted();
    const url=urls.createObjectURL(blob), image=new ImageClass();
    let timer, abort;
    const stopped=new Promise((_,reject)=>{
        abort=()=>{image.src='';reject(new DOMException('Cancelled','AbortError'));};
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{image.src='';reject(Error('Preview image decoding timed out'));},timeoutMs);
    });
    try {
        image.src=url;
        await Promise.race([image.decode(),stopped]);
        signal?.throwIfAborted();
        const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
        if(!width || !height || width*height>32_000_000 || Math.max(width,height)>16384)throw Error('Preview image exceeds supported dimensions');
        return {image,url};
    } catch(error) {urls.revokeObjectURL(url);throw error;}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function loadPreviewPair(refs,{loadPreview,cached,signal,onProgress,onDecoding,decode=decodePreview,revoke=url=>URL.revokeObjectURL(url)}) {
    signal.throwIfAborted();
    const pair=new AbortController(),abort=()=>pair.abort();
    signal.addEventListener('abort',abort,{once:true});
    let failure;
    try {
        const results=await Promise.allSettled(refs.map(async(ref,index)=>{
            try {
                const blob=cached[index]||await loadPreview(ref,{signal:pair.signal,onProgress:state=>{if(!pair.signal.aborted)onProgress?.(index,state);}});
                pair.signal.throwIfAborted();cached[index]=blob;
                onDecoding?.();
                try {return await decode(blob,pair.signal);}
                catch(error){if(error.name!=='AbortError')cached[index]=null;throw error;}
            } catch(error) {failure??=error;pair.abort();throw error;}
        }));
        if(failure || signal.aborted) {
            for(const result of results)if(result.status==='fulfilled')revoke(result.value.url);
            signal.throwIfAborted();throw failure;
        }
        return results.map(result=>result.value);
    } finally {signal.removeEventListener('abort',abort);}
}
