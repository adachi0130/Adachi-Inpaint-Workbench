import {T} from './i18n.js';
// Session-only source checkpoints for the full-screen workspace. Capturing and
// restoring never uploads a new image or serializes the rest of the workflow.
const WIDGETS = ["image", "mask_data", "source_data", "edit_mode", "crop_state", "blend_data", "layer_image", "paint_data"];
const copyCommands = commands => (commands || []).map(command => ({ ...command,
    ...(command.points ? {points: command.points.map(point => ({...point}))} : {}),
}));

function contextSnapshot(context) {
    return {
        mask: context.mask.toDataURL("image/png"),
        baseMask: context.baseMask.toDataURL("image/png"),
        history: copyCommands(context.history), future: copyCommands(context.future),
        lastMask: context.lastMask || "", dirty: !!context.dirty,
    };
}

async function decodeCanvas(data) {
    const image = new Image(); image.src = data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas;
}

export function captureSourceState(node) {
    const editor = node.adachiEditor, crop = node.adachiCrop;
    if (!editor?.ready || !editor.image || editor.destroyed) throw Error(T("Load a source image first"));
    if (editor.stroke || editor.pointerId != null || crop?.busy || node.adachiColorPaint?.drawing || node.adachiColorPaint?.restoring) throw Error(T("Finish the current edit first"));
    editor.flush();
    const target = crop?.target || "mask", contexts = {};
    for (const [name, context] of Object.entries(crop?.contexts || {})) {
        if (name !== target && context?.mask && context?.baseMask) contexts[name] = contextSnapshot(context);
    }
    contexts[target] = contextSnapshot(editor);
    const state = {
        widgets: Object.fromEntries(WIDGETS.map(name => [name, node.widgets?.find(widget => widget.name === name)?.value])),
        image: editor.image, layer: crop?.layer || null, contexts, target,
        cropWidth: crop?.cropWidth, cropHeight: crop?.cropHeight,
        filename: editor.filename?.textContent || "", embed: !!editor.embed?.checked,
        view: editor.view, zoom: editor.zoom, pan: {...editor.pan}, keepFit: !!editor.keepFit,
    };
    state.key = JSON.stringify([state.widgets, state.image.src, state.layer?.src, state.contexts, state.target]);
    return state;
}

function releaseContexts(contexts, active) {
    const canvases = new Set();
    for (const context of Object.values(contexts || {})) for (const name of ["mask", "baseMask"]) {
        if (context?.[name] && context[name] !== active?.mask && context[name] !== active?.baseMask) canvases.add(context[name]);
    }
    for (const canvas of canvases) canvas.width = canvas.height = 0;
}

