/* Serializable group presets; no ComfyUI or third-party extension dependency. */
export const GROUP_PRESETS_TYPE = "AdachiGroupPresets";
const ACTIVE = 0, BYPASS = 4;
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function groupKey(group, persist = false) {
    if (group.id != null && group.id !== -1) return `group:${group.id}`;
    if (persist) { group.flags ??= {}; group.flags.adachi_preset_id ??= uuid(); }
    return group.flags?.adachi_preset_id ? `legacy:${group.flags.adachi_preset_id}` : `unsaved:${group.title}:${Array.from(group.pos || []).join(",")}`;
}

function members(group, seen = new Set()) {
    if (seen.has(group)) return [];
    seen.add(group); group.recomputeInsideNodes?.();
    const result = new Set();
    for (const item of group._children || group._nodes || group.nodes || []) {
        if (typeof item.recomputeInsideNodes === "function") {
            for (const node of members(item, seen)) result.add(node);
        } else if (item.mode != null && item.type !== GROUP_PRESETS_TYPE) result.add(item);
    }
    return [...result];
}

export class GroupPresetState {
    constructor(node, change) { this.node = node; this.change = change; this.restore(); }
    restore() {
        const raw = this.node.properties.adachi_group_presets;
        const ids = new Set();
        const presets = (Array.isArray(raw?.presets) ? raw.presets : []).filter(p => p && typeof p.id === "string" && !ids.has(p.id) && ids.add(p.id)).map(p => ({
            id: p.id, name: String(p.name || "Preset"),
            groups: Object.fromEntries(Object.entries(p.groups || {}).filter(([, state]) => state && [ACTIVE, BYPASS].includes(state.mode)).map(([key, state]) => [key, { mode: state.mode, title: String(state.title || key) }])),
        }));
        this.node.properties.adachi_group_presets = { version: 1, activeId: presets.some(p => p.id === raw?.activeId) ? raw.activeId : presets[0]?.id || null, presets };
    }
    get data() { return this.node.properties.adachi_group_presets; }
    get active() { return this.data.presets.find(p => p.id === this.data.activeId) || null; }
    groups(persist = false) {
        return Array.from(this.node.graph?.groups || this.node.graph?._groups || []).map(group => {
            const nodes = members(group);
            const modes = new Set(nodes.map(node => node.mode));
            return { key: groupKey(group, persist), title: String(group.title || "Group"), color: group.color || "#64748b", group, nodes, mode: modes.size === 1 ? [...modes][0] : nodes.length ? -1 : ACTIVE,
                area: Math.abs((group.size?.[0] || 1) * (group.size?.[1] || 1)) };
        });
    }
    capture() {
        return Object.fromEntries(this.groups(true).map(group => [group.key, { title: group.title, mode: group.nodes.some(node => node.mode === ACTIVE) || !group.nodes.length ? ACTIVE : BYPASS }]));
    }
    add(name) {
        const title = String(name).trim(); if (!title) return null;
        let created;
        this.change(() => {
            created = { id: uuid(), name: title, groups: this.capture() };
            this.data.presets.push(created); this.data.activeId = created.id;
        });
        return created;
    }
    rename(id, name) {
        const preset = this.data.presets.find(p => p.id === id), title = String(name).trim();
        if (preset && title) this.change(() => { preset.name = title; });
    }
    saveCurrent() { if (this.active) this.change(() => { this.active.groups = this.capture(); }); }
    remove(id) {
        this.change(() => {
            this.data.presets = this.data.presets.filter(p => p.id !== id);
            if (this.data.activeId === id) { this.data.activeId = this.data.presets[0]?.id || null; if (this.active) this.applyStates(this.active); }
        });
    }
    setGroup(presetId, key, mode) {
        const preset = this.data.presets.find(p => p.id === presetId), group = this.groups().find(g => g.key === key);
        if (!preset || !group) return;
        this.change(() => {
            if (mode == null) delete preset.groups[key];
            else {
                const stableKey = groupKey(group.group, true);
                if (stableKey !== key) delete preset.groups[key];
                preset.groups[stableKey] = { title: group.title, mode: mode === BYPASS ? BYPASS : ACTIVE };
            }
            if (this.data.activeId === presetId) this.applyStates(preset);
        });
    }
    apply(id) {
        const preset = this.data.presets.find(p => p.id === id); if (!preset) return null;
        let result;
        this.change(() => { this.data.activeId = id; result = this.applyStates(preset); });
        return result;
    }
    planStates(preset, available = this.groups()) {
        const groups = available.filter(g => preset.groups[g.key]).sort((a, b) => b.area - a.area || a.key.localeCompare(b.key));
        const plan = new Map(), overlaps = new Set();
        // Smaller (more specific) groups override enclosing/overlapping groups.
        for (const group of groups) {
            const mode = preset.groups[group.key].mode;
            for (const node of group.nodes) {
                if (plan.has(node) && plan.get(node) !== mode) overlaps.add(node);
                plan.set(node, mode);
            }
        }
        return { plan, stats: { groups: groups.length, nodes: plan.size, overlaps: overlaps.size, missing: Object.keys(preset.groups).length - groups.length } };
    }
    applyStates(preset) {
        const { plan, stats } = this.planStates(preset);
        for (const [node, mode] of plan) node.mode = mode;
        return stats;
    }
}
