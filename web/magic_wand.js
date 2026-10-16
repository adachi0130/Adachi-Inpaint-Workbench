export function selectSimilar(
  imageData,
  x,
  y,
  tolerance,
  bounds,
  quick = null,
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./magic_wand_worker.js?v=0.6.0", import.meta.url),
      { type: "module" },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Magic wand timed out; try a smaller image."));
    }, 30000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      finish();
      data.error ? reject(Error(data.error)) : resolve(data.selected);
    };
    worker.onerror = (event) => {
      finish();
      reject(Error(event.message || "Magic wand worker failed."));
    };
    worker.postMessage(
      {
        pixels: imageData.data.buffer,
        width: imageData.width,
        height: imageData.height,
        x,
        y,
        tolerance,
        bounds,
        quick,
      },
      [imageData.data.buffer],
    );
  });
}
