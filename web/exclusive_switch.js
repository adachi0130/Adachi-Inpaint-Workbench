import { app } from "../../scripts/app.js";
import { branchIsEnabled } from "./exclusive_routes.js?v=0.5.6";

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
                widget.serializeValue = executionNode => {
                    const flags = Number(branchIsEnabled(this, "input_a"))
                        | (Number(branchIsEnabled(this, "input_b")) << 1);
                    // Recent frontends resolve ignored virtual Get nodes before
                    // backend lazy execution, sometimes trying a nonexistent input.
                    // Drop only inactive links in the detached execution DTO;
                    // the editable graph and saved workflow keep all their wires.
                    if (executionNode !== this && executionNode?.node === this) {
                        for (const input of executionNode.inputs || []) {
                            const bit = input.name === "input_a" ? 1 : input.name === "input_b" ? 2 : 0;
                            if (bit && !(flags & bit) && "linkId" in input
                                && !this.inputs.includes(input)) input.linkId = null;
                        }
                    }
                    return flags;
                };
            }
            const internalSlot = this.inputs?.findIndex(input => input.name === "active_inputs");
            if (internalSlot >= 0) this.removeInput(internalSlot);
            this.setSize([230, 80]);
            return result;
        };
    },
});
