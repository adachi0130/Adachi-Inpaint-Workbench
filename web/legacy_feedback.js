// Remove obsolete feedback edges before LiteGraph assigns saved socket indices.
export function removeLegacyFeedback(graph, seen = new Set()) {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    const nodes = new Map((graph.nodes || []).map(node => [String(node.id), node]));
    const removed = new Set(), indices = new Map();
    for (const node of nodes.values()) {
        if (node.type !== "AdachiInlineMask") continue;
        const slots = (node.inputs || []).flatMap((input, index) => input.name === "result" ? [index] : []);
        indices.set(String(node.id), slots);
        for (const slot of slots) if (node.inputs[slot].link != null) removed.add(String(node.inputs[slot].link));
    }
    const entries = Array.isArray(graph.links) ? graph.links.map((link, index) => [index, link]) : Object.entries(graph.links || {});
    for (const [, link] of entries) {
        const id = Array.isArray(link) ? link[0] : link.id;
        const target = String(Array.isArray(link) ? link[3] : link.target_id);
        const slot = Array.isArray(link) ? link[4] : link.target_slot;
        if (!indices.has(target)) continue;
        const input = nodes.get(target).inputs?.[slot], slots = indices.get(target);
        // Also repair orphaned feedback edges from a previously migrated save.
        if (slots.includes(slot) || String(input?.link) !== String(id)) removed.add(String(id));
        else if (Array.isArray(link)) link[4] -= slots.filter(index => index < slot).length;
        else link.target_slot -= slots.filter(index => index < slot).length;
    }
    if (Array.isArray(graph.links)) graph.links = graph.links.filter(link => !removed.has(String(Array.isArray(link) ? link[0] : link.id)));
    else for (const [key, link] of entries) if (removed.has(String(Array.isArray(link) ? link[0] : link.id))) delete graph.links[key];
    for (const node of nodes.values()) {
        if (node.type === "AdachiInlineMask") node.inputs = (node.inputs || []).filter(input => input.name !== "result");
        for (const output of node.outputs || []) if (Array.isArray(output.links)) output.links = output.links.filter(id => !removed.has(String(id)));
    }
    for (const subgraph of graph.definitions?.subgraphs || []) removeLegacyFeedback(subgraph, seen);
}
