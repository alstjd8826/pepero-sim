import type { Mask } from './raster';

/**
 * 앞면 각인 높이맵 (spec 4.2.1).
 *
 * 좌표 규약: 실루엣 bbox(픽셀 모서리 기준, traceOuterContour 와 같은 격자)의 중심에 맞춘 정사각형
 * (한 변 = bbox 의 긴 변)을 size×size 로 샘플한다. 정규화 실루엣은 같은 bbox 를 중심 (0,0)·최대 치수 1 로
 * 옮긴 것이므로, 정규화 좌표 (nx, ny) 의 높이맵 UV = (nx + 0.5, ny + 0.5) (v 위쪽, 이미지 첫 행 = v 1).
 *
 * 반환값: 행 우선(첫 행 = 위), 0 = 평면, 255 = 깊게 눌림.
 */

/** 그레이 대비 기울기 임계값 (Sobel 크기 / 4, 그레이 0~1 기준) */
const EDGE_THRESHOLD = 0.08;
/** 이보다 작은 잡선 덩어리(픽셀, 256 기준)는 지운다 */
const MIN_COMPONENT_256 = 10;
/** 바깥 윤곽(배경 경계) 반응을 지우는 마스크 침식 반지름. 블러 2 + Sobel 1 + 여유 1 */
const EDGE_ERODE = 4;
/** 선 굵기를 위한 팽창 반지름 */
const DILATE = 2;
/** 한 출력 픽셀당 최대 서브샘플 수 (한 축) */
const MAX_SUBSAMPLES = 4;

type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export function extractRelief(image: ImageData, mask: Mask, size = 256): Uint8Array {
  const out = new Uint8Array(size * size);
  const bbox = maskBBox(mask);
  if (!bbox) return out;

  const { gray, inside } = sampleGray(image as RgbaImage, mask, bbox, size);
  const blurred = gaussianBlur(gray, size);
  const edges = sobelThreshold(blurred, size);
  const minComponent = Math.max(2, Math.round(MIN_COMPONENT_256 * (size / 256) ** 2));
  removeSmallComponents(edges, size, minComponent);

  const allowed = erode(inside, size, EDGE_ERODE);
  for (let i = 0; i < edges.length; i++) if (!allowed[i]) edges[i] = 0;
  const grown = dilate(edges, size, DILATE);
  for (let i = 0; i < out.length; i++) out[i] = grown[i] ? 255 : 0;
  return out;
}

/** 높이맵이 비었는가 (각인할 안쪽 선이 하나도 없음) */
export function isReliefEmpty(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i]) return false;
  return true;
}

/** 높이맵 → 불투명 그레이 PNG (브라우저 전용) */
export async function reliefToPngBlob(data: Uint8Array, size: number): Promise<Blob> {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = data[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const img = new ImageData(rgba, size, size);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 인코딩 실패'))), 'image/png'),
  );
}

type BBox = { cx: number; cy: number; side: number };

/** 전경 픽셀의 bbox (픽셀 모서리 좌표: [minX, maxX+1]) → 중심·정사각 한 변 */
function maskBBox(mask: Mask): BBox | null {
  const { width: w, height: h, data } = mask;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!data[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    cx: (minX + maxX + 1) / 2,
    cy: (minY + maxY + 1) / 2,
    side: Math.max(maxX + 1 - minX, maxY + 1 - minY),
  };
}

/**
 * 마스크 안 픽셀만 평균한 그레이 + 마스크 피복(>=0.5 → inside).
 * 마스크 밖은 전경 평균 그레이로 채워 배경 경계에서 가짜 선이 생기지 않게 한다.
 */
