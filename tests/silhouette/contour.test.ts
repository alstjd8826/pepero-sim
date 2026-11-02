import { describe, expect, it } from 'vitest';
import { maskToSilhouette, traceOuterContour } from '@/src/silhouette/contour';
import { MAX_OUTER_POINTS, type Vec2 } from '@/src/recipe/types';
import { polygonArea, polygonSelfIntersects } from '@/src/silhouette/simplify';
import { makeMask } from './helpers';

function bbox(pts: Vec2[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

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
    expect(polygonSelfIntersects(s!.outer)).toBe(false);
    expect(polygonArea(s!.outer)).toBeGreaterThan(0); // CCW in y-up
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
    expect(polygonSelfIntersects(s!.outer)).toBe(false);
    expect(polygonArea(s!.outer)).toBeGreaterThan(0);
  });

  it('ignores separated text/effect blobs next to a character', () => {
    const rects = [[10, 150], [30, 150], [50, 150]];
    const m = makeMask(200, 200, (x, y) =>
      (x - 120) ** 2 + (y - 80) ** 2 <= 40 * 40 || rects.some(([rx, ry]) => x >= rx && x < rx + 8 && y >= ry && y < ry + 4));
    const s = maskToSilhouette(m);
    expect(s).not.toBeNull();
    const { w, h } = bbox(s!.outer);
    expect(Math.abs(w / h - 1)).toBeLessThan(0.05);
    expect(s!.outer.length).toBeLessThanOrEqual(MAX_OUTER_POINTS);
    expect(polygonSelfIntersects(s!.outer)).toBe(false);
    expect(polygonArea(s!.outer)).toBeGreaterThan(0);
  });

  it('polygonSelfIntersects detects a bowtie', () => {
    expect(polygonSelfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
    expect(polygonSelfIntersects([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });
});
