export const CROP_PRESETS = [
  [1024, 1536],
  [1536, 1024],
  [1024, 1024],
  [1152, 1536],
  [1536, 1152],
  [1024, 1280],
  [1280, 1024],
  [1280, 1536],
  [1536, 1280],
  [768, 1024],
  [1024, 768],
  [768, 768],
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