function sampleGray(img: RgbaImage, mask: Mask, bbox: BBox, size: number) {
  const n = size * size;
  const gray = new Float32Array(n);
  const inside = new Uint8Array(n);
  const known = new Uint8Array(n);
  const step = bbox.side / size;
  const k = Math.min(MAX_SUBSAMPLES, Math.max(1, Math.ceil(step)));
  const x0 = bbox.cx - bbox.side / 2;
  const y0 = bbox.cy - bbox.side / 2;
  const { width: w, height: h } = mask;
  const src = img.data;
  let totalG = 0;
  let totalM = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sumG = 0;
      let sumM = 0;
      for (let sy = 0; sy < k; sy++) {
        const y = Math.floor(y0 + (j + (sy + 0.5) / k) * step);
        if (y < 0 || y >= h) continue;
        for (let sx = 0; sx < k; sx++) {
          const x = Math.floor(x0 + (i + (sx + 0.5) / k) * step);
          if (x < 0 || x >= w) continue;
          const p = y * w + x;
          if (!mask.data[p]) continue;
          const q = p * 4;
          sumG += (0.299 * src[q] + 0.587 * src[q + 1] + 0.114 * src[q + 2]) / 255;
          sumM++;
        }
      }
      const o = j * size + i;
      if (sumM > 0) {
        gray[o] = sumG / sumM;
        known[o] = 1;
        totalG += sumG;
        totalM += sumM;
      }
      if (sumM * 2 >= k * k) inside[o] = 1;
    }
  }
  const mean = totalM > 0 ? totalG / totalM : 0;
  for (let o = 0; o < n; o++) if (!known[o]) gray[o] = mean;
  return { gray, inside };
}

/** 분리형 가우시안 [1 4 6 4 1]/16, 가장자리 clamp */
function gaussianBlur(src: Float32Array, size: number): Float32Array {
  const kernel = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const clamp = (v: number) => (v < 0 ? 0 : v >= size ? size - 1 : v);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) s += kernel[t + 2] * src[y * size + clamp(x + t)];
      tmp[y * size + x] = s;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) s += kernel[t + 2] * tmp[clamp(y + t) * size + x];
      dst[y * size + x] = s;
    }
  }
  return dst;
}

function sobelThreshold(src: Float32Array, size: number): Uint8Array {
  const out = new Uint8Array(src.length);
  const at = (x: number, y: number) =>
    src[(y < 0 ? 0 : y >= size ? size - 1 : y) * size + (x < 0 ? 0 : x >= size ? size - 1 : x)];
  const t2 = (EDGE_THRESHOLD * 4) ** 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), hh = at(x, y + 1), ii = at(x + 1, y + 1);
      const gx = c + 2 * f + ii - (a + 2 * d + g);
      const gy = g + 2 * hh + ii - (a + 2 * b + c);
      if (gx * gx + gy * gy > t2) out[y * size + x] = 1;
    }
  }
  return out;
}

/** 8-연결 덩어리 중 minSize 미만은 지운다 (제자리) */
function removeSmallComponents(bin: Uint8Array, size: number, minSize: number): void {
  const seen = new Uint8Array(bin.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || seen[i]) continue;
    seen[i] = 1;
    stack.push(i);
    members.length = 0;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % size;
      const y = (p - x) / size;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= size) continue;
          const q = yy * size + xx;
          if (bin[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (members.length < minSize) for (const p of members) bin[p] = 0;
  }
}

/** 정사각 구조요소 분리형 min/max. 침식은 영역 밖을 0 으로 본다(가장자리도 깎는다). */
function morph(src: Uint8Array, size: number, r: number, isErode: boolean): Uint8Array {
  const pass = (from: Uint8Array, horizontal: boolean) => {
    const to = new Uint8Array(from.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = isErode ? 1 : 0;
        for (let t = -r; t <= r; t++) {
          const xx = horizontal ? x + t : x;
          const yy = horizontal ? y : y + t;
          const s = xx < 0 || yy < 0 || xx >= size || yy >= size ? 0 : from[yy * size + xx];
          if (isErode ? !s : s) {
            v = isErode ? 0 : 1;
            break;
          }
        }
        to[y * size + x] = v;
      }
    }
    return to;
  };
  return pass(pass(src, true), false);
}

const erode = (src: Uint8Array, size: number, r: number) => morph(src, size, r, true);
const dilate = (src: Uint8Array, size: number, r: number) => morph(src, size, r, false);
