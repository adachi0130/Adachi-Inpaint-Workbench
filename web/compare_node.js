import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ImageCompareView } from "./compare.js?v=0.7.2";
import { appendComparison } from "./compare_history.js?v=0.5.8";
import { routeWheelOutsideImage } from "./wheel_routing.js";
import { T } from "./i18n.js";
import { bindWidgetToNodeWidth } from "./widget_layout.js?v=0.5.5";

function viewUrl(image) {
    const type = ["input", "output", "temp"].includes(image?.type) ? image.type : "temp";
    return api.apiURL(`/view?${new URLSearchParams({ filename: image?.filename || "", subfolder: image?.subfolder || "", type })}`);
}

function targets(node) {
    const graph = node.graph;
    const editors = (graph?._nodes || []).filter(candidate => candidate.type === "AdachiInlineMask" && candidate.adachiUseResult)
        .map(candidate => ({ id: candidate.id, label: `${candidate.title || T("Inline Mask")} #${candidate.id}` }));
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
                    if (!target?.adachiUseResult) throw new Error(T("No inline mask node is available to receive the result"));
                    const response = await api.fetchApi(`/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "temp" })}`);
                    if (!response.ok) throw new Error(T("Result preview expired; run the workflow again"));
                    const blob = await response.blob();
                    if (blob.size > 64 * 1024 * 1024) throw new Error(T("Result image exceeds 64 MiB; downscale it first"));
                    await target.adachiUseResult(new File([blob], `adachi-result-${Date.now()}.png`, { type: "image/png" }), image.adachi_origin);
                    // Adoption starts a new round. Keep the accepted image visible
                    // as 1/1, then replace it with the next round's first outputs.
                    const data = { originals: [image], results: [image] };
                    node.properties.adachi_compare = data;
                    node.properties.adachi_result_index = 0;
                    node.properties.adachi_compare_new_round = true;
                    await compare.setData(data, 0);
                    app.graph?.change?.();
                },
            });
            node.adachiCompare = compare;
            const stopWheelRouting = routeWheelOutsideImage(compare.root, null, () => false);
            const widget = node.addDOMWidget("adachi_compare", "adachi_compare_view", compare.root, {
                serialize: false, hideOnZoom: false, getMinHeight: () => 420, getMaxHeight: () => 4096,
            });
            widget.serialize = false;
            bindWidgetToNodeWidth(node, widget, compare.root);
            const executed = node.onExecuted;
            node.onExecuted = function (output) {
                const result = executed?.apply(this, arguments);
                if (!output?.adachi_originals?.length || !output?.adachi_results?.length) return result;
                const previous = node.properties.adachi_compare_new_round
                    ? appendComparison() : appendComparison(node.properties.adachi_compare);
                const data = appendComparison(previous, {
                    originals: output.adachi_originals,
                    results: output.adachi_results.map(image => output.adachi_origin?.[0]
                        ? {...image, adachi_origin:output.adachi_origin[0]} : image),
                });
                node.properties.adachi_compare = data;
                node.properties.adachi_compare_new_round = false;
                node.properties.adachi_result_index = data.results.length > previous.results.length
                    ? data.results.length - 1 : Math.max(0, Math.min(data.results.length - 1, node.properties.adachi_result_index || 0));
                compare.setData(data, node.properties.adachi_result_index);
                return result;
            };
            const configured = node.onConfigure;
            node.onConfigure = function () {
                const result = configured?.apply(this, arguments);
                if (node.properties.adachi_compare) {
                    node.properties.adachi_compare = appendComparison(node.properties.adachi_compare);
                    node.properties.adachi_result_index = Math.max(0, Math.min(node.properties.adachi_compare.results.length - 1, node.properties.adachi_result_index || 0));
                    compare.setData(node.properties.adachi_compare, node.properties.adachi_result_index);
                }
                return result;
            };
            const removed = node.onRemoved;
            node.onRemoved = function () { stopWheelRouting(); compare.destroy(); return removed?.apply(this, arguments); };
            node.setSize([Math.max(550, node.size[0]), Math.max(550, node.size[1])]);
            return value;
        };
    },
});
