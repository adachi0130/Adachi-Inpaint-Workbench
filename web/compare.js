/* Original hover-comparison UI, MIT licensed. */
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};
const imageFrom = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("预览已过期或无法加载，请重新运行 / Preview unavailable; run the workflow again"));
    image.src = url;
});

export class ImageCompareView {
    constructor(options) {
        this.options = options;
        this.root = element("div", "dd-inpaint dd-comparer");
        this.originals = []; this.results = []; this.index = 0;
        this.zoom = 1; this.pan = { x: 0, y: 0 }; this.split = .5;
        this.version = 0; this.ready = false;
        const head = element("div", "dd-head");
        head.append(element("span", "dd-brand", "ADACHI / COMPARE"));
        this.dimensionsLabel = element("span", "dd-dimensions", "原图 / 重绘结果"); head.append(this.dimensionsLabel);
        const toolbar = element("div", "dd-row dd-compare-toolbar");
        toolbar.append(element("span", "dd-compare-label", "结果"));
        this.resultSelect = element("select"); this.resultSelect.setAttribute("aria-label", "选择重绘结果 / Choose result");
        this.resultSelect.onchange = () => { this.index = Number(this.resultSelect.value); this.options.onSelect?.(this.index); this.loadSelected(); };
        toolbar.append(this.resultSelect);
        const spacer = element("span", "dd-spacer"); toolbar.append(spacer);
        const fit = element("button", "", "适应"); fit.type = "button";
        fit.onclick = () => { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.schedule(); }; toolbar.append(fit);
        this.stage = element("div", "dd-stage dd-compare-stage");
        this.canvas = document.createElement("canvas"); this.canvas.tabIndex = 0;
        this.canvas.setAttribute("aria-label", "左原图、右重绘结果，移动鼠标竖线对比 / Original left, result right; hover to compare");
        this.canvas.oncontextmenu = event => event.preventDefault();
        this.stage.append(this.canvas);
        const captions = element("div", "dd-compare-captions");
        captions.append(element("span", "", "原图"), element("span", "", "重绘结果")); this.stage.append(captions);
        this.empty = element("div", "dd-empty", "连接原图与重绘结果，然后运行工作流"); this.stage.append(this.empty);
        const adoption = element("div", "dd-row dd-adoption");
        adoption.append(element("span", "dd-compare-label", "回填到"));
        this.targetSelect = element("select"); this.targetSelect.setAttribute("aria-label", "接收结果的内联蒙版 / Target inline editor");
        this.targetSelect.onfocus = () => this.refreshTargets();
        this.targetSelect.onchange = () => { this.manualTarget = true; this.updateButton(); };
        adoption.append(this.targetSelect);
        this.adoptButton = element("button", "dd-primary", "采用此结果"); this.adoptButton.type = "button";
        this.adoptButton.onclick = () => this.adopt(); adoption.append(this.adoptButton);
        this.message = element("div", "dd-status", "鼠标移动竖线对比 · 滚轮缩放 · 中键拖动");
        this.root.append(head, toolbar, this.stage, adoption, this.message);
        this.canvas.addEventListener("pointermove", event => this.move(event));
        this.canvas.addEventListener("pointerdown", event => {
            if (!this.ready) return;
            event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
            if (event.button === 1 || this.space) {
                this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...this.pan } };
                this.canvas.setPointerCapture(event.pointerId);
            } else this.move(event);
        });
        const finish = event => {
            if (!this.drag || this.drag.id !== event.pointerId) return;
            const id = this.drag.id; this.drag = null;
            if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
        };
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) this.canvas.addEventListener(name, finish);
        this.canvas.addEventListener("wheel", event => this.wheel(event), { passive: false });
        this.captureWheel = event => { if (event.target === this.canvas) this.wheel(event); };
        window.addEventListener("wheel", this.captureWheel, { capture: true, passive: false });
        this.canvas.addEventListener("keydown", event => {
            if (event.code === "Space") { event.preventDefault(); event.stopPropagation(); this.space = true; }
            else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                this.split = Math.max(0, Math.min(1, this.split + (event.key === "ArrowRight" ? .02 : -.02))); this.schedule();
            }
        });
        this.canvas.addEventListener("keyup", event => { if (event.code === "Space") this.space = false; });
        this.canvas.addEventListener("blur", () => { this.space = false; });
        this.observer = new ResizeObserver(() => this.schedule()); this.observer.observe(this.stage);
        this.refreshTargets(); this.updateButton();
    }

    status(text, error = false) { this.message.textContent = text; this.message.classList.toggle("dd-error", error); }

    refreshTargets() {
        const selected = this.targetSelect.value;
        const { editors = [], preferred = "" } = this.options.getTargets?.() || {};
        this.targetSelect.replaceChildren();
        const placeholder = element("option", "", "选择内联蒙版"); placeholder.value = ""; this.targetSelect.append(placeholder);
        for (const editor of editors) {
            const option = element("option", "", editor.label); option.value = String(editor.id); this.targetSelect.append(option);
        }
        const valid = id => editors.some(editor => String(editor.id) === String(id));
        this.targetSelect.value = this.manualTarget && valid(selected) ? selected : valid(preferred) ? String(preferred) : editors.length === 1 ? String(editors[0].id) : "";
        this.updateButton();
    }

    updateButton() { this.adoptButton.disabled = !this.ready || !this.targetSelect.value || !!this.busy; }

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
            this.status("左原图 / 右重绘 · 滚轮缩放 · 满意后点击采用此结果");
            this.updateButton(); this.schedule();
        } catch (error) { if (version === this.version && !this.destroyed) this.status(error.message, true); }
    }

    async adopt() {
        this.refreshTargets();
        if (!this.ready || !this.targetSelect.value || this.busy) return;
        const target = this.targetSelect.value, result = this.results[this.index];
        this.busy = true; this.updateButton(); this.status("正在将结果设为新原图…");
        try {
            await this.options.onAdopt(target, result);
            if (!this.destroyed) this.status("已采用：回到内联蒙版，可继续涂抹重绘");
        } catch (error) { if (!this.destroyed) this.status(error.message, true); }
        finally { this.busy = false; if (!this.destroyed) this.updateButton(); }
    }

    transform() {
        const rect = this.canvas.getBoundingClientRect();
        const scale = this.before ? Math.min(rect.width / this.before.width, rect.height / this.before.height) * this.zoom : 1;
        return { width: rect.width, height: rect.height, scale, x: (rect.width - (this.before?.width || 0) * scale) / 2 + this.pan.x, y: (rect.height - (this.before?.height || 0) * scale) / 2 + this.pan.y };
    }

    position(event) { const rect = this.canvas.getBoundingClientRect(), t = this.transform(); return { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale }; }

    wheel(event) {
        if (!this.ready) return;
        event.preventDefault(); event.stopPropagation();
        const before = this.position(event), rect = this.canvas.getBoundingClientRect();
        this.zoom = Math.max(.1, Math.min(32, this.zoom * Math.exp(-event.deltaY * .0015)));
        const t = this.transform();
        this.pan.x += event.clientX - rect.left - (t.x + before.x * t.scale);
        this.pan.y += event.clientY - rect.top - (t.y + before.y * t.scale);
        this.schedule();
    }

    move(event) {
        if (!this.ready) return;
        if (this.drag) {
            event.preventDefault(); event.stopPropagation();
            this.pan.x = this.drag.pan.x + event.clientX - this.drag.x;
            this.pan.y = this.drag.pan.y + event.clientY - this.drag.y;
        } else this.split = Math.max(0, Math.min(1, this.position(event).x / this.before.width));
        this.schedule();
    }

    schedule() { if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

    render() {
        const t = this.transform(), ratio = Math.min(devicePixelRatio || 1, 2);
        if (!t.width || !t.height) return;
        const width = Math.round(t.width * ratio), height = Math.round(t.height * ratio);
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
        if (!this.ready) return;
        ctx.setTransform(t.scale * ratio, 0, 0, t.scale * ratio, t.x * ratio, t.y * ratio);
        ctx.drawImage(this.before, 0, 0);
        const split = this.split * this.before.width;
        ctx.save(); ctx.beginPath(); ctx.rect(split, 0, this.before.width - split, this.before.height); ctx.clip();
        ctx.drawImage(this.after, 0, 0, this.before.width, this.before.height); ctx.restore();
        ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, this.before.height);
        ctx.strokeStyle = "#141820"; ctx.lineWidth = 3 / t.scale; ctx.stroke();
        ctx.strokeStyle = "#ffe0b8"; ctx.lineWidth = 1 / t.scale; ctx.stroke();
        ctx.beginPath(); ctx.arc(split, this.before.height / 2, 7 / t.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#272c35"; ctx.fill(); ctx.stroke();
    }

    destroy() {
        this.destroyed = true; ++this.version; cancelAnimationFrame(this.frame); this.observer.disconnect();
        window.removeEventListener("wheel", this.captureWheel, true);
        this.before = this.after = null; this.canvas.width = this.canvas.height = 0; this.root.remove();
    }
}
