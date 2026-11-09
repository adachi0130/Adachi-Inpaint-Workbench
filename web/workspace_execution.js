import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { workspaceRequest } from "./workspace_transport.js";

function apiNodeId(node) { return String(typeof node === "object" ? node.id : node); }
const graphTasks = new WeakMap();

export function prepareWorkspacePrompt(options) {
    const graph = options.editorNode?.graph;
    if (!graph) return Promise.reject(new Error("工作流已关闭"));
    const previous = graphTasks.get(graph) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => prepareSnapshot(options));
    graphTasks.set(graph, task);
    return task;
}

async function prepareSnapshot({editorNode, samplerNode, compareNode, binding = {}}) {
    if (!editorNode?.adachiEditor?.ready) throw new Error("请先上传原图");
    const graph = editorNode.graph;
    if (!graph || graph !== app.graph || samplerNode?.graph !== graph || compareNode?.graph !== graph) {
        throw new Error("工作流已切换，请重新打开工作台");
    }
    const enabled = new Set([editorNode, samplerNode, compareNode, ...(binding.enableNodes || [])]);
    const overrides = {...binding.inputOverrides};
    overrides[apiNodeId(samplerNode)] = {...overrides[apiNodeId(samplerNode)], ...binding.samplerInputs,
        image: [apiNodeId(editorNode), 0], mask: [apiNodeId(editorNode), 1]};
    overrides[apiNodeId(compareNode)] = {...overrides[apiNodeId(compareNode)],
        original: [apiNodeId(editorNode), 0], result: [apiNodeId(samplerNode), 0]};
    const linked = id => graph.links instanceof Map ? graph.links.get(id) : graph.links[id];
    const all = Array.from(graph._nodes || []), previous = all.map(node => [node, node.mode]);
    const rollback = [];
    // A dormant branch can contain missing virtual routes. Hide those branches
    // during native serialization, and compile the explicitly bound links in
    // a reversible graph transaction rather than relying on bypass resolution.
    const pending = [...enabled];
    while (pending.length) {
        const node = pending.pop();
        for (const input of node.inputs || []) {
            if ((binding.removeInputs?.[apiNodeId(node)] || []).includes(input.name)) continue;
            const override = overrides[apiNodeId(node)]?.[input.name];
            if (override !== undefined) continue;
            const link = input.link == null ? null : linked(input.link);
            const upstream = link && graph.getNodeById(link.origin_id);
            if (upstream && !enabled.has(upstream)) { enabled.add(upstream); pending.push(upstream); }
        }
    }
    editorNode.adachiEditor.flush();
    let prepared;
    try {
        for (const node of all) node.mode = enabled.has(node) ? 0 : 2;
        let nextLink = -1000000;
        const sampleLink = graph.links instanceof Map ? graph.links.values().next().value : Object.values(graph.links)[0];
        for (const node of enabled) {
            const changes = overrides[apiNodeId(node)] || {};
            const removals = binding.removeInputs?.[apiNodeId(node)] || [];
            for (const input of node.inputs || []) {
                if (!(input.name in changes) && !removals.includes(input.name)) continue;
                const old = input.link; rollback.push(() => { input.link = old; });
                const value = changes[input.name];
                if (removals.includes(input.name) || !Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") {
                    input.link = null; continue;
                }
                while (linked(nextLink)) nextLink--;
                const id = nextLink--;
                const origin = graph.getNodeById(value[0]);
                if (!origin?.outputs?.[value[1]]) throw new Error(`所选模型分支缺少输出 #${value[0]}:${value[1]}`);
                const originSlot = origin.outputs[value[1]], oldLinks = originSlot.links;
                originSlot.links = [...(oldLinks || []), id];
                const link = Object.assign(Object.create(sampleLink ? Object.getPrototypeOf(sampleLink) : Object.prototype),
                    {id, origin_id: origin.id, origin_slot: value[1], target_id: node.id, target_slot: node.inputs.indexOf(input), type: input.type});
                if (graph.links instanceof Map) graph.links.set(id, link); else graph.links[id] = link;
                input.link = id;
                rollback.push(() => { originSlot.links = oldLinks; if (graph.links instanceof Map) graph.links.delete(id); else delete graph.links[id]; });
            }
        }
        prepared = await app.graphToPrompt();
    } finally {
        for (const undo of rollback.reverse()) undo();
        for (const [node, mode] of previous) node.mode = mode;
    }
    if (app.graph !== graph) throw new Error("工作流已切换，请重新检查");
    // Save the user's real editable graph in PNG metadata, never the temporary
    // compile-only modes or synthetic links used to select an execution path.
    prepared.workflow = graph.serialize();
    const output = prepared.output;
    const samplerId = apiNodeId(samplerNode), compareId = apiNodeId(compareNode);
    if (!output?.[samplerId] || !output?.[compareId]) throw new Error("重绘或对比节点未出现在执行图中");
    Object.assign(output[samplerId].inputs, binding.samplerInputs || {});
    for (const [id, inputs] of Object.entries(binding.inputOverrides || {})) {
        if (!output[id]) throw new Error(`所选模型分支缺少节点 #${id}`);
        Object.assign(output[id].inputs, inputs);
    }
    for (const [id, names] of Object.entries(binding.removeInputs || {})) {
        for (const name of names) if (output[id]?.inputs) delete output[id].inputs[name];
    }
    // Force the requested inpaint editor and final result; old feedback wires or
    // alternative comparison input routes must not launch other image branches.
    output[samplerId].inputs.image = [apiNodeId(editorNode), 0];
    output[samplerId].inputs.mask = [apiNodeId(editorNode), 1];
    output[compareId].inputs.original = [apiNodeId(editorNode), 0];
    output[compareId].inputs.result = [samplerId, 0];
    return {
        prompt: output, compare_id: compareId, client_id: api.clientId || "",
        extra_data: {
            extra_pnginfo: {workflow: prepared.workflow},
            auth_token_comfy_org: api.authToken,
            api_key_comfy_org: api.apiKey,
        },
    };
}

export const validateWorkspace = prepared => workspaceRequest(api, "validate", prepared);
export const submitWorkspace = prepared => workspaceRequest(api, "submit", prepared);
