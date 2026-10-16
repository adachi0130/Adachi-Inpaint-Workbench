import assert from "node:assert/strict";
import { canStoreDraft, prepareInlineDraft, syncInlineWidgets, inlineWidgetNames } from "../web/draft_guard.js";
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

const large = "data:image/png;base64," + "a".repeat(300000);
const node = () => ({ type: "AdachiInlineMask", widgets_values: ["old.png", "mask", large, "crop", "region", "blend", "layer.png"], widgets_values_named: { image: "stale.png", mask_data: "stale-mask", source_data: large, edit_mode: "mask" } });
const first = node(), nested = node();
const graph = { nodes: [first, {type:"Other", widgets_values:[large]}], definitions: {subgraphs:[{nodes:[nested]}]} };
const original = structuredClone(graph);
let uploads = 0;
assert.equal(await prepareInlineDraft(graph, { fits: g => g.nodes[0].widgets_values[2].length < 100 && g.definitions.subgraphs[0].nodes[0].widgets_values[2].length < 100, upload: async bytes => { assert.equal(bytes,large); return `source-${++uploads}.png`; } }),2);
assert.equal(uploads,2);
for (const n of [first,nested]) {
  assert.equal(n.widgets_values[2],"");
  assert.equal(n.widgets_values_named.source_data,"");
  assert.equal(n.widgets_values_named.image,n.widgets_values[0]);
  assert.equal(n.widgets_values_named.mask_data,"mask");
  assert.deepEqual(n.widgets_values.slice(3),["crop","region","blend","layer.png"]);
}
assert.deepEqual(graph.nodes[1],original.nodes[1]);
for (const fits of [() => true, () => null]) {
  const g = {nodes:[node()]};
  assert.equal(await prepareInlineDraft(g,{fits,upload:()=>{throw Error("unexpected upload")}}),0);
  assert.equal(g.nodes[0].widgets_values[2],large);
}
const failure = {nodes:[node()]};
await assert.rejects(prepareInlineDraft(failure,{fits:()=>false,upload:async()=>{throw Error("upload failed")}}),/upload failed/);
assert.equal(failure.nodes[0].widgets_values[2],large);
assert.equal(failure.nodes[0].widgets_values[0],"old.png");
const namedOnly = {nodes:[{type:"AdachiInlineMask", widgets_values_named:{source_data:large,mask_data:"keep"}}]};
await prepareInlineDraft(namedOnly,{fits:()=>false,upload:async()=>"named.png"});
assert.equal(namedOnly.nodes[0].widgets_values_named.source_data,"");
assert.equal(namedOnly.nodes[0].widgets_values_named.mask_data,"keep");
const widgets=inlineWidgetNames.map((name,index)=>({name,value:`live-${index}`}));
widgets.splice(1,0,{name:"unrelated",value:"untouched"});
const snapshot={widgets_values:Array(8).fill("old"),widgets_values_named:{source_data:large,unrelated:"keep"}};
syncInlineWidgets(snapshot,widgets);
assert.equal(snapshot.widgets_values[3],"live-2");
assert.equal(snapshot.widgets_values[1],"old");
assert.equal(snapshot.widgets_values_named.source_data,"live-2");
assert.equal(snapshot.widgets_values_named.unrelated,"keep");
const arrayOnly={widgets_values:[]}; syncInlineWidgets(arrayOnly,widgets);
assert.equal(arrayOnly.widgets_values_named,undefined);
console.log("Draft preflight: root/subgraph sources, dual snapshots, unchanged masks/layers, fitting sources and failed uploads passed");
