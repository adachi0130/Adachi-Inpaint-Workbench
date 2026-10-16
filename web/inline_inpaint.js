import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { InlineMaskEditor } from "./editor.js";
import { installInpaintWorkbench } from "./inpaint_node.js";
import { routeWheelOutsideImage } from "./wheel_routing.js";
import { T } from "./i18n.js";

const styleId = "adachi-inpaint-style";
if (!document.getElementById(styleId)) {
    const link = document.createElement("link");
    link.id = styleId; link.rel = "stylesheet";
    link.href = new URL("./editor.css", import.meta.url).href;
    document.head.append(link);
}

function hide(widget) {
    if (!widget) return;
    widget.type = "hidden";
    widget.hidden = true;
    // Nodes 2.0 keeps the original options object in its widget value store.
    // Mutate that object so the hidden rows disappear in both renderers.
    widget.options ??= {};
    widget.options.hidden = true;
    widget.computeSize = () => [0, -4];
    const element = widget.element || widget.inputEl;
    if (element) element.style.display = "none";
}

function imageUrl(value) {
    let name = String(value || "");
    let type = "input";
    const match = name.match(/\s*\[(input|output|temp)\]$/);
    if (match) { type = match[1]; name = name.slice(0, match.index); }
    name = name.replaceAll("\\", "/");
    const split = name.lastIndexOf("/");
    const params = new URLSearchParams({ filename: name.slice(split + 1), subfolder: split < 0 ? "" : name.slice(0, split), type });
    return api.apiURL(`/view?${params}`);
}

