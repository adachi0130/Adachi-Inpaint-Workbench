import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { InlineMaskEditor } from "./editor.js?v=2.1.0";
import { installInpaintWorkbench } from "./inpaint_node.js?v=toolbar-layout-20261112";
import { bindWidgetToNodeWidth, createWidgetHost } from "./widget_layout.js?v=stable-host-20261112";
import { routeWheelOutsideImage } from "./wheel_routing.js";
import { InlineCropController } from "./inline_crop.js?v=2.1.0";
import { canStoreDraft, prepareInlineDraft, syncInlineWidgets } from "./draft_guard.js?v=2.1.0";
import { T } from "./i18n.js";
import { removeLegacyFeedback } from "./legacy_feedback.js?v=0.6.4";
import { uploadImageWithProgress } from "./upload_transport.js?v=stability1";
import { ColorPaint } from "./color_paint.js?v=toolbar-layout-20261112";
import { createPaintDraftProtection } from "./paint_draft.js";

const styleId = "adachi-inpaint-style";
const stylesheet = document.getElementById(styleId) || document.createElement("link");
stylesheet.id = styleId; stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./editor.css?v=toolbar-layout-20261112", import.meta.url).href;
if (!stylesheet.isConnected) document.head.append(stylesheet);

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

function draftOptions() {
    let workspace = "personal";
    try { const current = JSON.parse(sessionStorage.getItem("Comfy.Workspace.Current") || "null"); if (current?.type !== "personal" && current?.id) workspace = current.id; } catch { /* Personal workspace. */ }
    return { workspace, path: app.extensionManager?.workflow?.activeWorkflow?.path || "" };
}

async function uploadEmbeddedSource(embedded) {
    const blob = await (await fetch(embedded)).blob();
    if (blob.size > 64 * 1024 * 1024) throw Error(T("File is too large (max 64 MB)"));
    const body = new FormData();
    body.append("image", blob, `source-${crypto.randomUUID()}.png`);
    body.append("type", "input"); body.append("subfolder", "adachi-inpaint");
    const response = await api.fetchApi("/upload/image", {method:"POST", body});
    if (!response.ok) throw Error(`${T("Upload failed")} (${response.status})`);
    const uploaded = await response.json();
    if (typeof uploaded.name !== "string" || !uploaded.name) throw Error(T("Upload failed"));
    return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
}

