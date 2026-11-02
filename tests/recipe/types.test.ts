import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createRecipe, parseRecipe } from '@/src/recipe/types';
import { reliefKeyFor, resolveReliefUrl } from '@/src/recipe/relief';

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
    r.shape.relief = { heightmapUrl: 'reliefs/AbCd1234.png', strength: 0.5 };
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

describe('relief 높이맵 주소', () => {
  const withRelief = (heightmapUrl: string, strength = 0.6) => {
    const r = createRecipe({ outer: tri }, true);
    r.shape.relief = { heightmapUrl, strength };
    return JSON.parse(JSON.stringify(r));
  };
  it('reliefKeyFor 결과는 통과', () => {
    expect(parseRecipe(withRelief(reliefKeyFor('AbCd1234'))).shape.relief?.heightmapUrl).toBe(
      'reliefs/AbCd1234.png',
    );
  });
  it.each([
    'https://evil.example.com/x.png',
    'https://abc.supabase.co/storage/v1/object/public/reliefs/AbCd1234.png',
    '//evil.example.com/reliefs/AbCd1234.png',
    'reliefs/../thumbnails/AbCd1234.png',
    'reliefs/AbCd123.png',
    'thumbnails/AbCd1234.png',
    'blob:http://localhost/123',
    'reliefs/AbCd1234.png?x=1',
  ])('외부·다른 형식 주소는 거부: %s', (url) => {
    expect(issuePath(withRelief(url))).toEqual(['shape', 'relief', 'heightmapUrl']);
  });
  it('strength 는 0~1', () => {
    expect(issuePath(withRelief('reliefs/AbCd1234.png', 1.5))).toEqual(['shape', 'relief', 'strength']);
    expect(issuePath(withRelief('reliefs/AbCd1234.png', -0.1))).toEqual(['shape', 'relief', 'strength']);
  });
  it('resolveReliefUrl: 키 → 이 프로젝트 공개 URL, 그 밖은 null (blob 은 그대로)', () => {
    const base = 'https://proj.supabase.co/';
    expect(resolveReliefUrl('reliefs/AbCd1234.png', base)).toBe(
      'https://proj.supabase.co/storage/v1/object/public/reliefs/AbCd1234.png',
    );
    expect(resolveReliefUrl('https://evil.example.com/x.png', base)).toBeNull();
    expect(resolveReliefUrl('reliefs/AbCd1234.png', '')).toBeNull();
    expect(resolveReliefUrl('blob:http://localhost:3000/abc', base)).toBe('blob:http://localhost:3000/abc');
  });
});
