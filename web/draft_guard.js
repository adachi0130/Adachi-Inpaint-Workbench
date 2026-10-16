// Probe only our own temporary key. Existing ComfyUI drafts are never edited or deleted.
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
