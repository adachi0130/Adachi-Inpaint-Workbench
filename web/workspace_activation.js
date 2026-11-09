const virtualTypes=new Set(['GetNode','SetNode','Reroute','AdachiExclusiveSwitch']);
function members(group,seen=new Set()) {
    if(seen.has(group))return [];seen.add(group);group.recomputeInsideNodes?.();
    return [...new Set(Array.from(group._children||group._nodes||group.nodes||[]).flatMap(child=>
        typeof child.recomputeInsideNodes==='function'?members(child,seen):[child]))];
}
export function workspaceRoutingNodes(roots,controller) {
    const allowed=new Set();
    const plan=controller?.active&&controller.planStates?controller.planStates(controller.active).plan:null;
    for(const root of roots)if(root.mode===4){
        const groups=Array.from(root.graph?.groups||root.graph?._groups||[]).map(group=>{
            const nodes=members(group);return {nodes,area:Math.abs((group.size?.[0]||1)*(group.size?.[1]||1))};
        }).filter(group=>group.nodes.includes(root)).sort((a,b)=>a.area-b.area);
        const group=groups[0];if(!group)continue;
        const inherited=plan?.has(root)?plan.get(root)===4:group.nodes.filter(n=>!['AdachiGroupPresets','Note','MarkdownNote'].includes(n.type)).every(n=>n.mode===4);
        if(inherited)for(const node of group.nodes)allowed.add(node);
    }
    const found=new Set(),seen=new Set();
    const visit=node=>{
        if(!node||seen.has(node))return;seen.add(node);
        if(!roots.includes(node)&&!virtualTypes.has(node.type))return;
        if(virtualTypes.has(node.type)&&node.mode===4&&allowed.has(node))found.add(node);
        if(node.type==='GetNode'){const setter=node.findSetter?.(node.graph);if(setter)visit(setter);}
        for(const input of node.inputs||[]){const g=node.graph,l=g?.getLink?.(input.link)??g?.links?.get?.(input.link)??g?.links?.[input.link];if(l)visit(g.getNodeById(l.origin_id));}
    };
    roots.forEach(visit);return found;
}
