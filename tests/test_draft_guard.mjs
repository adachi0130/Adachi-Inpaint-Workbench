import assert from "node:assert/strict";
import { canStoreDraft } from "../web/draft_guard.js";
class Storage {
  constructor(limit = 10000) {
    this.limit = limit;
    this.data = new Map();
    this.removed = [];
  }
  getItem(k) {
    return this.data.get(k) ?? null;
  }
  setItem(k, v) {
    const used = [...this.data].reduce(
      (n, [key, value]) => n + (key === k ? 0 : value.length),
      0,
    );
    if (used + v.length > this.limit)
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    this.data.set(k, v);
  }
  removeItem(k) {
    this.removed.push(k);
    this.data.delete(k);
  }
}
const storage = new Storage();
storage.setItem("unrelated", "keep");
assert.equal(canStoreDraft({ nodes: [] }, { storage }), true);
assert.equal(canStoreDraft({ data: "x".repeat(20000) }, { storage }), false);
assert.equal(storage.getItem("unrelated"), "keep");
assert.ok(storage.removed.every((key) => key.startsWith("Adachi.DraftProbe:")));
assert.equal(storage.data.size, 1);
// Replacing a draft must reuse its existing space, rather than testing two full copies.
const path = "workflows/Test.json";
let hash = 2166136261;
for (const c of path) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
const payloadKey = `Comfy.Workflow.Draft.v2:personal:${(hash >>> 0).toString(16).padStart(8, "0")}`;
const oldGraph = { image: "x".repeat(6000) },
  oldRaw = JSON.stringify({
    data: JSON.stringify(oldGraph),
    updatedAt: Date.now(),
  });
storage.setItem(
  "Comfy.Workflow.DraftIndex.v2:personal",
  JSON.stringify({ entries: { one: { path } } }),
);
storage.setItem(payloadKey, oldRaw);
assert.equal(
  canStoreDraft({ ...oldGraph, mode: "crop" }, { path, storage }),
  true,
);
assert.equal(storage.getItem(payloadKey), oldRaw);
assert.equal(
  canStoreDraft({ image: "x".repeat(12000) }, { path, storage }),
  false,
);
assert.equal(storage.getItem(payloadKey), oldRaw);
assert.equal(
  canStoreDraft(
    {},
    {
      storage: {
        getItem() {
          throw Error("blocked");
        },
        setItem() {
          throw Object.assign(Error("blocked"), { name: "SecurityError" });
        },
        removeItem() {},
      },
    },
  ),
  null,
);
console.log(
  "Draft guard: quota detection, replacement credit, probe cleanup and preservation of existing storage passed",
);
