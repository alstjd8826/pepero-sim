import type { Mask } from '@/src/silhouette/raster';

export function makeMask(w: number, h: number, fn: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y) ? 1 : 0;
  return { width: w, height: h, data };
}