app.registerExtension({
    name: "Adachi.InlineInpaint",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (["AdachiWebUIInpaint", "AdachiInpaintPrepare"].includes(nodeData.name)) { installInpaintWorkbench(nodeType); return; }
        if (nodeData.name !== "AdachiInlineMask") return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            const node = this;
            const markChanged = () => {
                // ChangeTracker requires a balanced pair to register a DOM edit.
                if (app.canvas?.emitBeforeChange && app.canvas?.emitAfterChange) {
                    app.canvas.emitBeforeChange();
                    app.canvas.emitAfterChange();
                }
                node.graph?.setDirtyCanvas(true, true);
            };
            const find = name => node.widgets?.find(widget => widget.name === name);
            const imageWidget = find("image"), maskWidget = find("mask_data"), sourceWidget = find("source_data");
            for (const widget of [imageWidget, maskWidget, sourceWidget]) hide(widget);
            let restoring = false;
            let restoreFrame = 0;
            let uploadVersion = 0;
            let fitFrame = 0;
            const fitNodeToImage = () => {
                cancelAnimationFrame(fitFrame);
                fitFrame = requestAnimationFrame(() => {
                    if (!editor.ready || editor.destroyed || !node.graph) return;
                    const rect = editor.canvas.getBoundingClientRect();
                    const scale = app.canvas?.ds?.scale || 1;
                    if (!rect.width || !rect.height) return;
                    const overhead = node.size[1] - rect.height / scale;
                    const height = overhead + rect.width / scale * editor.image.height / editor.image.width;
                    node.setSize([node.size[0], Math.max(240, Math.min(4200, Math.ceil(height)))]);
                    node.properties.adachi_compact_ui = true;
                    editor.schedule();
                });
            };
            const restore = async () => {
                const embedded = sourceWidget?.value;
                const filename = imageWidget?.value;
                if (!embedded && !filename) return;
                restoring = true;
                editor.embed.checked = !!embedded;
                try { await editor.setImage(embedded || imageUrl(filename), maskWidget?.value || "", embedded ? T("Embedded image") : filename); }
                catch (error) { console.warn("[Adachi Inpaint]", error); }
                finally { restoring = false; }
            };
            const editor = new InlineMaskEditor({
                compact: true,
                onChange(data) { if (maskWidget && !restoring) maskWidget.value = data; },
                onDirty() { markChanged(); },
                onImage() { if (!restoring || !node.properties.adachi_compact_ui) fitNodeToImage(); },
                onGraphWheel: event => app.canvas?.processMouseWheel(event),
                async onUpload(file, { preserveMask = false } = {}) {
                    if (preserveMask && editor.image && !editor.ready) throw new Error(T("Wait for the source image to finish loading before adopting a result"));
                    const version = ++uploadVersion;
                    const body = new FormData();
                    body.append("image", file, file.name);
                    body.append("type", "input");
                    body.append("subfolder", "adachi-inpaint");
                    const response = await api.fetchApi("/upload/image", { method: "POST", body });
                    if (!response.ok) throw new Error(`${T("Upload failed")} (${response.status})`);
                    const uploaded = await response.json();
                    if (version !== uploadVersion || editor.destroyed) return;
                    const name = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
                    restoring = false;
                    if (preserveMask && editor.ready) await editor.replaceSource(imageUrl(name), file.name);
                    else await editor.setImage(imageUrl(name), "", file.name);
                    if (version !== uploadVersion || editor.destroyed) return;
                    imageWidget.value = name;
                    maskWidget.value = preserveMask ? editor.flush() : "";
                    sourceWidget.value = editor.embed.checked ? editor.sourceData() : "";
                    markChanged();
                },
                onEmbed(enabled) {
                    if (sourceWidget) sourceWidget.value = enabled ? editor.sourceData() : "";
                    markChanged();
                },
            });
            node.adachiEditor = editor;
            const stopWheelRouting = routeWheelOutsideImage(editor.root, editor.canvas, () => editor.ready);
            node.adachiUseResult = async file => {
                if (editor.destroyed) throw new Error(T("The inline mask node was removed"));
                await editor.options.onUpload(file, { preserveMask: true });
                editor.view = "overlay"; editor.updateButtons(); editor.schedule();
                editor.status(T("Adopted the result as the new source image; the mask and undo history were preserved"));
            };
            const domWidget = node.addDOMWidget("adachi_canvas", "adachi_inline_mask", editor.root, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 170,
                getMaxHeight: () => 4096,
            });
            domWidget.serialize = false;
            // Leave computeLayoutSize in charge: a fixed computeSize height
            // prevents the DOM canvas from growing with the node vertically.
            const resizeHandle = document.createElement("div");
            resizeHandle.className = "dd-resize-handle";
            resizeHandle.textContent = "↕";
            resizeHandle.title = T("Drag to resize canvas height");
            resizeHandle.tabIndex = 0;
            resizeHandle.setAttribute("role", "separator");
            resizeHandle.setAttribute("aria-orientation", "horizontal");
            resizeHandle.setAttribute("aria-label", T("Resize canvas height"));
            editor.root.append(resizeHandle);
            let resizing = null;
            const resizeHeight = height => {
                node.setSize([node.size[0], Math.max(240, Math.min(4200, height))]);
                node.graph?.setDirtyCanvas(true, true);
                editor.schedule();
            };
            resizeHandle.addEventListener("pointerdown", event => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation();
                resizing = { id: event.pointerId, y: event.clientY, height: node.size[1], scale: app.canvas?.ds?.scale || 1 };
                resizeHandle.setPointerCapture(event.pointerId);
            });
            resizeHandle.addEventListener("pointermove", event => {
                if (!resizing || event.pointerId !== resizing.id) return;
                event.preventDefault(); event.stopPropagation();
                resizeHeight(resizing.height + (event.clientY - resizing.y) / resizing.scale);
            });
            const finishResize = event => {
                if (!resizing || event.pointerId !== resizing.id) return;
                event.preventDefault(); event.stopPropagation();
                const id = resizing.id; resizing = null;
                if (resizeHandle.hasPointerCapture(id)) resizeHandle.releasePointerCapture(id);
                markChanged();
            };
            for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) resizeHandle.addEventListener(name, finishResize);
            resizeHandle.addEventListener("keydown", event => {
                if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                resizeHeight(node.size[1] + (event.key === "ArrowDown" ? 40 : -40));
                markChanged();
            });
            // A synchronous flush protects Run/Save while a pointer is still down.
            const previousSerialize = maskWidget.serializeValue;
            maskWidget.serializeValue = function () {
                editor.flush();
                return previousSerialize ? previousSerialize.apply(this, arguments) : maskWidget.value;
            };
            const previousSerializeNode = node.onSerialize;
            node.onSerialize = function (data) {
                editor.flush();
                const index = node.widgets.indexOf(maskWidget);
                if (data?.widgets_values && index >= 0) data.widgets_values[index] = maskWidget.value;
                return previousSerializeNode?.apply(this, arguments);
            };
            const previousQueued = maskWidget.beforeQueued;
            maskWidget.beforeQueued = function () { editor.flush(); return previousQueued?.apply(this, arguments); };
            const previousConfigure = node.onConfigure;
            node.onConfigure = function () {
                const configured = previousConfigure?.apply(this, arguments);
                cancelAnimationFrame(restoreFrame); restoreFrame = requestAnimationFrame(restore);
                return configured;
            };
            const previousImageCallback = imageWidget.callback;
            imageWidget.callback = function () { previousImageCallback?.apply(this, arguments); restore(); };
            const previousRemoved = node.onRemoved;
            node.onRemoved = function () { cancelAnimationFrame(restoreFrame); cancelAnimationFrame(fitFrame); stopWheelRouting(); editor.destroy(); return previousRemoved?.apply(this, arguments); };
            node.setSize([Math.max(380, node.size[0]), Math.max(480, node.size[1])]);
            restoreFrame = requestAnimationFrame(restore);
            return result;
        };
    },
});
