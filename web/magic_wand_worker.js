import { selectRegion, selectBrushRegions } from "./wand_selection.js?v=0.6.0";
// ComfyUI also imports extension-directory modules in the page itself.
// Only bind a message handler inside the dedicated worker.
if (typeof document === "undefined") self.onmessage = ({ data: request }) => {
  try {
    const { pixels, width, height, x, y, tolerance, bounds, quick } = request;
    const data = new Uint8ClampedArray(pixels);
    const selected = quick
      ? selectBrushRegions(
          data,
          width,
          height,
          quick.points,
          quick.size,
          tolerance,
          bounds,
        )
      : selectRegion(data, width, height, x, y, tolerance, bounds);
    self.postMessage({ selected }, selected ? [selected.pixels] : []);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
