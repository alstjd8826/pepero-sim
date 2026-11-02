import type { Mask } from './raster';

/**
 * 단색 배경 일러스트(흰 배경 스티커·그림) 전용 배경 제거.
 *
 * 사진용 배경제거 모델은 "연한 크림색 몸통 + 점선 외곽선" 같은 그림에서 몸통을 배경으로 지워 버린다.
 * 가장자리가 거의 한 색이면 모델 대신, 가장자리에서부터 배경색과 가까운 픽셀만 페인트 통처럼 채워 지운다.
 * 배경색과 "비교"하는 기준은 이웃 픽셀이 아니라 배경색 자체라서, 점선 틈으로 몸통 쪽까지 번지지 않는다.
 */

export type Rgb = [number, number, number];

/** 가장자리 픽셀이 배경색과 같은 색으로 취급되는 채널별 최대 차이 */
const EDGE_TOL = 16;
/** 가장자리 중 이 비율 이상이 한 색이어야 단색 배경으로 본다 (캐릭터가 가장자리에 조금 닿는 건 허용) */
const EDGE_SOLID_RATIO = 0.85;
/** 배경으로 채울 때의 채널별 최대 차이. 흰색(255) vs 크림색(255,242,217) 은 38 차이라 남는다. */
const FILL_TOL = 20;

type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

function borderIndices(w: number, h: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < w; x++) {
    out.push(x);
    if (h > 1) out.push((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    out.push(y * w);
    if (w > 1) out.push(y * w + w - 1);
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function within(data: Uint8ClampedArray, p: number, c: Rgb, tol: number): boolean {
  const i = p * 4;
  return (
    Math.abs(data[i] - c[0]) <= tol &&
    Math.abs(data[i + 1] - c[1]) <= tol &&
    Math.abs(data[i + 2] - c[2]) <= tol
  );
}

/** 가장자리가 거의 한 색이면 그 색, 아니면 null (일반 사진 → 기존 모델 경로) */
export function detectFlatBackground(img: ImageData): Rgb | null {
  const { width: w, height: h, data } = img as RgbaImage;
  if (w < 3 || h < 3) return null;
  const border = borderIndices(w, h);
  const bg: Rgb = [0, 1, 2].map((c) => median(border.map((p) => data[p * 4 + c]))) as Rgb;
  let same = 0;
  for (const p of border) if (within(data, p, bg, EDGE_TOL)) same++;
  return same / border.length >= EDGE_SOLID_RATIO ? bg : null;
}

/** 가장자리에서 시작해 배경색과 가까운 픽셀을 4-연결로 채운다. 채워지지 않은 곳이 캐릭터(1). */
export function flatBackgroundMask(img: ImageData, bg: Rgb): Mask {
  const { width: w, height: h, data } = img as RgbaImage;
  const filled = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const p of borderIndices(w, h)) {
    if (!filled[p] && within(data, p, bg, FILL_TOL)) {
      filled[p] = 1;
      stack.push(p);
    }
  }
  const visit = (q: number) => {
    if (!filled[q] && within(data, q, bg, FILL_TOL)) {
      filled[q] = 1;
      stack.push(q);
    }
  };
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = filled[i] ? 0 : 1;
  return { width: w, height: h, data: out };
}
