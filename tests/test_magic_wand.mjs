import assert from "node:assert/strict";
import { selectRegion, selectBrushRegions } from "../web/wand_selection.js";
const w = 8,
  h = 4,
  pixels = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    pixels[i] = x === 3 ? 255 : 80;
    pixels[i + 1] = 90;
    pixels[i + 2] = 100;
    pixels[i + 3] = 255;
  }
let r = selectRegion(pixels, w, h, 0, 0, 0);
assert.deepEqual([r.x, r.y, r.width, r.height], [0, 0, 3, 4]);
assert.equal(
  new Uint8ClampedArray(r.pixels).filter((v, i) => i % 4 === 3 && v === 255)
    .length,
  12,
);
r = selectRegion(pixels, w, h, 0, 0, 100);
assert.deepEqual([r.width, r.height], [8, 4]);
r = selectRegion(pixels, w, h, 1, 1, 0, { x: 1, y: 1, width: 2, height: 2 });
assert.deepEqual([r.x, r.y, r.width, r.height], [1, 1, 2, 2]);
assert.equal(
  selectRegion(pixels, w, h, 0, 0, 0, { x: 1, y: 1, width: 2, height: 2 }),
  null,
);
assert.equal(selectRegion(pixels, w, h, -1, 0, 20), null);
const similar = pixels.slice();
similar[4] = 90;
r = selectRegion(similar, w, h, 0, 0, 1);
assert.equal(new Uint8ClampedArray(r.pixels)[7], 0);
r = selectRegion(similar, w, h, 0, 0, 10);
assert.equal(new Uint8ClampedArray(r.pixels)[7], 255);
console.log(
  "Magic wand: contiguous boundaries, tolerance, holes and region limits passed",
);

r = selectBrushRegions(
  pixels,
  w,
  h,
  [
    { x: 0, y: 1 },
    { x: 6, y: 1 },
  ],
  1,
  0,
);
assert.deepEqual([r.width, r.height], [8, 4]);
r = selectBrushRegions(pixels, w, h, [{ x: 0, y: 1 }], 1, 0);
assert.deepEqual([r.x, r.width], [0, 3]);
r = selectBrushRegions(
  pixels,
  w,
  h,
  [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
  1,
  0,
  { x: 1, y: 1, width: 2, height: 2 },
);
assert.deepEqual([r.x, r.y, r.width, r.height], [1, 1, 2, 2]);
console.log(
  "Quick selection: stroke unions, color barriers and crop bounds passed",
);
