import { describe, expect, it } from 'vitest';
import {
  alphaToMask,
  hasMeaningfulAlpha,
  largestComponent,
  morphClose,
  morphOpen,
  type Mask,
} from '@/src/silhouette/raster';
import { makeMask } from './helpers';

const count = (m: Mask) => m.data.reduce((a, b) => a + b, 0);

function img(w: number, h: number, alphaFn: (i: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = alphaFn(i);
  }
  return { width: w, height: h, data } as unknown as ImageData;
}

describe('raster', () => {
  it('largestComponent keeps only the biggest 4-connected blob', () => {
    const m = makeMask(60, 60, (x, y) => (x >= 5 && x < 35 && y >= 5 && y < 35) || (x >= 50 && x < 53 && y >= 50 && y < 53));
    expect(count(m)).toBe(909);
    expect(count(largestComponent(m))).toBe(900);
  });

  it('hasMeaningfulAlpha detects >=5% transparent pixels', () => {
    expect(hasMeaningfulAlpha(img(10, 10, () => 255))).toBe(false);
    expect(hasMeaningfulAlpha(img(10, 10, (i) => (i < 5 ? 0 : 255)))).toBe(true);
    expect(hasMeaningfulAlpha(img(10, 10, (i) => (i < 4 ? 0 : 255)))).toBe(false);
  });

  it('alphaToMask thresholds alpha', () => {
    const m = alphaToMask(img(2, 1, (i) => (i === 0 ? 127 : 128)));
    expect(Array.from(m.data)).toEqual([0, 1]);
  });

  it('morphOpen removes thin spurs, morphClose fills small gaps', () => {
    const spur = makeMask(30, 30, (x, y) => (x >= 8 && x < 22 && y >= 8 && y < 22) || (y === 15 && x >= 22 && x < 28));
    const opened = morphOpen(spur, 2);
    expect(opened.data[15 * 30 + 25]).toBe(0);
    expect(opened.data[15 * 30 + 15]).toBe(1);
    const gap = makeMask(30, 30, (x, y) => x >= 5 && x < 25 && y >= 5 && y < 25 && x !== 15);
    expect(morphClose(gap, 2).data[15 * 30 + 15]).toBe(1);
  });
});
