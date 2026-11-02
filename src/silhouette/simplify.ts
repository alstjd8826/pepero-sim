import type { Vec2 } from '@/src/recipe/types';

function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len;
}

/** Douglas-Peucker (열린 폴리라인, 양 끝점 유지). */
export function simplifyDP(pts: Vec2[], epsilon: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 닫힌 다각형용 DP: 시작점과 가장 먼 점을 앵커로 두 구간을 따로 단순화. */
export function simplifyClosedDP(pts: Vec2[], epsilon: number): Vec2[] {
  if (pts.length <= 3) return pts.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplifyDP(pts.slice(0, far + 1), epsilon);
  const b = simplifyDP([...pts.slice(far), pts[0]], epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Chaikin 코너 컷 (닫힌 다각형). 반복마다 점 수 2배. */
export function chaikin(pts: Vec2[], iterations: number): Vec2[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next: Vec2[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}

/** bbox 중심을 (0,0), 최대 치수를 1로 맞추고 이미지 y↓ 를 y↑ 로 뒤집는다. */
export function normalizeSilhouette(pts: Vec2[]): Vec2[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const m = Math.max(maxX - minX, maxY - minY) || 1;
  return pts.map(([x, y]) => [(x - cx) / m, -(y - cy) / m] as Vec2);
}

function segCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** 닫힌 다각형의 비인접 변끼리 교차하는지 (O(n²), 최종 폴리곤 ≤400점 용). */
export function polygonSelfIntersects(pts: Vec2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** 부호 있는 면적 (shoelace). y↑ 공간에서 CCW 면 양수. */
export function polygonArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
