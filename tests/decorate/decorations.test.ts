import { describe, expect, it } from 'vitest';
import {
  SCATTER,
  canStartStroke,
  flattenActions,
  remainingStrokePoints,
  roundVec,
  scatterToppings,
  shouldAddPoint,
  type DecoAction,
} from '@/src/decorate/decorations';
import {
  MAX_STROKES,
  MAX_TOPPINGS,
  MAX_TOTAL_STROKE_POINTS,
  TOPPING_TYPES,
  parseRecipe,
  createRecipe,
  type Stroke,
  type Topping,
  type Vec3,
} from '@/src/recipe/types';

const stroke = (n: number): Stroke => ({
  color: 'white',
  width: 'thin',
  points: Array.from({ length: n }, (_, i) => [i * 0.1, 0, 0] as Vec3),
});
const topping: Topping = { type: 'pearl', position: [0, 0, 0], normal: [0, 0, 1], spin: 0 };

function rng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe('flattenActions', () => {
  it('작업 순서대로 선과 토핑을 모은다', () => {
    const actions: DecoAction[] = [
      { kind: 'stroke', stroke: stroke(2) },
      { kind: 'toppings', items: [topping, topping] },
      { kind: 'stroke', stroke: stroke(3) },
    ];
    const { strokes, toppings } = flattenActions(actions);
    expect(strokes.map((s) => s.points.length)).toEqual([2, 3]);
    expect(toppings).toHaveLength(2);
  });
});

describe('한도', () => {
  it('남은 선 점 개수', () => {
    expect(remainingStrokePoints([{ kind: 'stroke', stroke: stroke(10) }])).toBe(MAX_TOTAL_STROKE_POINTS - 10);
  });
  it(`선은 최대 ${MAX_STROKES}개`, () => {
    const full = Array.from({ length: MAX_STROKES }, () => ({ kind: 'stroke', stroke: stroke(2) }) as DecoAction);
    expect(canStartStroke(full)).toBe(false);
    expect(canStartStroke(full.slice(1))).toBe(true);
  });
  it('점이 2개도 안 남으면 새 선 불가', () => {
    const big = stroke(MAX_TOTAL_STROKE_POINTS - 1);
    expect(canStartStroke([{ kind: 'stroke', stroke: big }])).toBe(false);
  });
});

describe('shouldAddPoint', () => {
  it('첫 점은 항상, 이후엔 일정 거리 이상일 때만', () => {
    expect(shouldAddPoint(undefined, [0, 0, 0], 0.05)).toBe(true);
    expect(shouldAddPoint([0, 0, 0], [0.03, 0, 0], 0.05)).toBe(false);
    expect(shouldAddPoint([0, 0, 0], [0.06, 0, 0], 0.05)).toBe(true);
  });
});

describe('roundVec', () => {
  it('소수 셋째 자리로 줄인다', () => {
    expect(roundVec([0.12345, -1.00049, 2])).toEqual([0.123, -1, 2]);
  });
});

describe('scatterToppings', () => {
  const n: Vec3 = [0, 0.6, 0.8];
  const c: Vec3 = [0.2, 4.5, 0.17];

  it.each(TOPPING_TYPES)('%s: 정해진 개수만큼, 접평면 위 반경 안에', (type) => {
    const items = scatterToppings(type, c, n, rng(), MAX_TOPPINGS);
    expect(items).toHaveLength(SCATTER[type].count);
    for (const t of items) {
      expect(t.type).toBe(type);
      const d = [t.position[0] - c[0], t.position[1] - c[1], t.position[2] - c[2]];
      expect(Math.hypot(...d)).toBeLessThanOrEqual(SCATTER[type].radius + 0.002);
      expect(Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2])).toBeLessThan(0.003);
      expect(t.spin).toBeGreaterThanOrEqual(0);
      expect(t.spin).toBeLessThan(Math.PI * 2);
    }
  });

  it('남은 한도까지만', () => {
    expect(scatterToppings('sprinkle', c, n, rng(), 2)).toHaveLength(2);
    expect(scatterToppings('sprinkle', c, n, rng(), 0)).toHaveLength(0);
  });

  it('결과는 저장 스키마를 통과한다', () => {
    const toppings = TOPPING_TYPES.flatMap((t) => scatterToppings(t, c, n, rng(), MAX_TOPPINGS));
    const r = { ...createRecipe({ outer: [[0, 0], [1, 0], [0.5, 1]] }, true), toppings };
    expect(parseRecipe(JSON.parse(JSON.stringify(r))).toppings).toEqual(toppings);
  });
});
