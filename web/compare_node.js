import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ImageCompareView } from "./compare.js";
import { routeWheelOutsideImage } from "./wheel_routing.js";

function viewUrl(image) {
    const type = ["input", "output", "temp"].includes(image?.type) ? image.type : "temp";
    return api.apiURL(`/view?${new URLSearchParams({ filename: image?.filename || "", subfolder: image?.subfolder || "", type })}`);
}

function targets(node) {
    const graph = node.graph;
    const editors = (graph?._nodes || []).filter(candidate => candidate.type === "AdachiInlineMask" && candidate.adachiUseResult)
        .map(candidate => ({ id: candidate.id, label: `${candidate.title || "内联蒙版"} #${candidate.id}` }));
    const sourceLink = graph?.links?.[node.inputs?.find(input => input.name === "original")?.link];
    const queue = sourceLink ? [sourceLink.origin_id] : [], seen = new Set(), upstream = new Set();
    while (queue.length && seen.size < 256) {
        const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
        const current = graph.getNodeById(id); if (!current) continue;
        if (current.type === "AdachiInlineMask") { upstream.add(String(id)); continue; }
        for (const input of current.inputs || []) {
            if (!["IMAGE", "*"].includes(input.type)) continue;
            const link = graph.links?.[input.link]; if (link) queue.push(link.origin_id);
        }
    }
    return { editors, preferred: upstream.size === 1 ? [...upstream][0] : "" };
}

app.registerExtension({
    name: "Adachi.ImageCompare",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AdachiImageCompare") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const value = created?.apply(this, arguments), node = this;
            const compare = new ImageCompareView({
                resolveUrl: viewUrl,
                onGraphWheel: event => app.canvas?.processMouseWheel(event),
                getTargets: () => targets(node),
                onSelect: index => { node.properties.adachi_result_index = index; },
                async onAdopt(id, image) {
                    const target = node.graph?.getNodeById(id);
                    if (!target?.adachiUseResult) throw new Error("找不到接收结果的内联蒙版节点");
                    const response = await api.fetchApi(`/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "temp" })}`);
                    if (!response.ok) throw new Error("结果预览已过期，请重新运行工作流");
                    const blob = await response.blob();
                    if (blob.size > 64 * 1024 * 1024) throw new Error("结果图片超过 64 MiB，请先缩小");
                    await target.adachiUseResult(new File([blob], `adachi-result-${Date.now()}.png`, { type: "image/png" }));
                },
            });
            node.adachiCompare = compare;
            const stopWheelRouting = routeWheelOutsideImage(compare.root, compare.canvas, () => compare.ready);
            const widget = node.addDOMWidget("adachi_compare", "adachi_compare_view", compare.root, {
                serialize: false, hideOnZoom: false, getMinHeight: () => 420, getMaxHeight: () => 4096,
            });
            widget.serialize = false;
            const executed = node.onExecuted;
            node.onExecuted = function (output) {
                const result = executed?.apply(this, arguments);
                const data = { originals: output?.adachi_originals || [], results: output?.adachi_results || [] };
                node.properties.adachi_compare = data;
                compare.setData(data, node.properties.adachi_result_index || 0);
                return result;
            };
            const configured = node.onConfigure;
            node.onConfigure = function () {
                const result = configured?.apply(this, arguments);
                if (node.properties.adachi_compare) compare.setData(node.properties.adachi_compare, node.properties.adachi_result_index || 0);
                return result;
            };
            const removed = node.onRemoved;
            node.onRemoved = function () { stopWheelRouting(); compare.destroy(); return removed?.apply(this, arguments); };
            node.setSize([Math.max(550, node.size[0]), Math.max(550, node.size[1])]);
            return value;
        };
    },
});
