import {T} from './i18n.js';

// Retry only freshly uploaded same-origin view URLs. Local files, data URLs and
// restored inputs keep their original behavior. Each retry bypasses cached 404s.
export async function loadImage(url,{retry=false,signal,timeoutMs=15000,delays=[300,900]}={}) {
    const parsed=new URL(url,location.href);
    const canRetry=retry && parsed.origin===location.origin && /\/view$/.test(parsed.pathname);
    const attempts=canRetry?delays.length+1:1;
    for(let i=0;i<attempts;i++){
        signal?.throwIfAborted();
        if(i){await new Promise((resolve,reject)=>{const timer=setTimeout(done,delays[i-1]);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));}signal?.addEventListener('abort',abort,{once:true});});}
        const image=new Image();
        try{
            await new Promise((resolve,reject)=>{
                const finish=fn=>value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;fn(value);};
                const success=finish(resolve),failure=finish(reject),abort=()=>{image.src='';failure(new DOMException('Aborted','AbortError'));};
                const timer=setTimeout(()=>failure(new Error(T('Cannot load image'))),timeoutMs);
                image.onload=success;image.onerror=()=>failure(new Error(T('Cannot load image')));signal?.addEventListener('abort',abort,{once:true});
                const request=new URL(parsed);if(i)request.searchParams.set('_adachi_retry',String(i));image.src=request.href;
            });
            return image;
        }catch(error){if(error.name==='AbortError'||i===attempts-1)throw error;}
    }
}
