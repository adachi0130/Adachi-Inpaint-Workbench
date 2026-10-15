/* Inline controls edit the connected sampler's real widgets, not a second set of parameters. */
import { T } from "./i18n.js";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
export const INPAINT_FIELDS = ["mask_mode", "fill", "area", "padding", "width", "height", "denoise", "sampler_name", "scheduler", "steps", "cfg", "seed", "control_after_generate", "batch_size", "mask_blur", "mask_grow", "resize_mode", "inpaint_model", "soft_edge", "soft_strength", "refiner_switch"];
const choices = {
    mask_mode: { inside: "Inside mask", outside: "Outside mask" },
    fill: { fill: "Fill", original: "Original pixels", latent_noise: "Latent noise", latent_nothing: "Empty latent" },
    area: { whole_image: "Whole image", only_masked: "Masked area only" },
    resize_mode: { stretch: "Stretch", crop: "Center crop", fill: "Aspect fill" },
    control_after_generate: { fixed: "Fixed", increment: "Increment", decrement: "Decrement", randomize: "Randomize" },
};

export class InpaintParameterPanel {
    constructor(options) {
        this.options = options; this.bindings = []; this.root = el("section", "dd-parameters");
        const header = el("div", "dd-param-header"); header.append(el("strong", "", T("WebUI Inpaint")));
        this.targetSelect = el("select"); this.targetSelect.setAttribute("aria-label", T("Controlled WebUI inpaint node"));
        this.targetSelect.onchange = () => { this.preferred = this.targetSelect.value; this.options.onPreferred?.(this.preferred); this.refresh(); };
        header.append(this.targetSelect); this.root.append(header);
        this.placeholder = el("div", "dd-param-placeholder", T("Connect a WebUI inpaint node to edit its parameters here"));
        this.body = el("div", "dd-param-body"); this.root.append(this.placeholder, this.body);
        this.observer = new ResizeObserver(() => options.onHeight?.()); this.observer.observe(this.root);
        this.timer = setInterval(() => { if (this.root.isConnected && !document.hidden) this.refresh(); }, 350);
        this.refresh();
    }

    refresh() {
        const targets = this.options.getTargets?.() || [];
        const preferred = this.preferred || this.options.getPreferred?.();
        const next = targets.find(n => String(n.id) === String(preferred)) || targets[0] || null;
        const signature = targets.map(n => `${n.id}:${n.title}`).join("|");
        if (signature !== this.signature) {
            this.signature = signature; this.targetSelect.replaceChildren();
            for (const n of targets) { const option = el("option", "", `${n.title || T("WebUI Inpaint")} #${n.id}`); option.value = String(n.id); this.targetSelect.append(option); }
        }
        this.targetSelect.hidden = targets.length < 2;
        if (next) this.targetSelect.value = String(next.id);
        if (next !== this.target) {
            const previous = this.target; this.target = next;
            this.options.onTargetChange?.(previous, next);
            this.bindings = []; this.body.replaceChildren();
            if (next) this.build();
            this.options.onHeight?.();
        }
        this.placeholder.hidden = !!next; this.body.hidden = !next;
        for (const binding of this.bindings) binding.sync();
        if (this.sourceSize) this.sourceSize.disabled = !this.options.getImage?.();
    }

    widget(name) { return this.target?.widgets?.find(w => w.name === name); }
    linked(name) { return this.target?.inputs?.some(input => input.name === name && input.link != null); }
    write(name, value, commit = false) {
        const widget = this.widget(name); if (!widget || this.linked(name)) return;
        if (widget.value !== value) { widget.value = value; widget.callback?.(value); }
        if (commit) this.options.onDirty?.();
    }

    enum(parent, name, label, pills = false) {
        const widget = this.widget(name); if (!widget) return;
        label = T(label);
        const wrapper = el("div", "dd-param-field"); wrapper.append(el("span", "dd-param-label", label));
        let values = widget.options?.values; if (typeof values === "function") values = values();
        if (!Array.isArray(values)) values = Object.keys(choices[name] || {});
        if (!values.includes(widget.value)) values = [widget.value, ...values];
        const display = value => choices[name]?.[value] ? T(choices[name][value], "enum") : String(value);
        if (pills) {
            const row = el("div", "dd-param-pills");
            const buttons = values.map(value => {
                const button = el("button", "", display(value)); button.type = "button";
                button.onclick = () => { this.write(name, value, true); this.refresh(); }; row.append(button); return { button, value };
            });
            wrapper.append(row); this.bindings.push({ sync: () => { for (const {button,value} of buttons) { button.classList.toggle("dd-active", widget.value === value); button.setAttribute("aria-pressed", String(widget.value === value)); button.disabled = this.linked(name); } } });
        } else {
            const select = el("select"); select.setAttribute("aria-label", label);
            for (const value of values) { const option = el("option", "", display(value)); option.value = value; select.append(option); }
            select.onchange = () => this.write(name, select.value, true); wrapper.append(select);
            this.bindings.push({ sync: () => { if (document.activeElement !== select) select.value = widget.value; select.disabled = this.linked(name); } });
        }
        parent.append(wrapper);
    }

