import { app } from "../../scripts/app.js";

function branchIsEnabled(node, name) {
    const graph = node.graph;
    let input = node.inputs?.find(input => input.name === name);
    const visited = new Set();
    while (graph && input?.link != null) {
        const link = graph.getLink?.(input.link) ?? graph.links?.[input.link];
        const source = link && graph.getNodeById(link.origin_id);
        if (!source || visited.has(source.id)) return false;
        visited.add(source.id);
        // A bypassed transform normally passes its own input through in ComfyUI.
        // For this exclusive selector the original branch is explicitly disabled.
        if (source.mode === 2 || source.mode === 4) return false;
        if (source.type !== "Reroute") return true;
        input = source.inputs?.[0];
    }
    return false;
}

app.registerExtension({
    name: "AdachiWorkbench.ExclusiveSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AdachiExclusiveSwitch") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const widget = this.widgets?.find(widget => widget.name === "active_inputs");
            if (widget) {
                widget.type = "hidden";
                widget.hidden = true;
                widget.options ??= {};
                widget.options.hidden = true;
                widget.computeSize = () => [0, -4];
                widget.serializeValue = () => Number(branchIsEnabled(this, "input_a"))
                    | (Number(branchIsEnabled(this, "input_b")) << 1);
            }
            const internalSlot = this.inputs?.findIndex(input => input.name === "active_inputs");
            if (internalSlot >= 0) this.removeInput(internalSlot);
            this.setSize([230, 80]);
            return result;
        };
    },
});
