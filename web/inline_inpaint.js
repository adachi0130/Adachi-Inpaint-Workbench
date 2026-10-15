import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { InlineMaskEditor } from "./editor.js";
import { InpaintParameterPanel } from "./inpaint_panel.js";
import { connectedSamplers, relocateWidgets } from "./parameter_bridge.js";
import { routeWheelOutsideImage } from "./wheel_routing.js";

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
            let panelBaseHeight = null;
            const restore = async () => {
                const embedded = sourceWidget?.value;
                const filename = imageWidget?.value;
                if (!embedded && !filename) return;
                restoring = true;
                editor.embed.checked = !!embedded;
                try { await editor.setImage(embedded || imageUrl(filename), maskWidget?.value || "", embedded ? "内嵌原图 / Embedded image" : filename); }
                catch (error) { console.warn("[Adachi Inpaint]", error); }
                finally { restoring = false; }
            };
            const editor = new InlineMaskEditor({
                onChange(data) { if (maskWidget && !restoring) maskWidget.value = data; },
                onDirty() { markChanged(); },
                onImage() { node.adachiParameters?.refresh(); },
                onGraphWheel: event => app.canvas?.processMouseWheel(event),
                async onUpload(file) {
                    const version = ++uploadVersion;
                    const body = new FormData();
                    body.append("image", file, file.name);
                    body.append("type", "input");
                    body.append("subfolder", "adachi-inpaint");
                    const response = await api.fetchApi("/upload/image", { method: "POST", body });
                    if (!response.ok) throw new Error(`上传失败 / Upload failed (${response.status})`);
                    const uploaded = await response.json();
                    if (version !== uploadVersion || editor.destroyed) return;
                    const name = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
                    imageWidget.value = name;
                    maskWidget.value = "";
                    sourceWidget.value = "";
                    restoring = false;
                    await editor.setImage(imageUrl(name), "", file.name);
                    if (editor.embed.checked) sourceWidget.value = editor.sourceData();
                    markChanged();
                },
                onEmbed(enabled) {
                    if (sourceWidget) sourceWidget.value = enabled ? editor.sourceData() : "";
                    markChanged();
                },
            });
            node.adachiEditor = editor;
            const stopWheelRouting = routeWheelOutsideImage(editor.root, editor.canvas, () => editor.ready);
            const panel = new InpaintParameterPanel({
                getTargets: () => connectedSamplers(node),
                getPreferred: () => node.properties.adachi_settings_target,
                onPreferred: id => { node.properties.adachi_settings_target = id; markChanged(); },
                getImage: () => editor.ready ? editor.image : null,
                onTargetChange: (previous, next) => {
                    if (next && !node.properties.adachi_inline_parameters) panelBaseHeight = node.size[1];
                    relocateWidgets(node, previous, next);
                },
                onDirty: markChanged,
                onHeight: () => {
                    const parameters = node.adachiParameters;
                    const panelHeight = parameters?.root.scrollHeight || 40;
                    if (node.graph) {
                        // Add the panel once when migrating an older workflow.
                        // Reopening an already-migrated workflow must keep its saved size.
                        const migrate = parameters?.target && panelHeight > 100 && !node.properties.adachi_inline_parameters;
                        const migratedHeight = migrate ? (panelBaseHeight ?? node.size[1]) + Math.max(0, panelHeight - 40) : node.size[1];
                        if (migrate) node.properties.adachi_inline_parameters = true;
                        const height = Math.max(620 + panelHeight, migratedHeight);
                        if (Math.abs(node.size[1] - height) > 1) node.setSize([node.size[0], height]);
                    }
                    editor.schedule();
                },
            });
            node.adachiParameters = panel;
            editor.root.append(panel.root);
            node.adachiUseResult = async file => {
                if (editor.destroyed) throw new Error("内联蒙版节点已移除");
                await editor.options.onUpload(file);
                editor.view = "overlay"; editor.updateButtons(); editor.schedule();
                editor.status("已采用重绘结果作为新原图，旧蒙版已清空");
            };
            const domWidget = node.addDOMWidget("adachi_canvas", "adachi_inline_mask", editor.root, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 520 + (panel.root.scrollHeight || 40),
                getMaxHeight: () => 4096,
            });
            domWidget.serialize = false;
            // Leave computeLayoutSize in charge: a fixed computeSize height
            // prevents the DOM canvas from growing with the node vertically.
            const resizeHandle = document.createElement("div");
            resizeHandle.className = "dd-resize-handle";
            resizeHandle.textContent = "↕";
            resizeHandle.title = "上下拖动调整画布高度 / Drag to resize canvas height";
            resizeHandle.tabIndex = 0;
            resizeHandle.setAttribute("role", "separator");
            resizeHandle.setAttribute("aria-orientation", "horizontal");
            resizeHandle.setAttribute("aria-label", "调整画布高度 / Resize canvas height");
            editor.root.append(resizeHandle);
            let resizing = null;
            const resizeHeight = height => {
                node.setSize([node.size[0], Math.max(620, Math.min(4200, height))]);
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
                cancelAnimationFrame(restoreFrame); restoreFrame = requestAnimationFrame(() => { restore(); panel.refresh(); });
                return configured;
            };
            const previousConnections = node.onConnectionsChange;
            node.onConnectionsChange = function () {
                const result = previousConnections?.apply(this, arguments);
                queueMicrotask(() => { if (!editor.destroyed) panel.refresh(); });
                return result;
            };
            const previousImageCallback = imageWidget.callback;
            imageWidget.callback = function () { previousImageCallback?.apply(this, arguments); restore(); };
            const previousRemoved = node.onRemoved;
            node.onRemoved = function () { cancelAnimationFrame(restoreFrame); panel.destroy(); stopWheelRouting(); editor.destroy(); return previousRemoved?.apply(this, arguments); };
            node.setSize([Math.max(510, node.size[0]), Math.max(650, node.size[1])]);
            restoreFrame = requestAnimationFrame(restore);
            return result;
        };
    },
});
