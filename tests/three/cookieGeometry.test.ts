import { describe, it, expect } from 'vitest';
import { COATING_TYPES } from '@/src/recipe/types';
import { Box3 } from 'three';
import { buildCookieGeometry } from '@/src/three/cookieGeometry';
import { baseRegistry, coatingRegistry } from '@/src/three/registry';
import type { PeperoRecipe, Vec2 } from '@/src/recipe/types';

const square: Vec2[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];
const shape: PeperoRecipe['shape'] = { silhouette: { outer: square }, thickness: 0.3 };

function bbox(kind: 'stick' | 'none') {
  const g = buildCookieGeometry(shape, kind);
  g.computeBoundingBox();
  return g.boundingBox as Box3;
}

describe('buildCookieGeometry', () => {
  it('stick: 막대 포함 치수', () => {
    const b = bbox('stick');
    expect(Math.abs(b.min.y)).toBeLessThan(0.01);
    expect(b.max.y).toBeCloseTo(3.8 + 2.0 + 0.06, 1);
    expect(b.max.x - b.min.x).toBeCloseTo(2.0 + 0.12, 1);
  });
  it('none: 최저점 0, 높이 3.6', () => {
    const b = bbox('none');
    expect(Math.abs(b.min.y)).toBeLessThan(0.07);
    expect(b.max.y - b.min.y).toBeCloseTo(3.6, 0);
    expect(Math.abs(b.max.y - b.min.y - 3.6)).toBeLessThan(0.15);
  });
  it('결정성', () => {
    const a = buildCookieGeometry(shape, 'stick').getAttribute('position').array;
    const b = buildCookieGeometry(shape, 'stick').getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('registry', () => {
  it('값', () => {
    expect(baseRegistry.stick.silhouetteSize).toBe(2.0);
    expect(baseRegistry.stick.silhouetteBottomY).toBe(3.8);
    expect(baseRegistry.none.buildExtras()).toBeNull();
    for (const t of COATING_TYPES) expect(coatingRegistry[t].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(coatingRegistry['milk-choco']).toMatchObject({ color: '#4a2716', roughness: 0.35 });
    expect(baseRegistry.stick.buildExtras()).not.toBe(baseRegistry.stick.buildExtras());
  });
});
