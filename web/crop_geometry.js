export const CROP_PRESETS = [
  [1024, 1536],
  [512, 512],
  [768, 1024],
  [1024, 1024],
  [1536, 2048],
  [2048, 2048],
];

export function cropAt(width, height, cropWidth, cropHeight, x, y) {
  if (
    ![width, height, cropWidth, cropHeight, x, y].every(Number.isFinite) ||
    cropWidth < 32 ||
    cropHeight < 32 ||
    cropWidth % 32 ||
    cropHeight % 32 ||
    cropWidth > width ||
    cropHeight > height
  )
    return null;
  return {
    x: Math.max(0, Math.min(width - cropWidth, Math.floor(x))),
    y: Math.max(0, Math.min(height - cropHeight, Math.floor(y))),
    width: cropWidth,
    height: cropHeight,
  };
}
