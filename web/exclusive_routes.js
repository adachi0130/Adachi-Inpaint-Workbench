const disabled = node => node.mode === 2 || node.mode === 4;
const inputLink = (graph, input) => input?.link == null ? null
    : graph.getLink?.(input.link) ?? graph.links?.[input.link];

/** Follow routing nodes without treating ordinary processing nodes as routers. */
export function branchIsEnabled(node, name) {
    const graph = node.graph;
    if (!graph) return false;
    const seen = new Set();
    function visit(source, slot = 0) {
        if (!source || seen.has(source) || disabled(source)) return false;
        seen.add(source);
        const sourceGraph = source.graph || graph;
        const follow = link => link ? visit(sourceGraph.getNodeById(link.origin_id), link.origin_slot) : false;

        // KJ Get nodes have no physical inputs. Follow their actual setter so
        // its ignored state is checked too; getInputLink alone skips the Set.
        if (source.isVirtualNode && typeof source.findSetter === "function") {
            return visit(source.findSetter(sourceGraph), slot);
        }
        if (source.type === "Reroute" || source.type === "SetNode") {
            return follow(inputLink(sourceGraph, source.inputs?.[slot] || source.inputs?.[0]));
        }
        if (source.isVirtualNode && typeof source.resolveVirtualOutput === "function") {
            const resolved = source.resolveVirtualOutput(slot);
            if (resolved?.node) return visit(resolved.node, resolved.slot ?? 0);
        }
        if (source.isVirtualNode && typeof source.getInputLink === "function") {
            return follow(source.getInputLink(slot));
        }
        return true;
    }
    const link = inputLink(graph, node.inputs?.find(input => input.name === name));
    return link ? visit(graph.getNodeById(link.origin_id), link.origin_slot) : false;
}
