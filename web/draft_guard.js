// Probe only our own temporary key. Existing ComfyUI drafts are never edited or deleted.
export const inlineWidgetNames = [
  "image", "mask_data", "source_data", "edit_mode", "crop_state", "blend_data", "layer_image",
];

// Some extensions also serialize a named snapshot. Keep it in step with the
// actual widgets, otherwise a removed embedding can survive in that snapshot.
export function syncInlineWidgets(data, widgets) {
  for (const name of inlineWidgetNames) {
    const index = widgets.findIndex((widget) => widget.name === name);
    if (index < 0) continue;
    if (Array.isArray(data.widgets_values)) data.widgets_values[index] = widgets[index].value;
    if (data.widgets_values_named && typeof data.widgets_values_named === "object")
      data.widgets_values_named[name] = widgets[index].value;
  }
}

function inlineNodes(graph, seen = new Set()) {
  if (!graph || seen.has(graph)) return [];
  seen.add(graph);
  return [
    ...(graph.nodes || []).filter((node) => node.type === "AdachiInlineMask"),
    ...(graph.definitions?.subgraphs || []).flatMap((subgraph) => inlineNodes(subgraph, seen)),
  ];
}

// Called before graph configuration: native autosave must never see the large
// source first, since a quota failure disables its storage for the entire tab.
export async function prepareInlineDraft(graph, { fits, upload }) {
  const nodes = inlineNodes(graph);
  for (const node of nodes) {
    if (!Array.isArray(node.widgets_values)) continue;
    for (const [index, name] of inlineWidgetNames.entries()) {
      if (index < node.widgets_values.length && node.widgets_values_named)
        node.widgets_values_named[name] = node.widgets_values[index];
    }
  }
  const candidates = nodes.filter((node) => {
    const embedded = node.widgets_values?.[2] ?? node.widgets_values_named?.source_data;
    return typeof embedded === "string" && embedded.startsWith("data:") && embedded.length >= 256 * 1024;
  }).sort((a, b) => (b.widgets_values?.[2] ?? b.widgets_values_named.source_data).length - (a.widgets_values?.[2] ?? a.widgets_values_named.source_data).length);
  let converted = 0;
  for (const node of candidates) {
    if (fits(graph) !== false) break;
    const embedded = node.widgets_values?.[2] ?? node.widgets_values_named.source_data;
    const filename = await upload(embedded);
    if (typeof filename !== "string" || !filename) throw new Error("Source upload returned no filename");
    // Commit only after a successful exact upload. All masks and layers stay intact.
    if (Array.isArray(node.widgets_values)) {
      node.widgets_values[0] = filename;
      node.widgets_values[2] = "";
    }
    if (node.widgets_values_named) {
      node.widgets_values_named.image = filename;
      node.widgets_values_named.source_data = "";
    }
    converted++;
  }
  return converted;
}

export function canStoreDraft(
  graph,
  { path = "", workspace = "personal", storage } = {},
) {
  try {
    storage ??= globalThis.localStorage;
  } catch {
    return null;
  }
  const serialized = JSON.stringify({
    data: JSON.stringify(graph),
    updatedAt: Date.now(),
  });
  let credit = 0;
  try {
    if (path) {
      const index = JSON.parse(
        storage.getItem(`Comfy.Workflow.DraftIndex.v2:${workspace}`) || "null",
      );
      if (
        Object.values(index?.entries || {}).some((entry) => entry.path === path)
      ) {
        // Standard FNV-1a path hash used by the current ComfyUI draft format.
        let hash = 2166136261;
        for (let i = 0; i < path.length; i++)
          hash = Math.imul(hash ^ path.charCodeAt(i), 16777619);
        const key = `Comfy.Workflow.Draft.v2:${workspace}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
        credit = storage.getItem(key)?.length || 0;
      }
    }
  } catch {
    /* Unknown metadata: a conservative probe still preserves all existing drafts. */
  }
  const needed = Math.max(0, serialized.length - credit);
  if (!needed) return true;
  const key = `Adachi.DraftProbe:${crypto.randomUUID()}`;
  try {
    storage.setItem(key, " ".repeat(needed));
    return true;
  } catch (error) {
    return error?.name === "QuotaExceededError" ? false : null;
  } finally {
    try {
      storage.removeItem(key);
    } catch {
      /* Storage may be unavailable. */
    }
  }
}
