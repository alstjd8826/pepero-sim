import { describe, expect, it } from 'vitest';
import { detectFlatBackground, flatBackgroundMask } from '@/src/silhouette/flatBackground';

type Rgb = [number, number, number];

function image(w: number, h: number, color: (x: number, y: number) => Rgb): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = color(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data } as unknown as ImageData;
}

const WHITE: Rgb = [255, 255, 255];
const CREAM: Rgb = [255, 242, 217];
const BLACK: Rgb = [0, 0, 0];
const at = (m: { width: number; data: Uint8Array }, x: number, y: number) => m.data[y * m.width + x];
const area = (m: { data: Uint8Array }) => m.data.reduce((a, b) => a + b, 0);

/** 흰 배경 + 크림색 원 + 점선 외곽선 (재현 이미지와 같은 성질) */
const creamDashed = (x: number, y: number): Rgb => {
  const d = Math.hypot(x - 50, y - 50);
  if (d < 30) return CREAM;
  // 원 바깥쪽 점선: 각도 기준으로 띄엄띄엄
  const ang = Math.atan2(y - 50, x - 50);
  if (d < 32 && Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 24) % 2 === 0) return BLACK;
  return WHITE;
};

describe('detectFlatBackground', () => {
  it('가장자리가 한 가지 색이면 그 색을 돌려준다', () => {
    expect(detectFlatBackground(image(100, 100, creamDashed))).toEqual(WHITE);
  });

  it('캐릭터가 가장자리에 조금 닿아도 단색 배경으로 본다', () => {
    const img = image(100, 100, (x, y) => (x > 90 && y > 40 && y < 60 ? CREAM : WHITE));
    expect(detectFlatBackground(img)).toEqual(WHITE);
  });

  it('가장자리가 그라데이션/잡음이면 null (사진은 기존 AI 경로)', () => {
    const img = image(100, 100, (x, y) => [(x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256]);
    expect(detectFlatBackground(img)).toBeNull();
  });
});

describe('flatBackgroundMask', () => {
  it('크림색 몸통은 흰 배경과 구분되어 점선 사이로 새지 않고 한 덩어리로 남는다', () => {
    const img = image(100, 100, creamDashed);
    const m = flatBackgroundMask(img, WHITE);
    expect(at(m, 50, 50)).toBe(1);
    expect(at(m, 50, 75)).toBe(1); // 원 안쪽 아래
    expect(at(m, 2, 2)).toBe(0);
    // 원 넓이(≈ π·30² ≈ 2827) 이상 남아야 한다
    expect(area(m)).toBeGreaterThan(2700);
  });

  it('외곽선에 둘러싸인 흰 영역(목도리 등)은 배경으로 지우지 않는다', () => {
    const img = image(100, 100, (x, y) => {
      const d = Math.hypot(x - 50, y - 50);
      if (d < 20) return WHITE; // 안쪽 흰색
      if (d < 24) return BLACK; // 닫힌 선
      return WHITE;
    });
    const m = flatBackgroundMask(img, WHITE);
    expect(at(m, 50, 50)).toBe(1);
    expect(at(m, 5, 5)).toBe(0);
  });

  it('JPEG 잡음 정도(±6)의 배경은 함께 지운다', () => {
    const img = image(100, 100, (x, y) => {
      if (Math.hypot(x - 50, y - 50) < 25) return CREAM;
      const n = ((x * 31 + y * 17) % 13) - 6;
      return [255 + Math.min(0, n), 255 + Math.min(0, n), 255 + Math.min(0, n)];
    });
    const m = flatBackgroundMask(img, WHITE);
    expect(at(m, 1, 1)).toBe(0);
    expect(at(m, 20, 80)).toBe(0);
    expect(at(m, 50, 50)).toBe(1);
  });
});
