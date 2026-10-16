import { app } from "../../scripts/app.js";
import { InpaintParameterPanel } from "./inpaint_panel.js";
import { connectedEditor, connectedSamplers, relocateWidgets } from "./parameter_bridge.js";
import { routeWheelOutsideImage } from "./wheel_routing.js";
import { T } from "./i18n.js";
import { bindWidgetToNodeWidth } from "./widget_layout.js?v=0.5.5";

export function installInpaintWorkbench(nodeType) {
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments), node = this;
        const root = document.createElement("div"); root.className = "dd-inpaint dd-workbench";
        const tools = document.createElement("div"); tools.className = "dd-workbench-tools";
        const placeholder = document.createElement("div"); placeholder.className = "dd-param-placeholder dd-tools-placeholder";
        placeholder.textContent = T("Connect an inline mask to show the painting tools");
        tools.append(placeholder); root.append(tools);
        let source = null, mountedEditor = null, frame = 0, removed = false;
        const markChanged = () => {
            app.canvas?.emitBeforeChange?.(); app.canvas?.emitAfterChange?.();
            node.graph?.setDirtyCanvas(true, true);
        };
        const refreshEditor = () => {
            source = connectedEditor(node);
            const editor = source?.adachiEditor;
            // A live control tree has one host. Additional samplers still get
            // their own parameters and use the same source image dimensions.
            const canMount = editor?.controls && connectedSamplers(source)[0] === node;
            const next = canMount ? editor : null;
            if (next !== mountedEditor) {
                if (mountedEditor?.controls.parentElement === tools) mountedEditor.controls.remove();
                mountedEditor = next;
                if (next) tools.append(next.controls);
                scheduleSize();
            }
            placeholder.hidden = !!next;
            placeholder.textContent = editor ? T("The painting tools live in the other inpaint node connected to this image") : T("Connect an inline mask to show the painting tools");
        };
        const contentHeight = () => (tools.scrollHeight || 30) + (panel?.root.scrollHeight || 620);
        const scheduleSize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (removed || !node.graph || !root.isConnected) return;
                const required = node.computeSize()[1];
                if (Math.abs(node.size[1] - required) > 1) node.setSize([node.size[0], required]);
                node.graph.setDirtyCanvas(true, true);
            });
        };
        let panel;
        panel = new InpaintParameterPanel({
            getTargets: () => { refreshEditor(); return [node]; },
            getImage: () => source?.adachiEditor?.ready ? (source.adachiCrop?.mode === "crop" && source.adachiCrop.region.locked ? source.adachiCrop.region : source.adachiEditor.image) : null,
            onTargetChange: (previous, next) => relocateWidgets(node, previous, next),
            onDirty: markChanged, onHeight: scheduleSize,
        });
        root.append(panel.root);
        node.adachiParameters = panel; node.adachiWorkbench = { root, tools, get source() { return source; } };
        const stopWheelRouting = routeWheelOutsideImage(root, null, () => false);
        const widget = node.addDOMWidget("adachi_workbench", "adachi_inpaint_controls", root, {
            serialize: false, hideOnZoom: false, getMinHeight: contentHeight, getMaxHeight: () => Math.max(4096, contentHeight()),
        });
        widget.serialize = false;
        bindWidgetToNodeWidth(node, widget, root);
        const observer = new ResizeObserver(scheduleSize); observer.observe(tools);
        const configured = node.onConfigure;
        node.onConfigure = function () { const result = configured?.apply(this, arguments); queueMicrotask(() => { if (!removed) { panel.refresh(); scheduleSize(); } }); return result; };
        const connections = node.onConnectionsChange;
        node.onConnectionsChange = function () { const result = connections?.apply(this, arguments); queueMicrotask(() => { if (!removed) panel.refresh(); }); return result; };
        const previousRemoved = node.onRemoved;
        node.onRemoved = function () {
            removed = true; cancelAnimationFrame(frame); observer.disconnect();
            if (mountedEditor?.controls.parentElement === tools) mountedEditor.controls.remove();
            panel.destroy(); stopWheelRouting(); root.remove();
            return previousRemoved?.apply(this, arguments);
        };
        node.setSize([Math.max(510, node.size[0]), node.size[1]]); scheduleSize();
        return result;
    };
}
