// Read-only discovery for the inpainting workbench. The live graph remains
// authoritative: virtual Get/Set routes and group bypasses are resolved by
// ComfyUI and its installed extensions when a prompt is actually queued.
export function inspectWorkbench(graph) {
    const nodes = Array.from(graph?._nodes || []);
    const find = type => nodes.filter(node => node.type === type);
    const editors = find("AdachiInlineMask");
    const samplers = find("AdachiWebUIInpaint");
    const comparisons = find("AdachiImageCompare");
    const presets = find("AdachiGroupPresets");
    const checkpoints = find("CheckpointLoaderSimple");
    const loras = nodes.filter(node => node.type === "LoraLoader" || node.type === "Power Lora Loader (rgthree)");
    const missing = [];
    if (!editors.length) missing.push("inline_mask");
    if (!samplers.length) missing.push("inpaint");
    if (!comparisons.length) missing.push("compare");
    return { editors, samplers, comparisons, presets, checkpoints, loras, missing };
}
