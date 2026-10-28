/* Original hover-comparison UI, MIT licensed. */
import { T } from "./i18n.js";
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};
const imageFrom = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(T("Preview unavailable; run the workflow again")));
    image.src = url;
});

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
        this.adoptButton.disabled = !this.ready || !this.targetSelect.value || !!this.busy;
        this.adoptButton.textContent = this.busy ? T("Adopting…") : T("Adopt this result");
        this.downloadButton.disabled = !this.latestResult || !!this.downloading;
    }

    setLatestResult(result) { this.latestResult = result || null; this.updateButton(); }

    async downloadLatest() {
        if (!this.latestResult || this.downloading) return;
        const result = this.latestResult;
        this.downloading = true; this.updateButton();
        try {
            const blob = await this.options.fetchResult(result);
            if (this.destroyed) return;
            const url = URL.createObjectURL(blob), link = document.createElement("a");
            link.href = url; link.download = "adachi-inpaint-result.png";
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            this.status("");
        } catch (error) { if (!this.destroyed) this.status(error.message, true); }
        finally { this.downloading = false; if (!this.destroyed) this.updateButton(); }
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

    async loadSelected() {
        const version = ++this.version;
        this.ready = false; this.updateButton();
        if (!this.originals.length || !this.results.length) return;
        const repetitions = this.results.length / this.originals.length;
        const original = this.originals[Math.min(this.originals.length - 1, Math.floor(this.index / repetitions))];
        try {
            const images = await Promise.all([imageFrom(this.options.resolveUrl(original)), imageFrom(this.options.resolveUrl(this.results[this.index]))]);
            if (version !== this.version || this.destroyed) return;
            this.before = images[0]; this.after = images[1];
            this.ready = true; this.empty.hidden = true;
            this.dimensionsLabel.textContent = `${this.before.width} × ${this.before.height}`;
            this.status("");
            this.updateButton(); this.schedule();
        } catch (error) { if (version === this.version && !this.destroyed) this.status(error.message, true); }
    }

    async adopt() {
        this.refreshTargets();
        if (this.busy) return;
        if (!this.ready) { this.status(T("The result preview is still loading"), true); return; }
        if (!this.targetSelect.value) { this.status(T("Select an inline mask to adopt into"), true); return; }
        const target = this.targetSelect.value, result = this.results[this.index];
        this.busy = true; this.updateButton(); this.status(T("Setting the result as the new source image…"));
        try {
            await this.options.onAdopt(target, result);
            if (!this.destroyed) this.status(T("Adopted: back in the inline mask, keep painting to inpaint again"));
        } catch (error) { if (!this.destroyed) this.status(error.message, true); }
        finally { this.busy = false; if (!this.destroyed) this.updateButton(); }
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
        this.destroyed = true; ++this.version; cancelAnimationFrame(this.frame); this.observer.disconnect();
        this.before = this.after = null; this.canvas.width = this.canvas.height = 0; this.root.remove();
    }
}
