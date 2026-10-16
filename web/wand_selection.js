// Contiguous, seed-relative color selection. Shared by the worker and regression tests.
export function selectRegion(data, width, height, x, y, tolerance, bounds) {
  if (
    ![width, height, x, y].every(Number.isInteger) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  )
    return null;
  const left = Math.max(0, bounds?.x || 0),
    top = Math.max(0, bounds?.y || 0);
  const right = Math.min(width, bounds ? left + bounds.width : width),
    bottom = Math.min(height, bounds ? top + bounds.height : height);
  if (x < left || x >= right || y < top || y >= bottom) return null;
  const bw = right - left,
    bh = bottom - top;
  const seen = new Uint8Array(bw * bh),
    queue = new Uint32Array(bw * bh);
  const seed = (y * width + x) * 4,
    threshold = 3 * (Math.max(0, Math.min(100, tolerance)) * 2.55) ** 2;
  let head = 0,
    tail = 0,
    minX = x,
    maxX = x,
    minY = y,
    maxY = y;
  const visit = (px, py) => {
    const local = (py - top) * bw + px - left;
    if (seen[local]) return;
    seen[local] = 2;
    const i = (py * width + px) * 4;
    const distance =
      (data[i] - data[seed]) ** 2 +
      (data[i + 1] - data[seed + 1]) ** 2 +
      (data[i + 2] - data[seed + 2]) ** 2;
    if (distance > threshold || Math.abs(data[i + 3] - data[seed + 3]) > 32)
      return;
    seen[local] = 1;
    queue[tail++] = local;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };
  visit(x, y);
  while (head < tail) {
    const i = queue[head++],
      px = (i % bw) + left,
      py = Math.floor(i / bw) + top;
    if (px > left) visit(px - 1, py);
    if (px + 1 < right) visit(px + 1, py);
    if (py > top) visit(px, py - 1);
    if (py + 1 < bottom) visit(px, py + 1);
  }
  const w = maxX - minX + 1,
    h = maxY - minY + 1,
    pixels = new Uint8ClampedArray(w * h * 4);
  for (let py = minY; py <= maxY; py++)
    for (let px = minX; px <= maxX; px++) {
      if (seen[(py - top) * bw + px - left] !== 1) continue;
      pixels.fill(
        255,
        ((py - minY) * w + px - minX) * 4,
        ((py - minY) * w + px - minX) * 4 + 4,
      );
    }
  return { x: minX, y: minY, width: w, height: h, pixels: pixels.buffer };
}

// Brush-guided region growth: sample colors underneath a stroke, union their
// contiguous regions and keep existing selections when the brush crosses edges.
export function selectBrushRegions(
  data,
  width,
  height,
  points,
  size,
  tolerance,
  bounds,
) {
  if (!points?.length || data.length !== width * height * 4) return null;
  const left = Math.max(0, bounds?.x || 0),
    top = Math.max(0, bounds?.y || 0);
  const right = Math.min(width, bounds ? left + bounds.width : width),
    bottom = Math.min(height, bounds ? top + bounds.height : height);
  const bw = right - left,
    bh = bottom - top,
    selected = new Uint8Array(bw * bh),
    seen = new Uint16Array(bw * bh),
    queue = new Uint32Array(bw * bh);
  const threshold = 3 * (Math.max(0, Math.min(100, tolerance)) * 2.55) ** 2;
  let stamp = 0,
    minX = right,
    maxX = left,
    minY = bottom,
    maxY = top,
    work = 0;
  const seeds = [];
  const sample = (p) => {
    const radius = Math.max(0, size * 0.35);
    for (const [dx, dy] of [
      [0, 0],
      [-radius, 0],
      [radius, 0],
      [0, -radius],
      [0, radius],
    ])
      seeds.push([Math.floor(p.x + dx), Math.floor(p.y + dy)]);
  };
  sample(points[0]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      steps = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, size * 0.4)),
      );
    for (let j = 1; j <= Math.min(steps, 256); j++) {
      const t = j / Math.min(steps, 256);
      sample({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  for (const [sx, sy] of seeds) {
    if (
      sx < left ||
      sx >= right ||
      sy < top ||
      sy >= bottom ||
      selected[(sy - top) * bw + sx - left]
    )
      continue;
    if (++stamp > 512)
      throw Error("Selection is too complex; use a shorter stroke.");
    const seed = (sy * width + sx) * 4;
    let head = 0,
      tail = 0;
    const visit = (x, y) => {
      const local = (y - top) * bw + x - left;
      if (seen[local] === stamp) return;
      seen[local] = stamp;
      if (++work > 128_000_000)
        throw Error(
          "Selection is too complex; try a smaller region or tolerance.",
        );
      const k = (y * width + x) * 4;
      if (
        (data[k] - data[seed]) ** 2 +
          (data[k + 1] - data[seed + 1]) ** 2 +
          (data[k + 2] - data[seed + 2]) ** 2 >
          threshold ||
        Math.abs(data[k + 3] - data[seed + 3]) > 32
      )
        return;
      selected[local] = 1;
      queue[tail++] = local;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    visit(sx, sy);
    while (head < tail) {
      const local = queue[head++],
        x = (local % bw) + left,
        y = Math.floor(local / bw) + top;
      if (x > left) visit(x - 1, y);
      if (x + 1 < right) visit(x + 1, y);
      if (y > top) visit(x, y - 1);
      if (y + 1 < bottom) visit(x, y + 1);
    }
  }
  if (!stamp) return null;
  const w = maxX - minX + 1,
    h = maxY - minY + 1,
    pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      if (selected[(y - top) * bw + x - left]) {
        const i = ((y - minY) * w + x - minX) * 4;
        pixels.fill(255, i, i + 4);
      }
  return { x: minX, y: minY, width: w, height: h, pixels: pixels.buffer };
}
