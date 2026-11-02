import { describe, expect, it } from 'vitest';
import { extractRelief } from '@/src/silhouette/relief';
import { makeMask } from './helpers';

function makeImage(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
}

const W = 256;
const C = W / 2;
const R = 100;
const inDisc = (x: number, y: number) => (x + 0.5 - C) ** 2 + (y + 0.5 - C) ** 2 <= R * R;
/** 가운데 세로 검은 선 (폭 4px) */
const onLine = (x: number) => x >= C - 2 && x < C + 2;

describe('extractRelief', () => {
  it('단색 이미지 → 전부 0', () => {
    const img = makeImage(W, W, () => [200, 120, 80, 255]);
    const mask = makeMask(W, W, () => true);
    const out = extractRelief(img, mask);
    expect(out.length).toBe(256 * 256);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('단색 원(투명 배경) → 윤곽선은 각인되지 않는다', () => {
    const img = makeImage(W, W, (x, y) => (inDisc(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const mask = makeMask(W, W, inDisc);
    const out = extractRelief(img, mask);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('가운데 검은 선이 있는 흰 원 → 선 위치 > 128, 마스크 밖 0', () => {
    const img = makeImage(W, W, (x, y) =>
      inDisc(x, y) ? (onLine(x) ? [0, 0, 0, 255] : [255, 255, 255, 255]) : [0, 0, 0, 0],
    );
    const mask = makeMask(W, W, inDisc);
    const size = 128;
    const out = extractRelief(img, mask, size);
    expect(out.length).toBe(size * size);
    // 원 bbox(200px) → 128px: 가운데 열 = 선
    const mid = size / 2;
    for (const y of [mid - 30, mid - 10, mid, mid + 10, mid + 30]) {
      expect(Math.max(out[y * size + mid - 1], out[y * size + mid])).toBeGreaterThan(128);
    }
    // 선에서 먼 원 안쪽은 0
    expect(out[mid * size + mid - 30]).toBe(0);
    // 마스크 밖(원 bbox 를 꽉 채운 정사각형의 모서리) 은 0
    const s = size;
    for (const [x, y] of [[0, 0], [s - 1, 0], [0, s - 1], [s - 1, s - 1], [4, 4]]) {
      expect(out[y * s + x]).toBe(0);
    }
    // 원 밖 전체 0: 정규화 좌표에서 반지름 0.5 바깥
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const nx = (x + 0.5) / s - 0.5;
        const ny = (y + 0.5) / s - 0.5;
        if (nx * nx + ny * ny > 0.25) expect(out[y * s + x]).toBe(0);
      }
    }
  });

  it('마스크가 비면 전부 0', () => {
    const img = makeImage(16, 16, () => [0, 0, 0, 255]);
    const out = extractRelief(img, makeMask(16, 16, () => false), 32);
    expect(out.length).toBe(32 * 32);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
