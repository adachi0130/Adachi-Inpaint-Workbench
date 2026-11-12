// A pending upload owns the retry: new edits are checked once it settles.
// In particular, never poll a slow connection or an unfinished pointer stroke.
export function createPaintDraftProtection({paint,widget,graph,disposed,persist,fits,upload,changed,onError}) {
    let timer=0, pending=false, stopped=false;
    const schedule=()=>{
        if(stopped)return;
        clearTimeout(timer);
        timer=setTimeout(run,0);
    };
    const run=async()=>{
        timer=0;
        if(stopped || disposed() || paint()?.drawing || pending)return;
        const data=widget()?.value||'',revision=paint()?.revision;
        try {
            if(!data.startsWith('data:') || !persist() || fits(graph())!==false){changed();return;}
            pending=true;
            const name=await upload(data);
            if(!stopped && !disposed() && widget()?.value===data && paint()?.revision===revision){widget().value=name;changed();}
        } catch(error) {if(!stopped && !disposed())onError(error);}
        finally {
            pending=false;
            if(!stopped && !disposed() && (widget()?.value!==data || paint()?.revision!==revision))schedule();
        }
    };
    return {schedule,dispose(){stopped=true;clearTimeout(timer);}};
}
