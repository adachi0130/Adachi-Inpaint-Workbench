import { app } from "../../scripts/app.js";
import { T } from "./i18n.js";
import { GROUP_PRESETS_TYPE, GroupPresetState } from "./group_preset_state.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
function ensureStyle() {
    if (document.getElementById("adachi-inpaint-style")) return;
    const link = el("link"); link.id = "adachi-inpaint-style"; link.rel = "stylesheet";
    link.href = new URL("./editor.css", import.meta.url).href; document.head.append(link);
}

class GroupPresetsPanel {
    constructor(node) {
        this.node = node; this.root = el("div", "dd-inpaint dd-group-presets");
        this.model = new GroupPresetState(node, operation => {
            app.canvas?.emitBeforeChange?.();
            try { operation(); node.graph?.setDirtyCanvas(true, true); }
            finally { app.canvas?.emitAfterChange?.(); }
            this.refresh(true);
        });
        const toolbar = el("div", "dd-gp-toolbar"); toolbar.append(el("strong", "", T("Group presets")));
        this.add = this.button(toolbar, T("+ New preset"), () => this.showForm("add"));
        this.form = el("form", "dd-gp-form"); this.form.hidden = true;
        this.nameInput = el("input"); this.nameInput.type = "text"; this.nameInput.maxLength = 120;
        this.nameInput.setAttribute("aria-label", T("Preset name"));
        this.form.append(this.nameInput);
        const save = this.button(this.form, T("Save"), () => this.submitName()); save.classList.add("dd-primary");
        this.button(this.form, T("Cancel"), () => { this.form.hidden = true; });
        this.form.onsubmit = event => { event.preventDefault(); this.submitName(); };
        this.nameInput.onkeydown = event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); this.form.hidden = true; } };
        const body = el("div", "dd-gp-body");
        this.presets = el("nav", "dd-gp-presets dd-gp-scroll"); this.presets.setAttribute("aria-label", T("Presets"));
        const detail = el("section", "dd-gp-detail");
        const head = el("div", "dd-gp-detail-head"); this.title = el("strong"); head.append(this.title);
        this.rename = this.button(head, T("Rename"), () => this.showForm("rename"));
        this.groups = el("div", "dd-gp-groups dd-gp-scroll"); this.groups.setAttribute("aria-label", T("Group states"));
        const footer = el("div", "dd-gp-footer");
        this.capture = this.button(footer, T("Save current group states"), () => this.model.saveCurrent());
        this.remove = this.button(footer, T("Delete preset"), () => { if (this.model.active) this.model.remove(this.model.active.id); });
        detail.append(head, this.groups, footer); body.append(this.presets, detail);
        this.status = el("div", "dd-gp-status"); this.status.setAttribute("role", "status");
        this.root.append(toolbar, this.form, body, this.status);
        this.onWheel = event => {
            if (!this.root.contains(event.target)) return;
            const scroll = event.target.closest(".dd-gp-scroll");
            if (scroll && ((event.deltaY < 0 && scroll.scrollTop > 0) || (event.deltaY > 0 && scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1))) {
                event.stopPropagation(); return;
            }
            event.preventDefault(); event.stopPropagation(); app.canvas?.processMouseWheel(event);
        };
        window.addEventListener("wheel", this.onWheel, { capture: true, passive: false });
        this.timer = setInterval(() => { if (this.root.isConnected && !document.hidden) this.refresh(); }, 500);
        this.refresh(true);
    }
    button(parent, label, callback) { const button = el("button", "", label); button.type = "button"; button.onclick = event => { event.stopPropagation(); callback(); }; parent.append(button); return button; }
    showForm(mode) {
        this.formMode = mode; this.form.hidden = false;
        this.nameInput.value = mode === "rename" ? this.model.active?.name || "" : `${T("Preset")} ${this.model.data.presets.length + 1}`;
        this.nameInput.focus({ preventScroll: true }); this.nameInput.select();
    }
    submitName() {
        const name = this.nameInput.value.trim(); if (!name) { this.nameInput.focus(); return; }
        if (this.formMode === "rename" && this.model.active) this.model.rename(this.model.active.id, name);
        else this.model.add(name);
        this.form.hidden = true;
    }
    apply(id) {
        this.model.apply(id);
    }
    refresh(force = false) {
        const active = this.model.active, groups = this.model.groups();
        const signature = JSON.stringify([this.model.data, groups.map(g => [g.key, g.title, g.color, g.nodes.map(n => [n.id, n.mode])]), T("Group presets")]);
        if (!force && signature === this.signature) return;
        this.signature = signature;
        const navScroll = this.presets.scrollTop, groupScroll = this.groups.scrollTop;
        this.presets.replaceChildren(); this.groups.replaceChildren();
        for (const preset of this.model.data.presets) {
            const button = this.button(this.presets, preset.name, () => this.apply(preset.id));
            button.dataset.presetId = preset.id; button.title = preset.name;
            button.classList.toggle("dd-active", preset.id === active?.id);
            button.setAttribute("aria-pressed", String(preset.id === active?.id));
        }
        if (!this.model.data.presets.length) this.presets.append(el("div", "dd-gp-empty", T("Add a preset to get started")));
        this.title.textContent = active?.name || T("Group states"); this.title.title = this.title.textContent;
        const expected = active ? this.model.planStates(active, groups) : { plan: new Map(), stats: {} };
        for (const group of groups) {
            const row = el("label", "dd-gp-group"); row.dataset.groupKey = group.key;
            const dot = el("span", "dd-gp-color"); dot.style.background = group.color;
            const label = el("span", "dd-gp-group-name", group.title); label.title = `${group.title} · ${group.key}`;
            const select = el("select"); select.setAttribute("aria-label", group.title); select.disabled = !active;
            for (const [value, name] of [["", "Keep current"], ["0", "Enabled"], ["4", "Bypassed"]]) {
                const option = el("option", "", T(name)); option.value = value; select.append(option);
            }
            const saved = active?.groups[group.key]; select.value = saved ? String(saved.mode) : "";
            if (saved && group.nodes.some(n => n.mode !== expected.plan.get(n))) { row.classList.add("dd-gp-changed"); label.title += ` · ${T("Current group state differs from the preset")}`; }
            select.onchange = () => { if (active) this.model.setGroup(active.id, group.key, select.value === "" ? null : Number(select.value)); };
            row.append(dot, label, select); this.groups.append(row);
        }
        if (!groups.length) this.groups.append(el("div", "dd-gp-empty", T("No groups in this workflow yet")));
        for (const button of [this.rename, this.capture, this.remove]) button.disabled = !active;
        const missing = active ? Object.keys(active.groups).filter(key => !groups.some(g => g.key === key)).length : 0;
        this.status.textContent = `${this.model.data.presets.length} ${T("presets")} · ${groups.length} ${T("groups")}${missing ? ` · ${missing} ${T("missing groups")}` : ""}${expected.stats.overlaps ? ` · ${T("Overlapping groups use the smaller group's setting")}` : ""}`;
        this.presets.scrollTop = navScroll; this.groups.scrollTop = groupScroll;
    }
    destroy() { clearInterval(this.timer); window.removeEventListener("wheel", this.onWheel, true); this.root.remove(); }
}