app.registerExtension({
    name: "Adachi.InlineInpaint",
    async beforeConfigureGraph(graphData) {
        removeLegacyFeedback(graphData);
        if (app.ui.settings.getSettingValue("Comfy.Workflow.Persist") === false) return;
        try {
            // The active workflow can still be the previous tab at this point;
            // do not claim its replacement credit for an incoming workflow.
            const options = { ...draftOptions(), path: "" };
            const count = await prepareInlineDraft(graphData, {
                fits: graph => canStoreDraft(graph, options), upload: uploadEmbeddedSource,
            });
            if (count) console.info(`[Adachi Inpaint] Saved ${count} oversized embedded source or paint layer(s) as input files before workflow draft initialization.`);
        } catch (error) {
            console.warn("[Adachi Inpaint] Draft preflight failed; embedded source data was retained.", error);
        }
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "AdachiLayerCommit") { nodeType.skip_list = true; return; }
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
            const imageWidget = find("image"), maskWidget = find("mask_data"), sourceWidget = find("source_data"), paintWidget=find("paint_data");
            for (const widget of [imageWidget, maskWidget, sourceWidget, paintWidget]) hide(widget);
            let crop;
            let draftRecovery = null;
            let draftNoticeTimer = 0;
            let restoring = false;
            let restoreFrame = 0;
            let uploadVersion = 0;
            let fitFrame = 0;
            const fitNodeToImage = () => {
                cancelAnimationFrame(fitFrame);
                fitFrame = requestAnimationFrame(() => {
                    if (!editor.ready || editor.destroyed || !node.graph || editor.root.closest(".adachi-workspace")) return;
                    const width = editor.canvas.clientWidth, height = editor.canvas.clientHeight;
                    if (!width || !height) return;
                    const overhead = node.size[1] - height;
                    const fittedHeight = overhead + width * editor.image.height / editor.image.width;
                    node.setSize([node.size[0], Math.max(240, Math.min(4200, Math.ceil(fittedHeight)))]);
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
                try { crop?.activate("mask"); await editor.setImage(embedded || imageUrl(filename), maskWidget?.value || "", embedded ? T("Embedded image") : filename); await crop?.restore(); await node.adachiColorPaint?.restore(paintWidget?.value || ""); }
                catch (error) { console.warn("[Adachi Inpaint]", error); editor.status(error.message, true); }
                finally { restoring = false; }
            };
            const editor = new InlineMaskEditor({
                compact: true,
                onChange(data) { if (maskWidget && !restoring) maskWidget.value = data; },
                onDirty() { markChanged(); },
                onKeepFit(enabled) { node.properties.adachi_keep_fit = enabled; markChanged(); },
                onImage() { if (!restoring || !node.properties.adachi_compact_ui) fitNodeToImage(); },
                onGraphWheel: event => app.canvas?.processMouseWheel(event),
                async onUpload(file, { preserveMask = false, preserveCrop = false, onProgress = null, signal } = {}) {
                    if (preserveMask && editor.image && !editor.ready) throw new Error(T("Wait for the current image to finish loading"));
                    const version = ++uploadVersion;
                    const body = new FormData();
                    body.append("image", file, file.name);
                    body.append("type", "input");
                    body.append("subfolder", "adachi-inpaint");
                    const uploaded = await uploadImageWithProgress(api, body, onProgress, {signal});
                    if (typeof uploaded?.name !== "string" || !uploaded.name) throw new Error(T("Upload failed"));
                    if (version !== uploadVersion || editor.destroyed) return;
                    signal?.throwIfAborted();
                    const name = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
                    restoring = false;
                    crop?.activate("mask");
                    let kept = false;
                    if (preserveMask && editor.ready) {
                        kept = await editor.replaceSource(imageUrl(name), file.name, {retry:true,signal});
                        if (version !== uploadVersion || editor.destroyed) return;
                        // A different-sized replacement cannot reuse the old mask.
                        // Actually load it as a fresh image before clearing state.
                        if (!kept) await editor.setImage(imageUrl(name), "", file.name, {retry:true,signal});
                    } else await editor.setImage(imageUrl(name), "", file.name, {retry:true,signal});
                    if (version !== uploadVersion || editor.destroyed) return;
                    if (!preserveCrop) node.adachiColorPaint?.clear();
                    imageWidget.value = name;
                    maskWidget.value = kept ? editor.flush() : "";
                    sourceWidget.value = editor.embed.checked ? editor.sourceData() : "";
                    if (!preserveCrop) crop?.reset();
                    await beforeModeChange();
                    if (preserveMask && !kept) editor.notice(T("The new image has a different size, so the mask was reset"));
                    markChanged();
                },
                onEmbed(enabled) {
                    if (sourceWidget) sourceWidget.value = enabled ? editor.sourceData() : "";
                    const recovery = enabled ? beforeModeChange() : null;
                    if (recovery?.then) return recovery.then(() => markChanged()).catch(error => editor.status(error.message, true));
                    markChanged();
                },
            });
            editor.root.dataset.adachiVersion = "0.6.7";
            const beforeModeChange = () => {
                if (draftRecovery) return draftRecovery;
                const embedded = sourceWidget?.value;
                if (!editor.ready || !embedded?.startsWith("data:") || embedded.length < 256 * 1024) return;
                if (app.ui.settings.getSettingValue("Comfy.Workflow.Persist") === false) return;
                const graph = app.rootGraph || node.graph;
                if (canStoreDraft(graph.serialize(), draftOptions()) !== false) return;
                // Persist a fresh, exact copy before dropping any embedded bytes.
                // This also repairs portable workflows whose original input path is absent.
                draftRecovery = (async () => {
                    const version = editor.loadVersion;
                    const name = await uploadEmbeddedSource(embedded);
                    if (editor.destroyed || editor.loadVersion !== version || sourceWidget.value !== embedded) return false;
                    imageWidget.value = name;
                    sourceWidget.value = ""; editor.embed.checked = false;
                    editor.message.textContent = T("Browser draft storage was full. The source was saved as an input file; the image, masks and layers are preserved.");
                    editor.message.classList.remove("dd-error"); editor.message.hidden = false;
                    const notice = editor.message.textContent;
                    clearTimeout(draftNoticeTimer);
                    draftNoticeTimer = setTimeout(() => { if (!editor.destroyed && editor.message.textContent === notice) editor.message.hidden = true; }, 8000);
                    return true;
                })().finally(() => { draftRecovery = null; });
                return draftRecovery;
            };
            crop = new InlineCropController(node, editor, {find, hide, changed:markChanged, imageUrl, beforeModeChange});
            node.adachiCrop = crop;
            node.adachiEditor = editor;
            const paintDraft=createPaintDraftProtection({paint:()=>node.adachiColorPaint,widget:()=>paintWidget,graph:()=>app.rootGraph||node.graph,disposed:()=>editor.destroyed||!node.graph,persist:()=>app.ui.settings.getSettingValue('Comfy.Workflow.Persist')!==false,fits:graph=>canStoreDraft(graph.serialize(),draftOptions()),upload:uploadEmbeddedSource,changed:markChanged,onError:error=>editor.status(`${T("Paint layer could not be saved as an input file; embedded data was retained")}: ${error.message}`,true)});
            node.adachiColorPaint = new ColorPaint(editor,crop,paintWidget,paintDraft.schedule,imageUrl);
            editor.colorPaint=node.adachiColorPaint;
            const acceptCrop=crop.accept.bind(crop);
            crop.accept=async(...args)=>{const old=crop.widgets.layer_image.value,region={...crop.region};const result=await acceptCrop(...args);if(crop.widgets.layer_image.value && crop.widgets.layer_image.value!==old)node.adachiColorPaint.clearRegion(region);return result;};
            const stopWheelRouting = routeWheelOutsideImage(editor.root, editor.canvas, () => editor.ready);
            node.adachiUseResult = async (file, origin, options={}) => {
                if (editor.destroyed) throw new Error(T("The inline mask node was removed"));
                if (crop.mode === "crop") return node.adachiAdoptCrop(file, origin, options);
                await editor.options.onUpload(file, { preserveMask: true, signal:options.signal, onProgress:options.onProgress });
                editor.view = "overlay"; editor.updateButtons(); editor.schedule();
                editor.status(T("Adopted the result as the new source image; the mask and undo history were preserved"));
            };
            const widgetHost = createWidgetHost(editor.root);
            const domWidget = node.addDOMWidget("adachi_canvas", "adachi_inline_mask", widgetHost, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 170,
                getMaxHeight: () => 4096,
            });
            domWidget.serialize = false;
            bindWidgetToNodeWidth(node, domWidget, widgetHost);
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
                if(node.adachiColorPaint.drawing) node.adachiColorPaint.flush();
                return previousSerialize ? previousSerialize.apply(this, arguments) : maskWidget.value;
            };
            const previousSerializeNode = node.onSerialize;
            node.onSerialize = function (data) {
                const result = previousSerializeNode?.apply(this, arguments);
                editor.flush();
                if(node.adachiColorPaint.drawing) node.adachiColorPaint.flush();
                if (data) syncInlineWidgets(data, node.widgets);
                return result;
            };
            const previousQueued = maskWidget.beforeQueued;
            maskWidget.beforeQueued = function () { editor.flush(); if(node.adachiColorPaint.drawing) node.adachiColorPaint.flush(); return previousQueued?.apply(this, arguments); };
            if(paintWidget){const previousPaintSerialize=paintWidget.serializeValue;paintWidget.serializeValue=function(){if(node.adachiColorPaint.drawing)node.adachiColorPaint.flush();return previousPaintSerialize?previousPaintSerialize.apply(this,arguments):paintWidget.value;};}
            const previousConfigure = node.onConfigure;
            node.onConfigure = function () {
                const configured = previousConfigure?.apply(this, arguments);
                editor.setKeepFit(!!node.properties.adachi_keep_fit, false);
                cancelAnimationFrame(restoreFrame); restoreFrame = requestAnimationFrame(restore);
                return configured;
            };
            const previousImageCallback = imageWidget.callback;
            imageWidget.callback = function () { previousImageCallback?.apply(this, arguments); restore(); };
            const previousRemoved = node.onRemoved;
            node.onRemoved = function () { node.adachiWorkspaceHistory?.clear();node.adachiWorkspaceHistory=null;clearTimeout(draftNoticeTimer);paintDraft.dispose(); cancelAnimationFrame(restoreFrame); cancelAnimationFrame(fitFrame); stopWheelRouting(); node.adachiColorPaint.destroy();crop.destroy(); editor.destroy(); return previousRemoved?.apply(this, arguments); };
            node.setSize([Math.max(380, node.size[0]), Math.max(480, node.size[1])]);
            restoreFrame = requestAnimationFrame(restore);
            return result;
        };
    },
});
