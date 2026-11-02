import { describe, expect, it } from 'vitest';
import { chaikin, normalizeSilhouette, simplifyDP } from '@/src/silhouette/simplify';
import type { Vec2 } from '@/src/recipe/types';

describe('simplify', () => {
  it('simplifyDP reduces collinear points to 2', () => {
    const pts: Vec2[] = Array.from({ length: 100 }, (_, i) => [i, 2 * i]);
    expect(simplifyDP(pts, 0.5)).toHaveLength(2);
  });

  it('simplifyDP keeps a significant corner', () => {
    expect(simplifyDP([[0, 0], [5, 5], [10, 0]], 1)).toHaveLength(3);
  });

  it('chaikin doubles point count per iteration', () => {
    const sq: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(chaikin(sq, 1)).toHaveLength(8);
    expect(chaikin(sq, 2)).toHaveLength(16);
  });

  it('normalizeSilhouette: max dim 1, centered, y flipped', () => {
    const pts: Vec2[] = [[10, 20], [50, 20], [50, 40], [10, 40]]; // image coords, y down
    const n = normalizeSilhouette(pts);
    const xs = n.map((p) => p[0]);
    const ys = n.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(w, h)).toBeCloseTo(1, 6);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0, 6);
    expect(n[0][1]).toBeGreaterThan(0); // top of image -> +y
    expect(n[2][1]).toBeLessThan(0);
  });
});
