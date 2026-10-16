import { INPAINT_FIELDS } from "./inpaint_panel.js";

const hiddenWidgets = new WeakMap();
const targetSizes = new WeakMap();

function setHiddenOption(widget, value) {
    widget.options ??= {};
    // Recent frontends keep a reactive options proxy on BaseWidget state.
    // Write through that proxy first so Nodes 2.0 observes runtime relocation.
    const options = widget._state?.options || widget.options;
    if (value === undefined) delete options.hidden; else options.hidden = value;
    if (value === undefined) delete widget.options.hidden; else widget.options.hidden = value;
}

export function connectedEditor(target) {
    const graph = target.graph; if (!graph) return null;
        const input = target.inputs?.find(input => input.name === "image");
        const link = graph.links?.[input?.link]; const queue = link ? [link.origin_id] : [], seen = new Set(), sources = new Set();
        while (queue.length && seen.size < 256) {
            const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
            const current = graph.getNodeById(id); if (!current) continue;
            if (current.type === "AdachiInlineMask") { sources.add(current.id); continue; }
            for (const input of current.inputs || []) {
                if (current.type === "AdachiImageCompare" && input.name !== "result") continue;
                if (!["IMAGE", "*"].includes(input.type)) continue;
                const next = graph.links?.[input.link]; if (next) queue.push(next.origin_id);
            }
        }
        return sources.size === 1 ? graph.getNodeById([...sources][0]) : null;
}

export function connectedSamplers(source) {
    return (source.graph?._nodes || [])
        .filter(node => ["AdachiWebUIInpaint", "AdachiInpaintPrepare"].includes(node.type) && connectedEditor(node) === source)
        .sort((a, b) => Number(b.type === "AdachiWebUIInpaint") - Number(a.type === "AdachiWebUIInpaint"));
}

// Use the same rounding, range and linked-input rules as Use source size.
export function syncCropDimensions(source, width, height) {
    const aligned = value => Math.max(64, Math.min(8192, Math.round(value / 8) * 8));
    for (const target of connectedSamplers(source)) {
        target.adachiParameters?.refresh();
        for (const [name, value] of [["width", width], ["height", height]]) {
            if (target.inputs?.some(input => input.name === name && input.link != null)) continue;
            const widget = target.widgets?.find(widget => widget.name === name);
            if (widget && widget.value !== aligned(value)) {
                widget.value = aligned(value);
                widget.callback?.(widget.value);
            }
        }
        target.adachiParameters?.refresh();
    }
}

export function relocateWidgets(owner, previous, next) {
    if (previous) {
        for (const widget of previous.widgets || []) {
            const state = hiddenWidgets.get(widget); if (!state) continue;
            state.owners.delete(owner); if (state.owners.size) continue;
            widget.type = state.type; widget.hidden = state.hidden;
            setHiddenOption(widget, state.optionHidden);
            if (state.ownComputeSize) widget.computeSize = state.computeSize; else delete widget.computeSize;
            if (state.element) state.element.style.display = state.display;
            hiddenWidgets.delete(widget);
        }
        const size = targetSizes.get(previous); if (size) { previous.setSize([previous.size[0], Math.max(size[1], previous.computeSize()[1])]); targetSizes.delete(previous); }
    }
    if (next) {
        if (!targetSizes.has(next)) targetSizes.set(next, [...next.size]);
        for (const widget of next.widgets || []) {
            if (!INPAINT_FIELDS.includes(widget.name)) continue;
            let state = hiddenWidgets.get(widget);
            if (!state) {
                const element = widget.element || widget.inputEl;
                state = { type: widget.type, hidden: widget.hidden, optionHidden: widget.options?.hidden, ownComputeSize: Object.hasOwn(widget, "computeSize"), computeSize: widget.computeSize, element, display: element?.style.display || "", owners: new Set() };
                hiddenWidgets.set(widget, state);
                widget.type = "hidden"; widget.hidden = true; setHiddenOption(widget, true);
                widget.computeSize = () => [0, -4]; if (element) element.style.display = "none";
            }
            state.owners.add(owner);
        }
        next.setSize([next.size[0], next.computeSize()[1]]);
    }
}