    number(parent, name, label, { min, max, step = 1, range = false, rangeMax = max } = {}) {
        const widget = this.widget(name); if (!widget) return;
        label = T(label);
        min ??= widget.options?.min ?? 0; max ??= widget.options?.max ?? 1000000;
        const wrapper = el("label", "dd-param-field"); const row = el("span", "dd-param-number-label"); row.append(el("span", "", label));
        const input = el("input"); input.type = "number"; input.min = min; input.max = max; input.step = step; input.setAttribute("aria-label", label); row.append(input); wrapper.append(row);
        let slider;
        const update = raw => {
            if (raw === "" || !Number.isFinite(Number(raw))) return;
            const value = Math.max(min, Math.min(max, Math.round(Number(raw) / step) * step));
            this.write(name, Number(value.toFixed(step < 1 ? Math.ceil(-Math.log10(step)) : 0)));
            if (slider) slider.value = widget.value;
        };
        input.oninput = () => update(input.value); input.onchange = () => { update(input.value); input.value = widget.value; this.options.onDirty?.(); };
        if (range) {
            slider = el("input"); slider.type = "range"; slider.min = min; slider.max = rangeMax ?? max; slider.step = step; slider.setAttribute("aria-label", `${label} slider`);
            slider.oninput = () => { update(slider.value); input.value = widget.value; }; slider.onchange = () => this.options.onDirty?.(); wrapper.append(slider);
        }
        this.bindings.push({ sync: () => {
            if (document.activeElement !== input) input.value = widget.value;
            if (slider && document.activeElement !== slider) slider.value = widget.value;
            input.disabled = this.linked(name); if (slider) slider.disabled = input.disabled;
        } }); parent.append(wrapper);
    }

    toggle(parent, name, label) {
        const widget = this.widget(name); if (!widget) return;
        const wrapper = el("label", "dd-param-toggle"), input = el("input"); input.type = "checkbox";
        input.onchange = () => this.write(name, input.checked, true); wrapper.append(input, document.createTextNode(T(label))); parent.append(wrapper);
        this.bindings.push({ sync: () => { input.checked = !!widget.value; input.disabled = this.linked(name); } });
    }

    grid(parent) { const grid = el("div", "dd-param-grid"); parent.append(grid); return grid; }

    build() {
        this.enum(this.body, "mask_mode", "Mask mode", true);
        this.enum(this.body, "fill", "Fill content", true);
        this.enum(this.body, "area", "Sampling area", true);
        const resolution = el("div", "dd-param-resolution"); resolution.append(el("span", "dd-param-label", T("Sampling resolution")));
        this.sourceSize = el("button", "", T("Use source size")); this.sourceSize.type = "button";
        this.sourceSize.title = T("Fill width and height from the current source image; aligned to 8 px and clamped to 64-8192 px");
        this.sourceSize.onclick = () => {
            const image = this.options.getImage?.(); if (!image) return;
            const aligned = value => Math.max(64, Math.min(8192, Math.round(value / 8) * 8));
            this.write("width", aligned(image.naturalWidth || image.width)); this.write("height", aligned(image.naturalHeight || image.height));
            this.options.onDirty?.(); this.refresh();
        };
        resolution.append(this.sourceSize); this.body.append(resolution);
        this.number(this.body, "width", "Width", { min: 64, max: 8192, step: 8, range: true });
        this.number(this.body, "height", "Height", { min: 64, max: 8192, step: 8, range: true });
        this.number(this.body, "denoise", "Denoise", { min: 0, max: 1, step: .01, range: true });
        const sampling = this.grid(this.body); this.enum(sampling, "sampler_name", "Sampler"); this.enum(sampling, "scheduler", "Scheduler");
        const scale = this.grid(this.body);
        this.number(scale, "steps", "Steps", { min: 1, max: 10000, range: true, rangeMax: 150 });
        this.number(scale, "cfg", "CFG scale", { min: 0, max: 100, step: .1, range: true, rangeMax: 30 });
        const seed = this.grid(this.body); this.number(seed, "seed", "Seed", { min: 0, max: Number.MAX_SAFE_INTEGER }); this.enum(seed, "control_after_generate", "After generate");
        const advanced = el("details", "dd-param-advanced"), summary = el("summary", "", T("Mask, batch and advanced settings")); advanced.append(summary);
        const content = el("div", "dd-param-advanced-body"); advanced.append(content);
        this.number(content, "padding", "Context padding", { min: 0, max: 2048 });
        const masks = this.grid(content);
        this.number(masks, "mask_blur", "Mask blur", { min: 0, max: 128, step: .5 }); this.number(masks, "mask_grow", "Mask grow / shrink", { min: -128, max: 128 });
        const batch = this.grid(content); this.number(batch, "batch_size", "Batch size", { min: 1, max: 16 }); this.enum(batch, "resize_mode", "Resize mode");
        this.toggle(content, "inpaint_model", "Use dedicated inpaint model"); this.toggle(content, "soft_edge", "Extra edge feathering");
        this.number(content, "soft_strength", "Feather strength", { min: 0, max: 1, step: .05, range: true });
        this.number(content, "refiner_switch", "Refiner switch ratio", { min: 0, max: 1, step: .01, range: true }); this.body.append(advanced);
    }

    destroy() { clearInterval(this.timer); this.observer.disconnect(); this.options.onTargetChange?.(this.target, null); this.target = null; this.root.remove(); }
}