app.registerExtension({
    name: "Adachi.GroupPresets",
    registerCustomNodes() {
        ensureStyle();
        class GroupPresetsNode extends LGraphNode {
            constructor() {
                super(T("Group Bypass Presets"));
                this.isVirtualNode = true; this.comfyClass = GROUP_PRESETS_TYPE;
                this.serialize_widgets = false;
                this.properties ??= {};
                this.adachiGroupPresets = new GroupPresetsPanel(this);
                const widget = this.addDOMWidget("group_presets", "adachi_group_presets", this.adachiGroupPresets.root, {
                    serialize: false, hideOnZoom: false, getMinHeight: () => 290, getMaxHeight: () => 1600,
                });
                widget.serialize = false; this.setSize([620, 410]);
            }
            onAdded() { this.adachiGroupPresets.refresh(true); }
            onConfigure() { this.adachiGroupPresets.model.restore(); this.adachiGroupPresets.refresh(true); }
            onRemoved() { this.adachiGroupPresets.destroy(); }
            getExtraMenuOptions(_, options) {
                const panel = this.adachiGroupPresets;
                options.push(null, { content: T("Apply preset"), has_submenu: true, disabled: !panel.model.data.presets.length,
                    submenu: { options: panel.model.data.presets.map(p => ({ content: `${p.id === panel.model.data.activeId ? "✓ " : ""}${p.name}`, callback: () => panel.apply(p.id) })) } },
                    { content: T("+ New preset"), callback: () => panel.showForm("add") },
                    { content: T("Save current group states"), disabled: !panel.model.active, callback: () => panel.model.saveCurrent() });
            }
        }
        GroupPresetsNode.title = T("Group Bypass Presets");
        GroupPresetsNode.desc = T("Switch saved group enable/bypass presets; no connections required.");
        LiteGraph.registerNodeType(GROUP_PRESETS_TYPE, GroupPresetsNode);
        GroupPresetsNode.category = "Adachi-Inpaint-Workbench";
    },
});
