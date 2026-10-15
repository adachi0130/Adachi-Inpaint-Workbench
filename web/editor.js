/* Original implementation, MIT licensed. No WebUI source is bundled. */
import { registerImageWheel } from "./wheel_gestures.js";
import { T } from "./i18n.js";
const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
};
const makeCanvas = () => document.createElement("canvas");
const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(T("Cannot load image")));
    image.src = url;
});

export class InlineMaskEditor {
    constructor(options = {}) {
        this.options = options;
        this.root = el("div", "dd-inpaint");
        this.root.tabIndex = 0;
        this.image = null;
        this.mask = makeCanvas();
        this.baseMask = makeCanvas();
        this.overlay = makeCanvas();
        this.tool = "brush";
        this.view = "overlay";
        this.brushSize = 64;
        this.hardness = 100;
        this.brushOpacity = 100;
        this.overlayOpacity = 55;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.history = [];
        this.future = [];
        this.dirty = false;
        this.ready = false;
        this.loadVersion = 0;
        this.build();
        this.observer = new ResizeObserver(() => this.schedule());
        this.observer.observe(this.stage);
        // Nodes 2.0 captures wheel events before widget handlers. Route only
        // this canvas at window capture so image gestures stay inside it.
        this.stopWheelCapture = registerImageWheel(this.canvas, () => this.ready, event => this.wheel(event), options.onGraphWheel);
        this.modifierDown = event => {
            if (event.key !== "Alt" || !this.ready || !this.canvas.matches(":hover")) return;
            event.preventDefault(); this.altErase = true; this.updateButtons(); this.schedule();
        };
        this.modifierUp = event => {
            if (event.type !== "blur" && event.key !== "Alt") return;
            this.altErase = false; this.updateButtons(); this.schedule();
        };
        window.addEventListener("keydown", this.modifierDown, true);
        window.addEventListener("keyup", this.modifierUp, true);
        window.addEventListener("blur", this.modifierUp);
        this.root.addEventListener("keydown", (event) => this.keydown(event));
        this.root.addEventListener("keyup", (event) => {
            if (event.code === "Space") { this.space = false; this.stage.classList.remove("dd-pan"); }
            if (event.key === "Alt") { this.altErase = false; this.updateButtons(); this.schedule(); }
        });
        this.root.addEventListener("blur", () => { this.space = false; this.altErase = false; this.updateButtons(); this.schedule(); }, true);
        const paste = event => {
            const file = [...(event.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
            if (file) { event.preventDefault(); event.stopPropagation(); this.upload(file); }
        };
        this.root.addEventListener("paste", paste);
        if (this.controls) {
            this.controls.addEventListener("paste", paste);
            this.controls.addEventListener("blur", () => { this.space = false; this.altErase = false; this.updateButtons(); this.schedule(); }, true);
            this.controls.addEventListener("keydown", event => this.keydown(event));
            this.controls.addEventListener("keyup", event => {
                if (event.code === "Space") { this.space = false; this.stage.classList.remove("dd-pan"); }
                if (event.key === "Alt") { this.altErase = false; this.updateButtons(); this.schedule(); }
            });
        }
    }

    button(parent, label, title, action, cls = "") {
        const button = el("button", cls, label);
        button.type = "button";
        button.title = title;
        button.setAttribute("aria-label", title);
        button.onclick = (event) => { event.preventDefault(); action(event); };
        parent.append(button);
        return button;
    }

    build() {
        const head = el("div", "dd-head");
        this.sizeLabel = el("span", "dd-dimensions", T("INLINE MASK"));
        head.append(this.sizeLabel);
        this.root.append(head);
        const files = el("div", "dd-row dd-files");
        this.loadButton = this.button(files, T("Load image"), T("Upload an image, or drop / paste one"), () => this.imageInput.click(), "dd-primary");
        this.filename = el("span", "dd-filename", T("Drop an image onto the canvas"));
        files.append(this.filename);
        this.root.append(files);
        this.imageInput = el("input");
        this.imageInput.type = "file";
        this.imageInput.accept = "image/*";
        this.imageInput.hidden = true;
        this.imageInput.onchange = () => { if (this.imageInput.files[0]) this.upload(this.imageInput.files[0]); this.imageInput.value = ""; };
        this.maskInput = el("input");
        this.maskInput.type = "file";
        this.maskInput.accept = "image/*";
        this.maskInput.hidden = true;
        this.maskInput.onchange = async () => {
            const file = this.maskInput.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                try { this.action({ type: "import", image: await loadImage(url) }); }
                catch (error) { this.status(error.message, true); }
                finally { URL.revokeObjectURL(url); }
            }
            this.maskInput.value = "";
        };
        this.root.append(this.imageInput, this.maskInput);
        const tools = el("div", "dd-row dd-tools");
        this.toolButtons = {};
        for (const [name, label, title] of [
            ["brush", "Brush", "Brush (B)"], ["erase", "Eraser", "Eraser (E); hold Alt or right-click for temporary erase"],
            ["rect", "Rectangle", "Rectangle (R)"], ["lasso", "Lasso", "Freehand lasso (L)"],
            ["pan", "Pan", "Pan (H), or hold Space"],
        ]) this.toolButtons[name] = this.button(tools, T(label), T(title), () => this.setTool(name));
        this.root.append(tools);
        const settings = el("div", "dd-settings");
        this.addSlider(settings, T("Brush size"), "brushSize", 1, 512, "px");
        this.addSlider(settings, T("Hardness"), "hardness", 0, 100, "%");
        this.addSlider(settings, T("Brush opacity"), "brushOpacity", 1, 100, "%");
        this.addSlider(settings, T("Overlay"), "overlayOpacity", 0, 100, "%");
        this.stage = el("div", "dd-stage");
        this.canvas = makeCanvas();
        this.canvas.setAttribute("aria-label", T("Inline mask painting canvas; orange areas are repainted"));
        this.stage.append(this.canvas);
        this.empty = el("div", "dd-empty");
        this.empty.append(el("span", "dd-empty-symbol", "+"), el("strong", "", T("Drop an image here")), el("span", "", T("Paint the areas to repaint directly in this node")));
        this.stage.append(this.empty);
        this.root.append(this.stage, settings);
        this.canvas.oncontextmenu = event => event.preventDefault();
        this.canvas.addEventListener("pointerdown", event => this.pointerDown(event));
        this.canvas.addEventListener("pointermove", event => this.pointerMove(event));
        this.canvas.addEventListener("pointerup", event => this.pointerUp(event));
        this.canvas.addEventListener("pointercancel", event => this.pointerUp(event));
        this.canvas.addEventListener("lostpointercapture", event => this.pointerUp(event));
        this.canvas.addEventListener("pointerleave", () => { this.cursor = null; this.schedule(); });
        this.stage.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); this.stage.classList.add("dd-drop"); });
        this.stage.addEventListener("dragleave", () => this.stage.classList.remove("dd-drop"));
        this.stage.addEventListener("drop", event => {
            event.preventDefault(); event.stopPropagation(); this.stage.classList.remove("dd-drop");
            const file = [...event.dataTransfer.files].find(file => file.type.startsWith("image/"));
            if (file) this.upload(file);
        });
        const actions = el("div", "dd-row dd-actions");
        this.undoButton = this.button(actions, T("Undo"), T("Undo (Ctrl+Z)"), () => this.undo());
        this.redoButton = this.button(actions, T("Redo"), T("Redo (Ctrl+Shift+Z)"), () => this.redo());
        this.button(actions, T("Invert"), T("Invert the painted mask"), () => this.action({ type: "invert" }));
        this.button(actions, T("Fill"), T("Fill the whole image with mask"), () => this.action({ type: "fill" }));
        this.button(actions, T("Clear"), T("Clear the mask"), () => this.action({ type: "clear" }));
        this.button(actions, T("Import mask"), T("White repaints, black preserves"), () => { if (this.ready) this.maskInput.click(); });
        this.button(actions, T("Export"), T("Export the mask PNG at full resolution"), () => this.download());
        this.root.append(actions);
        const footer = el("div", "dd-row dd-viewbar");
        this.viewButtons = {};
        for (const [name, label] of [["overlay", "Overlay"], ["image", "Image"], ["mask", "Mask"]]) {
            const text = T(label);
            this.viewButtons[name] = this.button(footer, text, `${text} / ${name}`, () => { this.view = name; this.updateButtons(); this.schedule(); });
        }
        const spacer = el("span", "dd-spacer");
        footer.append(spacer);
        this.zoomLabel = el("span", "dd-zoom", "100%");
        footer.append(this.zoomLabel);
        this.button(footer, T("Fit"), T("Fit the image to the canvas"), () => this.fit());
        this.root.append(footer);
        const embedRow = el("label", "dd-embed");
        this.embed = el("input");
        this.embed.type = "checkbox";
        this.embed.onchange = () => this.options.onEmbed?.(this.embed.checked);
        embedRow.append(this.embed, document.createTextNode(T("Embed the source image in the workflow; no separate file needed when sharing")));
        this.root.append(embedRow);
        this.message = el("div", "dd-status", T("Alt = temporary erase · Ctrl+wheel = brush size · wheel = zoom · Space = pan"));
        this.message.hidden = true;
        this.message.setAttribute("role", "alert");
        this.root.append(this.message);
        if (this.options.compact) {
            this.root.classList.add("dd-inline-minimal");
            this.empty.hidden = true;
            this.controls = el("div", "dd-inpaint dd-editor-controls");
            const info = el("div", "dd-row dd-source-info"); info.append(this.filename, this.sizeLabel);
            head.remove();
            this.controls.append(info, tools, settings, actions, footer, embedRow);
            // These are the original live controls; the sampler mounts this
            // same DOM tree so brush state and callbacks are preserved.
        }
        this.setTool("brush");
        this.updateButtons();
    }

    addSlider(parent, title, key, min, max, unit) {
        const label = el("label", "dd-slider");
        const row = el("span", "dd-slider-label");
        const value = el("output", "", `${this[key]}${unit}`);
        const input = el("input");
        input.type = "range"; input.min = min; input.max = max; input.value = this[key];
        input.setAttribute("aria-label", title);
        input.oninput = () => { this[key] = Number(input.value); value.textContent = `${this[key]}${unit}`; this.schedule(); };
        row.append(document.createTextNode(title), value);
        label.append(row, input);
        parent.append(label);
        this[`${key}Input`] = input;
    }

    status(message, error = false) {
        this.message.textContent = message;
        this.message.classList.toggle("dd-error", error);
        this.message.hidden = !error;
    }

    async upload(file) {
        if (file.size > 64 * 1024 * 1024) { this.status(T("File is too large (max 64 MB)"), true); return; }
        try {
            this.status(T("Loading image…"));
            await this.options.onUpload?.(file);
        } catch (error) { this.status(error.message, true); }
    }

    async setImage(url, maskData = "", name = "") {
        const version = ++this.loadVersion;
        this.ready = false;
        try {
            const [image, loadedMask] = await Promise.all([loadImage(url), maskData ? loadImage(maskData) : Promise.resolve(null)]);
            if (version !== this.loadVersion || this.destroyed) return;
            if (image.width * image.height > 32 * 1024 * 1024 || Math.max(image.width, image.height) > 16384) {
                throw new Error(T("Image is too large; keep it under 32 MP and 16384 px per side"));
            }
            this.image = image;
            for (const canvas of [this.mask, this.baseMask]) { canvas.width = image.width; canvas.height = image.height; }
            this.history = []; this.future = [];
            const ctx = this.mask.getContext("2d", { willReadFrequently: true });
            if (loadedMask) {
                this.importMask(ctx, loadedMask);
            } else {
                // Match Comfy's LoadImage convention: transparent source pixels are masked.
                ctx.drawImage(image, 0, 0);
                const pixels = ctx.getImageData(0, 0, image.width, image.height);
                for (let i = 0; i < pixels.data.length; i += 4) {
                    const alpha = 255 - pixels.data[i + 3];
                    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
                    pixels.data[i + 3] = alpha;
                }
                ctx.putImageData(pixels, 0, 0);
            }
            if (version !== this.loadVersion || this.destroyed) return;
            this.baseMask.getContext("2d").drawImage(this.mask, 0, 0);
            this.sizeLabel.textContent = `${image.width} × ${image.height}`;
            this.filename.textContent = name || T("Embedded image");
            this.filename.title = this.filename.textContent;
            this.empty.hidden = true;
            this.ready = true;
            this.dirty = false;
            this.lastMask = maskData;
            this.fit();
            this.updateButtons();
            this.options.onImage?.(image);
            this.status(T("Orange is the painted mask · Alt = temporary erase · Ctrl+wheel = brush size"));
        } catch (error) {
            if (version === this.loadVersion && !this.destroyed) this.status(error.message, true);
            throw error;
        }
    }

    importMask(ctx, image) {
        const scratch = makeCanvas();
        scratch.width = this.mask.width; scratch.height = this.mask.height;
        const s = scratch.getContext("2d", { willReadFrequently: true });
        s.drawImage(image, 0, 0, scratch.width, scratch.height);
        const pixels = s.getImageData(0, 0, scratch.width, scratch.height);
        let hasAlpha = false;
        for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] !== 255) { hasAlpha = true; break; }
        for (let i = 0; i < pixels.data.length; i += 4) {
            const a = hasAlpha ? pixels.data[i + 3] : Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114);
            pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
            pixels.data[i + 3] = a;
        }
        ctx.clearRect(0, 0, this.mask.width, this.mask.height);
        ctx.putImageData(pixels, 0, 0);
        scratch.width = scratch.height = 0;
    }

    setTool(tool) {
        this.tool = tool;
        if (this.stage) this.stage.classList.toggle("dd-pan", tool === "pan");
        this.updateButtons();
    }

    updateButtons() {
        this.stage?.classList.toggle("dd-erasing", !!(this.altErase || this.tool === "erase" || this.stroke?.type === "erase"));
        for (const [name, button] of Object.entries(this.toolButtons || {})) {
            const active = name === (this.altErase ? "erase" : this.tool);
            button.classList.toggle("dd-active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        for (const [name, button] of Object.entries(this.viewButtons || {})) {
            button.classList.toggle("dd-active", name === this.view);
            button.setAttribute("aria-pressed", String(name === this.view));
        }
        if (this.undoButton) this.undoButton.disabled = !this.history.length;
        if (this.redoButton) this.redoButton.disabled = !this.future.length;
    }

    dimensions() {
        const r = this.canvas.getBoundingClientRect();
        if (this.viewport?.width && this.viewport?.height && r.width && r.height) {
            this.pan.x *= r.width / this.viewport.width;
            this.pan.y *= r.height / this.viewport.height;
        }
        this.viewport = { width: r.width, height: r.height };
        const scale = this.image ? Math.min(r.width / this.image.width, r.height / this.image.height) * this.zoom : 1;
        return { width: r.width, height: r.height, scale, x: (r.width - (this.image?.width || 0) * scale) / 2 + this.pan.x, y: (r.height - (this.image?.height || 0) * scale) / 2 + this.pan.y };
    }

    point(event) {
        const r = this.canvas.getBoundingClientRect();
        const d = this.dimensions();
        return { x: (event.clientX - r.left - d.x) / d.scale, y: (event.clientY - r.top - d.y) / d.scale, p: event.pointerType === "pen" ? Math.max(.05, event.pressure) : 1 };
    }

    pointerDown(event) {
        if (!this.ready || this.pointerId != null) return;
        event.preventDefault(); event.stopPropagation(); this.root.focus({ preventScroll: true });
        this.altErase = !!event.altKey; this.updateButtons();
        this.pointerId = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        this.cursor = this.point(event);
        if (this.space || (!event.altKey && this.tool === "pan") || event.button === 1) {
            this.drag = { x: event.clientX, y: event.clientY, pan: { ...this.pan } };
            return;
        }
        if (this.view === "image") { this.view = "overlay"; this.updateButtons(); }
        this.stroke = { type: event.button === 2 || event.altKey ? "erase" : this.tool, size: this.brushSize, hardness: this.hardness, opacity: this.brushOpacity, points: [this.cursor] };
        this.updateButtons();
        if (["brush", "erase"].includes(this.stroke.type)) this.paintSegment(this.mask.getContext("2d"), this.stroke, this.cursor, this.cursor);
        this.schedule();
    }

    pointerMove(event) {
        if (!this.ready) return;
        if (this.altErase !== !!event.altKey) { this.altErase = !!event.altKey; this.updateButtons(); }
        this.cursor = this.point(event);
        if (event.pointerId === this.pointerId) {
            event.preventDefault(); event.stopPropagation();
            if (this.drag) {
                this.pan.x = this.drag.pan.x + event.clientX - this.drag.x;
                this.pan.y = this.drag.pan.y + event.clientY - this.drag.y;
            } else if (this.stroke) {
                const events = event.getCoalescedEvents?.() || [event];
                if (["brush", "erase"].includes(this.stroke.type)) {
                    const type = event.altKey || (event.buttons & 2) ? "erase" : this.tool;
                    if (["brush", "erase"].includes(type) && type !== this.stroke.type) {
                        // Keep separate commands when Alt is pressed/released mid-stroke.
                        const pivot = this.stroke.points.at(-1);
                        this.remember(this.stroke);
                        this.stroke = { ...this.stroke, type, points: [pivot] };
                        this.paintSegment(this.mask.getContext("2d"), this.stroke, pivot, pivot);
                    }
                }
                for (const e of events.length ? events : [event]) {
                    const point = this.point(e);
                    const previous = this.stroke.points.at(-1);
                    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .2) continue;
                    if (["brush", "erase"].includes(this.stroke.type)) this.paintSegment(this.mask.getContext("2d"), this.stroke, previous, point);
                    this.stroke.points.push(point);
                }
            }
        }
        this.schedule();
    }

    pointerUp(event) {
        if (event.pointerId !== this.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (this.stroke) {
            const command = this.stroke;
            this.stroke = null;
            if (["rect", "lasso"].includes(command.type)) this.drawCommand(this.mask.getContext("2d"), command);
            this.remember(command);
            this.changed();
        }
        this.drag = null;
        const id = this.pointerId; this.pointerId = null;
        if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
        this.updateButtons();
        this.schedule();
    }

    paintSegment(ctx, command, a, b) {
        ctx.save();
        ctx.globalCompositeOperation = command.type === "erase" ? "destination-out" : "source-over";
        ctx.globalAlpha = command.opacity / 100;
        if (command.hardness >= 99 && a.p === 1 && b.p === 1) {
            ctx.strokeStyle = "white"; ctx.fillStyle = "white"; ctx.lineWidth = command.size;
            ctx.lineCap = "round"; ctx.lineJoin = "round";
            if (a.x === b.x && a.y === b.y) { ctx.beginPath(); ctx.arc(a.x, a.y, command.size / 2, 0, Math.PI * 2); ctx.fill(); }
            else { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        } else {
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const count = Math.max(1, Math.ceil(length / Math.max(1, command.size * .15)));
            for (let i = 0; i <= count; i++) {
                const t = i / count, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
                const radius = Math.max(.5, command.size * (a.p + (b.p - a.p) * t) / 2);
                if (command.hardness >= 99) {
                    ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
                } else {
                    const gradient = ctx.createRadialGradient(x, y, radius * command.hardness / 100, x, y, radius);
                    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
                    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
                }
            }
        }
        ctx.restore();
    }

    drawCommand(ctx, command) {
        const w = this.mask.width, h = this.mask.height;
        if (["brush", "erase"].includes(command.type)) {
            this.paintSegment(ctx, command, command.points[0], command.points[0]);
            for (let i = 1; i < command.points.length; i++) this.paintSegment(ctx, command, command.points[i - 1], command.points[i]);
        } else if (command.type === "clear") ctx.clearRect(0, 0, w, h);
        else if (command.type === "fill") { ctx.save(); ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h); ctx.restore(); }
        else if (command.type === "invert") {
            ctx.save(); ctx.globalCompositeOperation = "xor"; ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h); ctx.restore();
        } else if (command.type === "import") this.importMask(ctx, command.image);
        else if (["rect", "lasso"].includes(command.type)) {
            const a = command.points[0], b = command.points.at(-1);
            ctx.save(); ctx.fillStyle = "white"; ctx.globalAlpha = command.opacity / 100;
            if (command.type === "rect") ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
            else { ctx.beginPath(); ctx.moveTo(a.x, a.y); for (const p of command.points) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill(); }
            ctx.restore();
        }
    }

    remember(command) {
        this.history.push(command); this.future = [];
        // Keep commands rather than full-resolution pixel snapshots; memory stays small.
        if (this.history.length > 500) this.drawCommand(this.baseMask.getContext("2d"), this.history.shift());
        this.updateButtons();
    }

    action(command) {
        if (!this.ready) return;
        this.drawCommand(this.mask.getContext("2d"), command); this.remember(command); this.changed();
    }

    replay() {
        const ctx = this.mask.getContext("2d");
        ctx.clearRect(0, 0, this.mask.width, this.mask.height); ctx.drawImage(this.baseMask, 0, 0);
        for (const command of this.history) this.drawCommand(ctx, command);
        this.updateButtons(); this.changed();
    }

    undo() { if (this.history.length && !this.stroke) { this.future.push(this.history.pop()); this.replay(); } }
    redo() { if (this.future.length && !this.stroke) { this.history.push(this.future.pop()); this.replay(); } }

    changed() {
        this.dirty = true;
        this.flush();
        this.schedule();
        this.options.onDirty?.();
    }

    flush() {
        if (!this.ready || (!this.dirty && !this.stroke)) return this.lastMask || "";
        const output = makeCanvas();
        output.width = this.mask.width; output.height = this.mask.height;
        const ctx = output.getContext("2d");
        if (this.stroke && ["rect", "lasso"].includes(this.stroke.type)) {
            // Shape strokes are previews until pointer-up; include them in Save/Run.
            ctx.drawImage(this.mask, 0, 0);
            this.drawCommand(ctx, this.stroke);
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = "black"; ctx.fillRect(0, 0, output.width, output.height);
        } else {
            ctx.fillStyle = "black"; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(this.mask, 0, 0);
        }
        this.lastMask = output.toDataURL("image/png");
        output.width = output.height = 0;
        this.dirty = false;
        this.options.onChange?.(this.lastMask);
        return this.lastMask;
    }

    sourceData() {
        if (!this.ready) return "";
        const canvas = makeCanvas(); canvas.width = this.image.width; canvas.height = this.image.height;
        canvas.getContext("2d").drawImage(this.image, 0, 0);
        const data = canvas.toDataURL("image/png"); canvas.width = canvas.height = 0; return data;
    }

    download() {
        if (!this.ready) return;
        this.dirty = true;
        const link = el("a"); link.download = "adachi-mask.png"; link.href = this.flush(); link.click();
    }

    fit() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.schedule(); }

    setBrushSize(value) {
        this.brushSizeInput.value = Math.max(1, Math.min(512, Math.round(value)));
        this.brushSizeInput.dispatchEvent(new Event("input"));
    }

    wheel(event) {
        if (!this.ready) return;
        event.preventDefault(); event.stopPropagation();
        if (event.ctrlKey) {
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
            if (delta) {
                const scaled = this.brushSize * Math.exp(Math.max(-4, Math.min(4, -delta * .002)));
                // Small wheel deltas must still move by at least one pixel.
                this.setBrushSize(delta < 0 ? Math.max(this.brushSize + 1, scaled) : Math.min(this.brushSize - 1, scaled));
            }
            this.cursor = this.point(event);
            this.schedule();
            return;
        }
        const before = this.point(event);
        this.zoom = Math.max(.1, Math.min(32, this.zoom * Math.exp(-event.deltaY * .0015)));
        const r = this.canvas.getBoundingClientRect(), d = this.dimensions();
        this.pan.x += event.clientX - r.left - (before.x * d.scale + d.x);
        this.pan.y += event.clientY - r.top - (before.y * d.scale + d.y);
        this.schedule();
    }

    keydown(event) {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
        if (event.key === "Alt") { event.preventDefault(); event.stopPropagation(); this.altErase = true; this.updateButtons(); this.schedule(); return; }
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); event.stopPropagation(); event.shiftKey ? this.redo() : this.undo(); }
        else if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); event.stopPropagation(); this.redo(); }
        else if (event.ctrlKey || event.metaKey || event.altKey) return;
        else if (event.code === "Space") { event.preventDefault(); event.stopPropagation(); this.space = true; this.stage.classList.add("dd-pan"); }
        else if ({ b: "brush", e: "erase", r: "rect", l: "lasso", h: "pan" }[key]) { event.preventDefault(); event.stopPropagation(); this.setTool({ b: "brush", e: "erase", r: "rect", l: "lasso", h: "pan" }[key]); }
        else if (["[", "]"].includes(key)) { event.preventDefault(); event.stopPropagation(); this.setBrushSize(this.brushSize + (key === "]" ? 8 : -8)); }
    }

    schedule() { if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

    render() {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const ratio = Math.min(devicePixelRatio || 1, 2);
        const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.overlay.width = w; this.overlay.height = h; }
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
        if (!this.ready) return;
        const d = this.dimensions();
        ctx.setTransform(ratio * d.scale, 0, 0, ratio * d.scale, ratio * d.x, ratio * d.y);
        if (this.view !== "mask") ctx.drawImage(this.image, 0, 0);
        else { ctx.fillStyle = "black"; ctx.fillRect(0, 0, this.image.width, this.image.height); }
        if (this.view !== "image") {
            const overlay = this.overlay.getContext("2d");
            overlay.setTransform(1, 0, 0, 1, 0, 0); overlay.clearRect(0, 0, w, h);
            overlay.setTransform(ratio * d.scale, 0, 0, ratio * d.scale, ratio * d.x, ratio * d.y);
            overlay.drawImage(this.mask, 0, 0);
            if (this.view === "overlay") { overlay.globalCompositeOperation = "source-in"; overlay.fillStyle = "#ffad45"; overlay.fillRect(0, 0, this.mask.width, this.mask.height); overlay.globalCompositeOperation = "source-over"; }
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = this.view === "mask" ? 1 : this.overlayOpacity / 100; ctx.drawImage(this.overlay, 0, 0); ctx.globalAlpha = 1;
        }
        ctx.setTransform(ratio * d.scale, 0, 0, ratio * d.scale, ratio * d.x, ratio * d.y);
        if (this.stroke && ["rect", "lasso"].includes(this.stroke.type)) {
            ctx.save(); ctx.strokeStyle = "#ffcf85"; ctx.lineWidth = 1.5 / d.scale; ctx.setLineDash([5 / d.scale, 4 / d.scale]);
            const a = this.stroke.points[0], b = this.stroke.points.at(-1);
            if (this.stroke.type === "rect") ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
            else { ctx.beginPath(); ctx.moveTo(a.x, a.y); for (const p of this.stroke.points) ctx.lineTo(p.x, p.y); ctx.stroke(); }
            ctx.restore();
        }
        if (this.cursor && (this.altErase || ["brush", "erase"].includes(this.tool)) && !this.drag) {
            const erasing = this.altErase || this.tool === "erase" || this.stroke?.type === "erase";
            ctx.save();
            if (erasing) ctx.setLineDash([4 / d.scale, 3 / d.scale]);
            ctx.beginPath(); ctx.arc(this.cursor.x, this.cursor.y, this.brushSize * this.cursor.p / 2, 0, Math.PI * 2);
            ctx.strokeStyle = "#15191f"; ctx.lineWidth = 3 / d.scale; ctx.stroke(); ctx.strokeStyle = erasing ? "#ffd0d7" : "white"; ctx.lineWidth = 1 / d.scale; ctx.stroke();
            ctx.restore();
        }
        this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    }

    destroy() {
        this.destroyed = true; ++this.loadVersion;
        cancelAnimationFrame(this.frame); this.observer.disconnect();
        this.stopWheelCapture();
        window.removeEventListener("keydown", this.modifierDown, true);
        window.removeEventListener("keyup", this.modifierUp, true);
        window.removeEventListener("blur", this.modifierUp);
        for (const canvas of [this.mask, this.baseMask, this.overlay, this.canvas]) canvas.width = canvas.height = 0;
        this.history = []; this.future = []; this.image = null; this.controls?.remove(); this.root.remove();
    }
}
