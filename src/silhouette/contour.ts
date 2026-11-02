import { MAX_OUTER_POINTS, type Silhouette, type Vec2 } from '@/src/recipe/types';
import { largestComponent, morphClose, morphOpen, type Mask } from './raster';
import { chaikin, normalizeSilhouette, polygonArea, polygonSelfIntersects, simplifyClosedDP } from './simplify';

// 방향: 0=오른쪽(+x) 1=아래(+y) 2=왼쪽 3=위 (이미지 좌표, y↓)
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * 가장 위-왼쪽 전경 픽셀에서 시작해 픽셀 모서리(crack)를 따라 바깥 윤곽을 추적한다
 * (4-연결 전경, marching squares 의 이진 경계와 동일한 격자 경로).
 * 이미지 좌표(y↓) 기준 시각적으로 시계 반대방향 순서의 모서리 꼭짓점을 반환한다.
 * (y 를 뒤집는 normalizeSilhouette 이후 y↑ 공간에서 CCW 가 된다.)
 */
export function traceOuterContour(mask: Mask): Vec2[] {
  const { width: w, height: h, data } = mask;
  const f = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i]) { sx = i % w; sy = Math.floor(i / w); break; }
  }
  if (sx < 0) return [];

  // 전경을 진행 방향 오른쪽에 두고 도는 시계 방향 추적 후 마지막에 뒤집는다.
  const out: Vec2[] = [];
  let x = sx;
  let y = sy;
  let d = 3; // 시작 모서리로 위로 들어오는 중
  do {
    let right: number;
    let left: number;
    switch (d) {
      case 0: right = f(x, y); left = f(x, y - 1); break;
      case 1: right = f(x - 1, y); left = f(x, y); break;
      case 2: right = f(x - 1, y - 1); left = f(x - 1, y); break;
      default: right = f(x, y - 1); left = f(x - 1, y - 1); break;
    }
    let nd = d;
    if (!right) nd = (d + 1) % 4; // 우회전
    else if (left) nd = (d + 3) % 4; // 좌회전
    if (nd !== d) out.push([x, y]);
    d = nd;
    x += DX[d];
    y += DY[d];
  } while (!(x === sx && y === sy && d === 3));
  return out.reverse();
}

/** 실루엣·각인이 공유하는 정리된 마스크: open(2) → close(3) → 최대 덩어리. */
export function cleanMask(mask: Mask): Mask {
  return largestComponent(morphClose(morphOpen(mask, 2), 3));
}

/** open(2) → close(3) → 최대 덩어리 → 추적 → DP → chaikin(2) → 정규화. */
export function maskToSilhouette(mask: Mask): Silhouette | null {
  return cleanedMaskToSilhouette(cleanMask(mask));
}

/** cleanMask 를 이미 거친 마스크 → 실루엣 (정리를 두 번 하지 않도록) */
export function cleanedMaskToSilhouette(cleaned: Mask): Silhouette | null {
  let area = 0;
  for (let i = 0; i < cleaned.data.length; i++) area += cleaned.data[i];
  if (area === 0 || area / (cleaned.width * cleaned.height) < 0.01) return null;

  const contour = traceOuterContour(cleaned);
  const build = (eps: number, iters: number) => chaikin(simplifyClosedDP(contour, eps), iters);

  // 1) 점 수 상한: eps 를 6px 까지 올리고, 그래도 넘으면 chaikin 반복을 줄이고, 그 뒤에야 eps 를 더 올린다.
  const EPS_CEILING = 6;
  const plan: [number, number][] = [];
  for (let e = 1.5; e < EPS_CEILING; e *= 1.5) plan.push([e, 2]);
  plan.push([EPS_CEILING, 2], [EPS_CEILING, 1], [EPS_CEILING, 0]);
  for (let e = EPS_CEILING * 1.5, k = 0; k < 20; e *= 1.5, k++) plan.push([e, 0]);

  let chosen: [number, number] | null = null;
  for (const [e, it] of plan) {
    if (build(e, it).length <= MAX_OUTER_POINTS) { chosen = [e, it]; break; }
  }
  if (!chosen) return null;

  // 2) 위상: 자기교차하면 eps 를 절반씩(최소 0.75px) 줄여 재시도, 실패하면 null.
  let pts: Vec2[] | null = null;
  for (let e = chosen[0]; e >= 0.75; e /= 2) {
    const cand = build(e, chosen[1]);
    if (cand.length > MAX_OUTER_POINTS) continue;
    if (!polygonSelfIntersects(cand)) { pts = cand; break; }
  }
  if (!pts || pts.length < 3) return null;

  // 3) 퇴화 방지: 면적이 bbox 의 1% 미만이면 null.
  const norm = normalizeSilhouette(pts);
  const xs = norm.map((p) => p[0]);
  const ys = norm.map((p) => p[1]);
  const bboxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  if (bboxArea === 0 || Math.abs(polygonArea(norm)) < 0.01 * bboxArea) return null;
  return { outer: norm };
}
