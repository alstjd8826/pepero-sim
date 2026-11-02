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

  it('밝기가 비슷한 두 색(빨강/초록)의 경계도 각인된다', () => {
    // 휘도 ≈ 같음: 빨강(200,90,90) L≈0.47, 초록(60,140,60) L≈0.47 (그레이로는 구분 불가)
    const img = makeImage(W, W, (x, y) =>
      inDisc(x, y) ? (x < C ? [200, 90, 90, 255] : [60, 140, 60, 255]) : [0, 0, 0, 0],
    );
    const mask = makeMask(W, W, inDisc);
    const size = 128;
    const out = extractRelief(img, mask, size);
    const mid = size / 2;
    for (const y of [mid - 30, mid, mid + 30]) {
      expect(Math.max(out[y * size + mid - 1], out[y * size + mid])).toBeGreaterThan(128);
    }
    // 각 색 영역 안쪽은 평평
    expect(out[mid * size + mid - 25]).toBe(0);
    expect(out[mid * size + mid + 25]).toBe(0);
  });

  it('색 면(분홍 볼)은 테두리만 각인되고 안쪽은 평평하다', () => {
    const inCheek = (x: number, y: number) => (x - C) ** 2 + (y - C) ** 2 <= 40 * 40;
    const img = makeImage(W, W, (x, y) =>
      inDisc(x, y) ? (inCheek(x, y) ? [245, 170, 180, 255] : [255, 242, 217, 255]) : [0, 0, 0, 0],
    );
    const mask = makeMask(W, W, inDisc);
    const size = 200; // bbox 200px → 1:1
    const out = extractRelief(img, mask, size);
    const c = size / 2;
    expect(out[c * size + c]).toBe(0); // 볼 한가운데
    // 볼 테두리(반지름 40) 근처에 선
    let hit = 0;
    for (let dx = 37; dx <= 43; dx++) if (out[c * size + c + dx] > 128) hit++;
    expect(hit).toBeGreaterThan(0);
  });

  it('검은 선은 한 줄로 찍히고 양옆에 이중선이 생기지 않는다', () => {
    const img = makeImage(W, W, (x, y) =>
      inDisc(x, y) ? (onLine(x) ? [0, 0, 0, 255] : [255, 242, 217, 255]) : [0, 0, 0, 0],
    );
    const mask = makeMask(W, W, inDisc);
    const size = 200;
    const out = extractRelief(img, mask, size);
    const c = size / 2;
    expect(Math.max(out[c * size + c - 1], out[c * size + c])).toBeGreaterThan(128);
    for (const dx of [6, 8, 12]) {
      expect(out[c * size + c - 1 - dx]).toBe(0);
      expect(out[c * size + c + dx]).toBe(0);
    }
  });

  it('JPEG 잡음 정도의 단색 면은 각인되지 않는다', () => {
    const img = makeImage(W, W, (x, y) => {
      if (!inDisc(x, y)) return [0, 0, 0, 0];
      const n = ((x * 31 + y * 17) % 9) - 4;
      return [250 + n, 238 + n, 212 + n, 255];
    });
    const out = extractRelief(img, makeMask(W, W, inDisc), 128);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('마스크가 비면 전부 0', () => {
    const img = makeImage(16, 16, () => [0, 0, 0, 255]);
    const out = extractRelief(img, makeMask(16, 16, () => false), 32);
    expect(out.length).toBe(32 * 32);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
