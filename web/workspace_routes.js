const linkAt = (graph, input) => input?.link == null ? null
    : graph.getLink?.(input.link) ?? graph.links?.get?.(input.link) ?? graph.links?.[input.link];
// Follow the actual sampler conditioning inputs, including KJ Get/Set routes.
// Ambiguous processing graphs are left under the workflow's control.
export function conditioningSource(graph, sampler, inputName, modes = new Map()) {
    const mode = node => modes.get(node) ?? node.mode ?? 0;
    const visit = (node, slot, seen = new Set()) => {
        if (!node || seen.has(node) || mode(node) === 2) return null;
        seen = new Set(seen); seen.add(node);
        const follow = input => {
            const link = linkAt(node.graph || graph, input);
            return link ? visit((node.graph || graph).getNodeById(link.origin_id), link.origin_slot, seen) : null;
        };
        if (node.type === 'AdachiExclusiveSwitch') {
            const sources = (node.inputs || []).filter(i=>['input_a','input_b'].includes(i.name)).map(follow).filter(Boolean);
            return sources.length === 1 ? sources[0] : null;
        }
        if (node.type === 'GetNode') {
            if (mode(node) !== 0) return null;
            const name = node.widgets?.[0]?.value;
            const setter = node.findSetter?.(node.graph || graph) || Array.from(graph._nodes || []).find(n=>n.type === 'SetNode' && n.widgets?.[0]?.value === name);
            return setter ? visit(setter,slot,seen) : null;
        }
        if (node.type === 'SetNode' || node.type === 'Reroute') {
            if (mode(node) !== 0) return null;
            return follow(node.inputs?.[0]);
        }
        if (node.type === 'CLIPTextEncode') return mode(node) === 0 ? node : null;
        const resolved = node.resolveVirtualOutput?.(slot);
        if (resolved?.node) return visit(resolved.node,resolved.slot ?? 0,seen);
        return null;
    };
    const link = linkAt(graph, sampler.inputs?.find(i=>i.name===inputName));
    return link ? visit(graph.getNodeById(link.origin_id),link.origin_slot) : null;
}
