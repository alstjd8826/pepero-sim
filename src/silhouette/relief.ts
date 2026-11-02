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

/**
 * 색 분리 방식 (색별로 영역을 나눠 경계를 찍는다):
 * 1) 실루엣 안을 Lab 색으로 샘플 → 살짝 블러(JPEG 잡음 제거)
 * 2) k-means 로 대표색 몇 개로 묶고, 비슷한 색(ΔE < MERGE_DE)·너무 작은 무리는 합친다
 * 3) 아주 어두운 무리(검은 선·눈동자 = "잉크")는 그 자체를 눌러 찍는다 → 선이 한 줄로 찍힘
 * 4) 잉크가 아닌 색 영역끼리의 경계를 얇은 선으로 찍는다 → 볼·옷·잎사귀처럼 밝기가 비슷한 색도 구분
 * 그레이 기울기만 보던 이전 방식은 밝기 같은 두 색의 경계를 놓치고, 검은 선 양쪽에 이중선이 생겨 뭉개졌다.
 */

/** 처음 나눌 대표색 수 */
const K = 10;
const KMEANS_ITERS = 12;
/** 학습에 쓰는 최대 픽셀 수 (나머지는 배정만) */
const KMEANS_SAMPLES = 20000;
/** 이보다 가까운 두 대표색은 같은 색으로 본다 (CIE76 ΔE) */
const MERGE_DE = 14;
/** 전체의 이 비율보다 작은 색 무리는 가장 가까운 색에 흡수 (안티앨리어싱 중간색 제거) */
const MIN_CLUSTER_SHARE = 0.006;
/** 이 밝기(L*) 미만 무리는 잉크(선) */
const INK_L = 38;
/** 잉크가 실루엣의 이 비율을 넘으면(검은 캐릭터 등) 잉크도 일반 색 면으로 취급 */
const INK_MAX_SHARE = 0.4;
/** 이보다 작은 잡선 덩어리(픽셀, 256 기준)는 지운다 */
const MIN_COMPONENT_256 = 10;
/** 바깥 윤곽(배경 경계) 근처를 비우는 반지름 (256 기준) */
const EDGE_ERODE_256 = 3;
/** 한 출력 픽셀당 최대 서브샘플 수 (한 축) */
const MAX_SUBSAMPLES = 4;

type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export function extractRelief(image: ImageData, mask: Mask, size = 256): Uint8Array {
  const out = new Uint8Array(size * size);
  const bbox = maskBBox(mask);
  if (!bbox) return out;

  const { lab, inside } = sampleLab(image as RgbaImage, mask, bbox, size);
  const n = size * size;
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = lab[i * 3 + c];
    const b = gaussianBlur(ch, size);
    for (let i = 0; i < n; i++) lab[i * 3 + c] = b[i];
  }

  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (inside[i]) idx.push(i);
  if (idx.length === 0) return out;

  const centers = clusterColors(lab, idx);
  const labels = new Int16Array(n).fill(-1);
  for (const i of idx) labels[i] = nearest(centers, lab, i);
  modeFilter(labels, size);
  modeFilter(labels, size);

  // 잉크 판정
  const counts = new Array(centers.length).fill(0);
  for (const i of idx) if (labels[i] >= 0) counts[labels[i]]++;
  const ink = centers.map((c) => c[0] < INK_L);
  const inkShare = counts.reduce((a, v, k) => a + (ink[k] ? v : 0), 0) / idx.length;
  if (inkShare > INK_MAX_SHARE) ink.fill(false);

  const marks = new Uint8Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      const a = labels[p];
      if (a < 0) continue;
      if (ink[a]) {
        marks[p] = 1;
        continue;
      }
      // 오른쪽·아래 이웃과 색이 다르면 경계 (잉크와의 경계는 잉크가 이미 찍히므로 제외)
      const r = x + 1 < size ? labels[p + 1] : -1;
      const d = y + 1 < size ? labels[p + size] : -1;
      if ((r >= 0 && r !== a && !ink[r]) || (d >= 0 && d !== a && !ink[d])) marks[p] = 1;
    }
  }

  const scale = size / 256;
  const allowed = erode(inside, size, Math.max(1, Math.round(EDGE_ERODE_256 * scale)));
  for (let i = 0; i < n; i++) if (!allowed[i]) marks[i] = 0;
  removeSmallComponents(marks, size, Math.max(2, Math.round(MIN_COMPONENT_256 * scale * scale)));
  const grown = scale >= 1.5 ? dilate(marks, size, 1) : marks;
  for (let i = 0; i < n; i++) out[i] = grown[i] ? 255 : 0;
  return out;
}

type Lab = [number, number, number];

