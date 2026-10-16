import assert from "node:assert/strict";
import { CROP_PRESETS, cropAt } from "../web/crop_geometry.js";
assert.ok(CROP_PRESETS.length <= 6);
assert.ok(CROP_PRESETS.some(([w,h]) => w === 512 && h === 512));
assert.ok(CROP_PRESETS.some(([w,h]) => w === 2048 && h === 2048));
assert.ok(CROP_PRESETS.every(([w, h]) => w % 64 === 0 && h % 64 === 0 && Math.min(w,h) >= 512 && Math.max(w,h) <= 2048));
assert.deepEqual(cropAt(2048, 3072, 1024, 1536, 400, 700), {
  x: 400,
  y: 700,
  width: 1024,
  height: 1536,
});
assert.deepEqual(cropAt(2048, 3072, 1024, 1536, 2040, 3070), {
  x: 1024,
  y: 1536,
  width: 1024,
  height: 1536,
});
assert.equal(cropAt(512, 512, 1024, 1536, 0, 0), null);
assert.equal(cropAt(2048, 3072, 1025, 1536, 0, 0), null);
assert.equal(cropAt(2048, 3072, 1024, 1536, NaN, 0), null);
for (const x of [-100, 0, 12.9, 1000, 3000])
  for (const y of [-1, 0, 2200, 4000]) {
    const r = cropAt(2048, 3072, 1024, 1536, x, y);
    assert.ok(
      r.x >= 0 && r.y >= 0 && r.x + r.width <= 2048 && r.y + r.height <= 3072,
    );
  }
console.log("Crop presets, source coordinates and edge clamping passed");