export async function restoreSourceState(node, state, {decode = decodeCanvas, onRestore} = {}) {
    const editor = node.adachiEditor, crop = node.adachiCrop;
    if (!editor || editor.destroyed || !node.graph) throw Error(T("The source image node was removed"));
    if (editor.stroke || editor.pointerId != null || crop?.busy || node.adachiColorPaint?.drawing || node.adachiColorPaint?.restoring) throw Error(T("Finish the current edit first"));
    const loadVersion = editor.loadVersion, maskRevision = editor.maskRevision, cropRevision=crop?.revision, paintRevision=node.adachiColorPaint?.revision;
    const contexts = {};
    let paintSnapshot;
    try {
        // Decode all masks before altering live state. A failed decode leaves
        // the working image, mask and crop completely untouched.
        for (const [name, context] of Object.entries(state.contexts)) {
            const decoded=await Promise.allSettled([decode(context.mask), decode(context.baseMask)]);
            const failed=decoded.find(item=>item.status==='rejected');
            if(failed){for(const item of decoded)if(item.status==='fulfilled')item.value.width=item.value.height=0;throw failed.reason;}
            const [mask,baseMask]=decoded.map(item=>item.value);
            contexts[name] = {...context, mask, baseMask, history:copyCommands(context.history), future:copyCommands(context.future)};
        }
        if(node.adachiColorPaint?.prepareRestore) paintSnapshot = await node.adachiColorPaint.prepareRestore(state.widgets.paint_data || "",state.image.width,state.image.height);
        if (editor.destroyed || !node.graph || editor.loadVersion !== loadVersion || editor.maskRevision !== maskRevision || crop?.revision !== cropRevision || node.adachiColorPaint?.revision !== paintRevision || editor.stroke || editor.pointerId != null || crop?.busy || node.adachiColorPaint?.drawing || node.adachiColorPaint?.restoring) {
            throw Error(T("The image changed during restoration; try again"));
        }
    } catch (error) { releaseContexts(contexts); throw error; }
    const active = contexts[state.target];
    if (!active) { releaseContexts(contexts); throw Error(T("The saved mask state is invalid")); }
    const oldContexts = {...(crop?.contexts || {}), live: {mask:editor.mask, baseMask:editor.baseMask}};
    crop?.stopOriginalPreview?.();
    for (const [name, value] of Object.entries(state.widgets)) {
        const widget = node.widgets?.find(widget => widget.name === name);
        if (widget && value !== undefined) widget.value = value;
    }
    editor.loadVersion++;
    editor.image = state.image;
    Object.assign(editor, active);
    editor.view = state.view; editor.zoom = state.zoom; editor.pan = {...state.pan};
    editor.keepFit = state.keepFit; editor.ready = true;
    editor.stroke = null; editor.pointerId = null; editor.drag = null; editor.cursor = null;
    editor.sceneKey = null; editor.maskRevision++;
    if (editor.filename) { editor.filename.textContent = state.filename; editor.filename.title = state.filename; }
    if (editor.sizeLabel) editor.sizeLabel.textContent = `${state.image.width} × ${state.image.height}`;
    if (editor.embed) editor.embed.checked = state.embed;
    node.properties ??= {}; node.properties.adachi_keep_fit = state.keepFit;
    if (editor.empty) editor.empty.hidden = true;
    if (crop) {
        clearTimeout(crop.resultTimer); crop.pendingResult = null; crop.acceptVersion++;
        crop.contexts = contexts; crop.target = state.target; crop.layer = state.layer;
        crop.cropWidth = state.cropWidth; crop.cropHeight = state.cropHeight;
        crop.hover = null; crop.revision++; crop.patchKey = null;
        crop.syncPreset?.(); crop.sync?.();
    }
    if(node.adachiColorPaint?.commitRestore) node.adachiColorPaint.commitRestore(paintSnapshot,state.image.width,state.image.height);
    releaseContexts(oldContexts, active);
    editor.updateButtons?.(); editor.schedule?.();
    node.graph.setDirtyCanvas?.(true, true);
    await onRestore?.(state);
    return state;
}

function estimateBytes(entries) {
    const images = new Set(); let bytes = 0;
    for (const {state} of entries) {
        bytes += state.key.length * 2;
        for (const image of [state.image, state.layer]) if (image && !images.has(image)) {
            images.add(image); bytes += image.width * image.height * 4;
        }
    }
    return bytes;
}

export class WorkspaceHistory {
    constructor(node, {maxEntries = 12, maxBytes = 256 * 1024 * 1024, onChange, onRestore} = {}) {
        Object.assign(this, {node, maxEntries:Math.max(2,maxEntries), maxBytes, onChange, onRestore});
        this.entries = []; this.index = -1; this.busy = false;
    }
    get current() { return this.entries[this.index] || null; }
    get canUndo() { return this.index > 0 && !this.busy; }
    checkpoint(label = T("Source image")) {
        const state = captureSourceState(this.node);
        if (this.current?.state.key === state.key) return this.current;
        this.entries.splice(this.index + 1);
        const entry = {id:crypto.randomUUID(), label:String(label), state};
        this.entries.push(entry); this.index = this.entries.length - 1;
        // Keep the original and current source reachable; discard intermediate
        // checkpoints first when the session history reaches its budget.
        while (this.entries.length > 2 && (this.entries.length > this.maxEntries || estimateBytes(this.entries) > this.maxBytes)) {
            this.entries.splice(1,1); this.index--;
        }
        this.onChange?.(this); return entry;
    }
    async transact(label, operation) {
        if (this.busy) throw Error(T("Processing the source image; please wait"));
        this.busy = true; this.onChange?.(this);
        try {
            this.checkpoint(this.entries.length ? T("Edited source") : T("Initial source"));
            const result = await operation();
            this.checkpoint(label);
            return result;
        } finally { this.busy = false; this.onChange?.(this); }
    }
    async restore(index) {
        if (this.busy) throw Error(T("Processing the source image; please wait"));
        if (!Number.isInteger(index) || !this.entries[index]) throw Error(T("The source image history entry no longer exists"));
        this.busy = true; this.onChange?.(this);
        try {
            await restoreSourceState(this.node, this.entries[index].state, {onRestore:this.onRestore});
            this.index = index;
            return this.current;
        } finally { this.busy = false; this.onChange?.(this); }
    }
    undo() { return this.restore(this.index - 1); }
    original() { return this.restore(0); }
    clear() { this.entries = []; this.index = -1; this.onChange?.(this); }
}
