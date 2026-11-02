import { describe, expect, it } from 'vitest';
import { createRecipe, parseRecipe } from '@/src/recipe/types';

const tri: [number, number][] = [[0, 0], [1, 0], [0.5, 1]];
const poly = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [Math.cos(i), Math.sin(i)]);

describe('parseRecipe', () => {
  it('createRecipe 결과를 그대로 통과시킨다', () => {
    const r = createRecipe({ outer: tri }, true);
    expect(parseRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(r.base.kind).toBe('stick');
    expect(r.shape.thickness).toBe(0.3);
  });
  it('outer 2점이면 throw', () => {
    expect(() => parseRecipe(createRecipe({ outer: poly(2) }, true))).toThrow();
  });
  it('outer 401점이면 throw', () => {
    expect(() => parseRecipe(createRecipe({ outer: poly(401) }, true))).toThrow();
  });
  it('schemaVersion 2면 throw', () => {
    const r = { ...createRecipe({ outer: tri }, true), schemaVersion: 2 };
    expect(() => parseRecipe(r)).toThrow();
  });
});
