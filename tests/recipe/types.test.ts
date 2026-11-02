import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createRecipe, parseRecipe } from '@/src/recipe/types';

const tri: [number, number][] = [[0, 0], [1, 0], [0.5, 1]];
const poly = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [Math.cos(i), Math.sin(i)]);
const coating = { type: 'milk-choco', plane: { normal: [0, -1, 0], offset: -1 }, edgeSeed: 42 };

function issuePath(input: unknown): string[] {
  try {
    parseRecipe(input);
  } catch (e) {
    expect(e).toBeInstanceOf(ZodError);
    return (e as ZodError).issues[0].path.map(String);
  }
  throw new Error('parseRecipe did not throw');
}

describe('parseRecipe', () => {
  it('createRecipe 결과를 그대로 통과시킨다', () => {
    const r = createRecipe({ outer: tri }, true);
    expect(parseRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(r.base.kind).toBe('stick');
    expect(r.shape.thickness).toBe(0.3);
  });
  it('코팅·relief·holes 가 채워진 레시피도 round-trip', () => {
    const r = {
      ...createRecipe({ outer: tri, holes: [tri] }, false),
      coatings: [coating],
    };
    r.shape.relief = { heightmapUrl: 'https://x/h.png', strength: 0.5 };
    expect(parseRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it('outer 2점이면 outer 경로로 throw', () => {
    expect(issuePath(createRecipe({ outer: poly(2) }, true))).toContain('outer');
  });
  it('outer 401점이면 outer 경로로 throw', () => {
    expect(issuePath(createRecipe({ outer: poly(401) }, true))).toContain('outer');
  });
  it('hole 2점이면 holes 경로로 throw', () => {
    expect(issuePath(createRecipe({ outer: tri, holes: [poly(2)] }, true))).toContain('holes');
  });
  it('schemaVersion 2면 throw', () => {
    const r = { ...createRecipe({ outer: tri }, true), schemaVersion: 2 };
    expect(issuePath(r)).toEqual(['schemaVersion']);
  });
  it('코팅 51개면 coatings 경로로 throw', () => {
    const r = { ...createRecipe({ outer: tri }, true), coatings: Array(51).fill(coating) };
    expect(issuePath(r)).toEqual(['coatings']);
  });
  it('알 수 없는 base.kind 면 throw', () => {
    const r = createRecipe({ outer: tri }, true) as unknown as { base: { kind: string } };
    r.base.kind = 'double-stick';
    expect(issuePath(r)).toEqual(['base', 'kind']);
  });
  it('toppings 가 비어있지 않으면 throw', () => {
    const r = { ...createRecipe({ outer: tri }, true), toppings: [{ type: 'x' }] };
    expect(issuePath(r)).toContain('toppings');
  });
});
