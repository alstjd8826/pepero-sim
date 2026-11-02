import { describe, expect, it } from 'vitest';
import { maskToSilhouette, traceOuterContour } from '@/src/silhouette/contour';
import { MAX_OUTER_POINTS, type Vec2 } from '@/src/recipe/types';
import { makeMask } from './helpers';

function bbox(pts: Vec2[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function selfIntersects(pts: Vec2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
const area = (p: Vec2[]) => p.reduce((s, a, i) => s + (a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1]), 0) / 2;

describe('contour', () => {
  it('traceOuterContour of 20x10 rect has 2:1 bbox', () => {
    const m = makeMask(40, 30, (x, y) => x >= 5 && x < 25 && y >= 5 && y < 15);
    const { w, h } = bbox(traceOuterContour(m));
    expect(Math.abs(w - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(h - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(w / h - 2)).toBeLessThan(0.2);
  });

  it('maskToSilhouette removes 1px filament from a circle', () => {
    const m = makeMask(200, 200, (x, y) => (x - 100) ** 2 + (y - 100) ** 2 <= 40 * 40 || (y === 100 && x >= 140 && x < 190));
    const s = maskToSilhouette(m);
    expect(s).not.toBeNull();
    const { w, h } = bbox(s!.outer);
    expect(Math.abs(w / h - 1)).toBeLessThan(0.05);
    expect(s!.outer.length).toBeLessThanOrEqual(MAX_OUTER_POINTS);
    expect(selfIntersects(s!.outer)).toBe(false);
    expect(area(s!.outer)).toBeGreaterThan(0); // CCW in y-up
  });

  it('maskToSilhouette returns null for a tiny blob', () => {
    const m = makeMask(100, 100, (x, y) => x >= 10 && x < 12 && y >= 10 && y < 12);
    expect(maskToSilhouette(m)).toBeNull();
  });

  it('caps points at 400 for a very wiggly shape', () => {
    const m = makeMask(400, 400, (x, y) => {
      const dx = x - 200, dy = y - 200;
      const r = 150 + 25 * Math.sin(Math.atan2(dy, dx) * 40);
      return Math.hypot(dx, dy) <= r;
    });
    const s = maskToSilhouette(m);
    expect(s).not.toBeNull();
    expect(s!.outer.length).toBeLessThanOrEqual(MAX_OUTER_POINTS);
  });
});
