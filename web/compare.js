/* Original hover-comparison UI, MIT licensed. */
import { T } from "./i18n.js";
import {loadPreviewPair} from './preview_images.js';
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};

export class ImageCompareView {
    constructor(options) {
        this.options = options;
        this.root = element("div", "dd-inpaint dd-comparer");
        this.originals = []; this.results = []; this.index = 0;
        this.split = .5;
        this.version = 0; this.ready = false;
        this.dimensionsLabel = element("span", "dd-dimensions");
        const toolbar = element("div", "dd-row dd-compare-toolbar");
        toolbar.append(element("span", "dd-compare-label", T("Result")));
        this.resultSelect = element("select"); this.resultSelect.setAttribute("aria-label", T("Choose result"));
        this.resultSelect.onchange = () => { this.index = Number(this.resultSelect.value); this.options.onSelect?.(this.index); this.loadSelected(); };
        toolbar.append(this.resultSelect, this.dimensionsLabel);
        const spacer = element("span", "dd-spacer"); toolbar.append(spacer);
        this.reloadButton = element("button", "", "↻"); this.reloadButton.type = "button";
        this.reloadButton.title = T("Reload comparison images"); this.reloadButton.setAttribute("aria-label", this.reloadButton.title);
        this.reloadButton.onclick = async event => { event.preventDefault(); event.stopPropagation(); await this.options.recover?.(); this.loadSelected(); };
        toolbar.append(this.reloadButton);
        this.downloadButton = element("button", "", "↓"); this.downloadButton.type = "button";
        this.downloadButton.title = T("Download the latest generated image");
        this.downloadButton.setAttribute("aria-label", this.downloadButton.title);
        this.downloadButton.onclick = event => { event.preventDefault(); event.stopPropagation(); this.downloadLatest(); };
        toolbar.append(this.downloadButton);
        const fit = element("button", "", T("Fit")); fit.type = "button";
        fit.onclick = event => { event.preventDefault(); event.stopPropagation(); this.schedule(); }; toolbar.append(fit);
        this.stage = element("div", "dd-stage dd-compare-stage");
        this.canvas = document.createElement("canvas"); this.canvas.tabIndex = 0;
        this.canvas.setAttribute("aria-label", T("Result left, original right; hover to compare"));
        this.canvas.oncontextmenu = event => event.preventDefault();
        this.canvas.addEventListener("pointerenter", event => { this.hovered = true; this.move(event); this.schedule(); });
        this.canvas.addEventListener("pointerleave", () => { this.hovered = false; this.schedule(); });
        this.divider = element("div");
        Object.assign(this.divider.style, { position: "absolute", background: "#ffffffb3", pointerEvents: "none" });
        this.divider.hidden = true;
        this.stage.append(this.canvas, this.divider);
        this.progressBox=element("div","dd-preview-progress");this.progressBox.hidden=true;
        this.progressBox.setAttribute("role","status");
        this.progressText=element("span");this.progressBar=document.createElement("progress");this.progressBar.max=1;
        this.progressBar.setAttribute("aria-label",T("Comparison image loading progress"));
        this.progressBox.append(this.progressText,this.progressBar);this.stage.append(this.progressBox);
        this.retryOnOnline=()=>{if(!this.ready && !this.loadingActive && this.results.length)this.loadSelected();};
        window.addEventListener("online",this.retryOnOnline);
        this.empty = element("div", "dd-empty", T("Connect an original image and a result, then run the workflow")); this.stage.append(this.empty);
        const adoption = element("div", "dd-row dd-adoption");
        adoption.append(element("span", "dd-compare-label", T("Adopt into")));
        this.targetSelect = element("select"); this.targetSelect.setAttribute("aria-label", T("Target inline editor"));
        this.targetSelect.onfocus = () => this.refreshTargets();
        this.targetSelect.onchange = () => { this.manualTarget = true; this.updateButton(); };
        adoption.append(this.targetSelect);
        this.adoptButton = element("button", "dd-primary", T("Adopt this result")); this.adoptButton.type = "button";
        this.adoptButton.onclick = () => this.adopt(); adoption.append(this.adoptButton);
        this.message = element("div", "dd-status", T("Result left, original right; hover to compare"));
        this.message.hidden = true; this.message.setAttribute("role", "alert");
        this.root.append(this.stage, toolbar, adoption, this.message);
        this.canvas.addEventListener("pointermove", event => this.move(event));
        this.canvas.addEventListener("pointerdown", event => {
            if (!this.ready || event.button !== 0) return;
            event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
            this.move(event);
        });
        this.canvas.addEventListener("wheel", event => this.wheel(event), { passive: false });
        this.canvas.addEventListener("keydown", event => {
            if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                this.split = Math.max(0, Math.min(1, this.split + (event.key === "ArrowRight" ? .02 : -.02))); this.schedule();
            }
        });
        this.observer = new ResizeObserver(() => this.schedule()); this.observer.observe(this.stage);
        this.refreshTargets(); this.updateButton();
    }

    status(text, error = false) { this.message.textContent = text; this.message.classList.toggle("dd-error", error); this.message.hidden = !error; }

    refreshTargets() {
        const selected = this.targetSelect.value;
        const { editors = [], preferred = "" } = this.options.getTargets?.() || {};
        this.targetSelect.replaceChildren();
        const placeholder = element("option", "", T("Select an inline mask")); placeholder.value = ""; this.targetSelect.append(placeholder);
        for (const editor of editors) {
            const option = element("option", "", editor.label); option.value = String(editor.id); this.targetSelect.append(option);
        }
        const valid = id => editors.some(editor => String(editor.id) === String(id));
        this.targetSelect.value = this.manualTarget && valid(selected) ? selected : valid(preferred) ? String(preferred) : editors.length === 1 ? String(editors[0].id) : "";
        this.updateButton();
    }

    updateButton() {
        this.adoptButton.disabled = !this.ready || !this.targetSelect.value || !!this.busy || this.pendingOutputs>0;
        this.adoptButton.textContent = this.busy ? T("Adopting…") : T("Adopt this result");
        this.downloadButton.disabled = !this.latestResult || !!this.downloading;
    }

    setLatestResult(result) { this.latestResult = result || null; this.updateButton(); }

    async downloadLatest() {
        if (!this.latestResult || this.downloading) return;
        const result = this.latestResult;
        this.downloading = true; this.updateButton();
        const controller=this.downloadController=new AbortController();
        try {
            const blob = await this.options.fetchResult(result,{signal:controller.signal});
            if (this.destroyed) return;
            const url = URL.createObjectURL(blob), link = document.createElement("a");
            link.href = url; link.download = "adachi-inpaint-result.png";
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            this.status("");
        } catch (error) { if (!this.destroyed) this.status(error.message, true); }
        finally {if(this.downloadController===controller)this.downloadController=null;this.downloading = false; if (!this.destroyed) this.updateButton();}
    }

    async setData(data, index = this.index) {
        this.originals = Array.isArray(data?.originals) ? data.originals : [];
        this.results = Array.isArray(data?.results) ? data.results : [];
        this.index = Math.max(0, Math.min(this.results.length - 1, Number(index) || 0));
        this.resultSelect.replaceChildren();
        this.results.forEach((_, i) => {
            const option = element("option", "", `${i + 1} / ${this.results.length}`); option.value = String(i); this.resultSelect.append(option);
        });
        this.resultSelect.value = String(this.index);
        this.resultSelect.disabled = this.results.length < 2;
        this.refreshTargets();
        await this.loadSelected();
    }

    loading(text, states) {
        this.progressBox.hidden=false;this.progressText.textContent=text;
        if(states) {
            const loaded=states.reduce((n,s)=>n+s.loaded,0),total=states.every(s=>s.total>0)?states.reduce((n,s)=>n+s.total,0):0;
            const size=n=>n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${Math.round(n/1024)} KiB`;
            this.progressText.textContent+=total?` · ${Math.min(100,Math.round(loaded/total*100))}% · ${size(loaded)} / ${size(total)}`:` · ${size(loaded)}`;
            if(total)this.progressBar.value=Math.min(1,loaded/total);else this.progressBar.removeAttribute("value");
        } else this.progressBar.removeAttribute("value");
    }

    async loadSelected({background=false}={}) {
        if(this.destroyed)return;
        clearTimeout(this.retryTimer);this.loadController?.abort();
        const version=++this.version,controller=this.loadController=new AbortController();
        this.reloadButton.disabled=false;this.loadingActive=true;
        this.ready=false;this.updateButton();this.schedule();
        if(!this.originals.length || !this.results.length){this.loadingActive=false;this.progressBox.hidden=true;return;}
        const repetitions=this.results.length/this.originals.length;
        const original=this.originals[Math.min(this.originals.length-1,Math.floor(this.index/repetitions))];
        const current=()=>version===this.version && !this.destroyed && !controller.signal.aborted;
        const blobKey=JSON.stringify([original,this.results[this.index]]);
        if(this.blobKey!==blobKey){this.blobKey=blobKey;this.pendingBlobs=[null,null];}
        const blobs=this.pendingBlobs||[null,null];
        try {
            let images;
            for(let attempt=0;attempt<3;attempt++) {
                const states=blobs.map(blob=>({loaded:blob?.size||0,total:blob?.size||0,complete:!!blob}));
                this.loading(attempt?T("Retrying comparison images")+` (${attempt+1}/3)`:T("Loading comparison images"),states);
                try {
                    images=await loadPreviewPair([original,this.results[this.index]],{loadPreview:(...args)=>this.options.loadPreview(...args),cached:blobs,signal:controller.signal,
                        onProgress:(i,state)=>{states[i]=state;if(current())this.loading(T("Loading comparison images"),states);},
                        onDecoding:()=>{if(current() && states.every(s=>s.complete))this.loading(T("Decoding comparison images…"));}});
                    break;
                } catch(error) {
                    if(!current())return;
                    if(attempt===2 || [404,410].includes(error.status))throw error;
                    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,1000*(attempt+1));controller.signal.addEventListener('abort',done,{once:true});});
                }
            }
            if(!current()){for(const item of images||[])URL.revokeObjectURL(item.url);return;}
            for(const url of this.previewUrls||[])URL.revokeObjectURL(url);
            this.previewUrls=images.map(item=>item.url);this.before=images[0].image;this.after=images[1].image;
            this.ready=true;this.pendingBlobs=null;this.retryCount=0;this.empty.hidden=true;this.progressBox.hidden=true;
            this.dimensionsLabel.textContent=`${this.before.width} × ${this.before.height}`;
            this.status("");this.updateButton();this.schedule();
        } catch(error) {
            if(!current())return;
            this.progressBox.title=error.message;
            if([404,410].includes(error.status)){this.progressBox.hidden=true;this.pendingBlobs=null;this.status(T("Result preview expired; run the workflow again"),true);return;}
            this.status(T("Image loading failed; retrying automatically. You can also click reload."),true);
            const seconds=Math.min(60,5*2**Math.min(this.retryCount||0,4));this.retryCount=(this.retryCount||0)+1;
            this.loading(T("Waiting to retry comparison images")+` · ${seconds}s`);
            this.retryTimer=setTimeout(()=>this.loadSelected({background:true}),seconds*1000);
        } finally {if(version===this.version)this.loadingActive=false;}
    }

    async adopt() {
        this.refreshTargets();
        if (this.busy) return;
        if (!this.ready || this.pendingOutputs>0) { this.status(T("The result preview is still loading"), true); return; }
        if (!this.targetSelect.value) { this.status(T("Select an inline mask to adopt into"), true); return; }
        const target = this.targetSelect.value, result = this.results[this.index];
        this.busy = true; this.updateButton(); this.status(T("Setting the result as the new source image…"));
        const controller=this.adoptController=new AbortController();
        try {
            await this.options.onAdopt(target, result,{signal:controller.signal});
            if (!this.destroyed) this.status(T("Adopted: back in the inline mask, keep painting to inpaint again"));
        } catch (error) { if (!this.destroyed) this.status(error.message, true); }
        finally {if(this.adoptController===controller)this.adoptController=null;this.busy = false; if (!this.destroyed) this.updateButton();}
    }

    transform() {
        const rect = this.canvas.getBoundingClientRect();
        const scale = this.before ? Math.min(rect.width / this.before.width, rect.height / this.before.height) : 1;
        return { width: rect.width, height: rect.height, scale, x: (rect.width - (this.before?.width || 0) * scale) / 2, y: (rect.height - (this.before?.height || 0) * scale) / 2 };
    }

    position(event) { const rect = this.canvas.getBoundingClientRect(), t = this.transform(); return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale }; }

    wheel(event) {
        event.preventDefault(); event.stopPropagation();
        this.options.onGraphWheel?.(event);
    }

    move(event) {
        if (!this.ready) return;
        this.hovered = true;
        this.split = Math.max(0, Math.min(1, this.position(event).x / this.before.width));
        this.schedule();
    }

    schedule() { if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

    render() {
        const t = this.transform(), ratio = Math.min(devicePixelRatio || 1, 2);
        if (!t.width || !t.height) return;
        // Graph zoom changes the screen rect, not the amount of source detail.
        // Never allocate a huge upscaled bitmap just to magnify existing pixels.
        const rasterRatio = Math.min(ratio, this.ready ? 1 / t.scale : ratio,
            8192 / t.width, 8192 / t.height, Math.sqrt(16 * 1024 * 1024 / (t.width * t.height)));
        const width = Math.max(1, Math.round(t.width * rasterRatio)), height = Math.max(1, Math.round(t.height * rasterRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.divider.hidden = !this.ready || !this.hovered;
        if (!this.ready) { ctx.clearRect(0, 0, width, height); this.lastPaint = null; return; }
        const split = this.split * this.before.width;
        const lineX = Math.round((t.x + split * t.scale) * rasterRatio) + .5;
        if (this.hovered) {
            const screenScale = t.width / this.canvas.clientWidth || 1;
            Object.assign(this.divider.style, {
                left: `${(t.x + split * t.scale) / screenScale}px`, top: `${t.y / screenScale}px`,
                height: `${this.before.height * t.scale / screenScale}px`, width: `${1 / screenScale}px`,
            });
        }
        const key = [this.version, width, height, t.scale * rasterRatio, t.x * rasterRatio, t.y * rasterRatio].join(":");
        const previous = this.lastPaint;
        ctx.save();
        // While hovering, pixels outside the old/new divider positions are
        // unchanged. Clip the redraw to that strip rather than repainting all.
        if (previous?.key === key && previous.hovered && this.hovered) {
            const left = Math.max(0, Math.floor(Math.min(previous.lineX, lineX)) - 2);
            const right = Math.min(width, Math.ceil(Math.max(previous.lineX, lineX)) + 2);
            ctx.beginPath(); ctx.rect(left, 0, right - left, height); ctx.clip();
        }
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(t.scale * rasterRatio, 0, 0, t.scale * rasterRatio, t.x * rasterRatio, t.y * rasterRatio);
        ctx.drawImage(this.after, 0, 0, this.before.width, this.before.height);
        this.lastPaint = { key, hovered: this.hovered, lineX };
        if (!this.hovered) { ctx.restore(); return; }
        ctx.save(); ctx.beginPath(); ctx.rect(split, 0, this.before.width - split, this.before.height); ctx.clip();
        ctx.drawImage(this.before, 0, 0); ctx.restore();
        ctx.restore();
    }

    destroy() {
        this.destroyed = true; ++this.version; clearTimeout(this.retryTimer);this.loadController?.abort();
        this.downloadController?.abort();this.adoptController?.abort();
        window.removeEventListener("online",this.retryOnOnline);for(const url of this.previewUrls||[])URL.revokeObjectURL(url);
        cancelAnimationFrame(this.frame); this.observer.disconnect();
        this.pendingBlobs=null;this.before = this.after = null; this.canvas.width = this.canvas.height = 0; this.root.remove();
    }
}