function dist2(a: Lab, lab: Float32Array, i: number): number {
  const d0 = a[0] - lab[i * 3], d1 = a[1] - lab[i * 3 + 1], d2 = a[2] - lab[i * 3 + 2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

function nearest(centers: Lab[], lab: Float32Array, i: number): number {
  let best = 0, bd = Infinity;
  for (let k = 0; k < centers.length; k++) {
    const d = dist2(centers[k], lab, i);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** 결정적 k-means (가장 먼 점 초기화) → 가까운 색 병합 → 작은 무리 흡수 */
function clusterColors(lab: Float32Array, idx: number[]): Lab[] {
  const stride = Math.max(1, Math.floor(idx.length / KMEANS_SAMPLES));
  const pts: number[] = [];
  for (let j = 0; j < idx.length; j += stride) pts.push(idx[j]);

  const mean: Lab = [0, 0, 0];
  for (const i of pts) for (let c = 0; c < 3; c++) mean[c] += lab[i * 3 + c] / pts.length;
  let centers: Lab[] = [mean];
  const minD = pts.map((i) => dist2(mean, lab, i));
  while (centers.length < K) {
    let far = -1, fd = 0;
    for (let j = 0; j < pts.length; j++) if (minD[j] > fd) { fd = minD[j]; far = j; }
    if (far < 0 || fd < MERGE_DE * MERGE_DE) break;
    const i = pts[far];
    const c: Lab = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
    centers.push(c);
    for (let j = 0; j < pts.length; j++) minD[j] = Math.min(minD[j], dist2(c, lab, pts[j]));
  }

  let weights: number[] = [];
  for (let it = 0; it < KMEANS_ITERS; it++) {
    const sum = centers.map(() => [0, 0, 0] as Lab);
    weights = centers.map(() => 0);
    for (const i of pts) {
      const k = nearest(centers, lab, i);
      weights[k]++;
      for (let c = 0; c < 3; c++) sum[k][c] += lab[i * 3 + c];
    }
    centers = centers.map((c, k) => (weights[k] ? (sum[k].map((v) => v / weights[k]) as Lab) : c));
  }

  // 병합: 가까운 쌍을 가중 평균으로 합치기를 더 없을 때까지
  const list = centers.map((c, k) => ({ c, w: weights[k] })).filter((e) => e.w > 0);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        const d = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1], A.c[2] - B.c[2]);
        if (d < MERGE_DE) {
          const w = A.w + B.w;
          list[a] = { c: [0, 1, 2].map((t) => (A.c[t] * A.w + B.c[t] * B.w) / w) as Lab, w };
          list.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  // 작은 무리 제거 (최소 1개는 남긴다)
  const total = list.reduce((a, e) => a + e.w, 0);
  const kept = list.filter((e) => e.w / total >= MIN_CLUSTER_SHARE);
  return (kept.length ? kept : list.slice(0, 1)).map((e) => e.c);
}

/** 3×3 최빈값 필터 (실루엣 안만). 경계의 계단·점 잡음을 다듬는다. */
function modeFilter(labels: Int16Array, size: number): void {
  const src = labels.slice();
  const tally = new Map<number, number>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      if (src[p] < 0) continue;
      tally.clear();
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= size) continue;
          const v = src[yy * size + xx];
          if (v >= 0) tally.set(v, (tally.get(v) ?? 0) + 1);
        }
      }
      let best = src[p], bc = tally.get(best) ?? 0;
      for (const [v, c] of tally) if (c > bc) { best = v; bc = c; }
      labels[p] = best;
    }
  }
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

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

/** sRGB(0~255) → CIE Lab (D65) */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * 마스크 안 픽셀만 평균한 RGB → Lab + 마스크 피복(>=0.5 → inside).
 * 마스크 밖은 전경 평균색으로 채워 블러가 배경색을 끌어오지 않게 한다.
 */
function sampleLab(img: RgbaImage, mask: Mask, bbox: BBox, size: number) {
  const n = size * size;
  const lab = new Float32Array(n * 3);
  const inside = new Uint8Array(n);
  const known = new Uint8Array(n);
  const step = bbox.side / size;
  const k = Math.min(MAX_SUBSAMPLES, Math.max(1, Math.ceil(step)));
  const x0 = bbox.cx - bbox.side / 2;
  const y0 = bbox.cy - bbox.side / 2;
  const { width: w, height: h } = mask;
  const src = img.data;
  const total: Lab = [0, 0, 0];
  let totalN = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sr = 0, sg = 0, sb = 0, sumM = 0;
      for (let sy = 0; sy < k; sy++) {
        const y = Math.floor(y0 + (j + (sy + 0.5) / k) * step);
        if (y < 0 || y >= h) continue;
        for (let sx = 0; sx < k; sx++) {
          const x = Math.floor(x0 + (i + (sx + 0.5) / k) * step);
          if (x < 0 || x >= w) continue;
          const p = y * w + x;
          if (!mask.data[p]) continue;
          const q = p * 4;
          sr += src[q];
          sg += src[q + 1];
          sb += src[q + 2];
          sumM++;
        }
      }
      const o = j * size + i;
      if (sumM > 0) {
        const c = rgbToLab(sr / sumM, sg / sumM, sb / sumM);
        lab.set(c, o * 3);
        known[o] = 1;
        for (let t = 0; t < 3; t++) total[t] += c[t];
        totalN++;
      }
      if (sumM * 2 >= k * k) inside[o] = 1;
    }
  }
  if (totalN > 0) {
    const mean = total.map((v) => v / totalN);
    for (let o = 0; o < n; o++) if (!known[o]) lab.set(mean, o * 3);
  }
  return { lab, inside };
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
