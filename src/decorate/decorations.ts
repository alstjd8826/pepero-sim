import {
  MAX_STROKES,
  MAX_TOTAL_STROKE_POINTS,
  type Stroke,
  type Topping,
  type ToppingType,
  type Vec3,
} from '@/src/recipe/types';

/** 꾸미기 작업 하나 (되돌리기 단위): 초코펜 한 획, 또는 한 번 누를 때 뿌린 토핑 묶음 */
export type DecoAction = { kind: 'stroke'; stroke: Stroke } | { kind: 'toppings'; items: Topping[] };

export function flattenActions(actions: DecoAction[]): { strokes: Stroke[]; toppings: Topping[] } {
  const strokes: Stroke[] = [];
  const toppings: Topping[] = [];
  for (const a of actions) {
    if (a.kind === 'stroke') strokes.push(a.stroke);
    else toppings.push(...a.items);
  }
  return { strokes, toppings };
}

export function remainingStrokePoints(actions: DecoAction[]): number {
  let used = 0;
  for (const a of actions) if (a.kind === 'stroke') used += a.stroke.points.length;
  return MAX_TOTAL_STROKE_POINTS - used;
}

/** 새 획을 시작할 수 있는가: 획 개수 한도 안이고 점이 2개 이상 남아야 한다 */
export function canStartStroke(actions: DecoAction[]): boolean {
  const strokes = actions.reduce((n, a) => n + (a.kind === 'stroke' ? 1 : 0), 0);
  return strokes < MAX_STROKES && remainingStrokePoints(actions) >= 2;
}

/** 저장 크기를 줄이려고 좌표를 소수 셋째 자리(0.001 = 쿠키 폭의 약 1/2000)로 자른다 */
export function roundVec(v: Vec3): Vec3 {
  const r = (x: number) => Math.round(x * 1000) / 1000 || 0;
  return [r(v[0]), r(v[1]), r(v[2])];
}

/** 펜 점은 마지막 점에서 minDist 이상 움직였을 때만 찍는다 */
export function shouldAddPoint(last: Vec3 | undefined, p: Vec3, minDist: number): boolean {
  if (!last) return true;
  return Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) >= minDist;
}

/** 토핑 종류별로 한 번 누를 때 뿌리는 개수와 흩뿌림 반경(모델 단위), 끌 때 다음 뿌리기까지 간격 */
export const SCATTER: Record<ToppingType, { count: number; radius: number; spacing: number }> = {
  almond: { count: 1, radius: 0, spacing: 0.3 },
  crunch: { count: 4, radius: 0.13, spacing: 0.18 },
  sprinkle: { count: 5, radius: 0.13, spacing: 0.13 },
  star: { count: 1, radius: 0, spacing: 0.22 },
  pearl: { count: 3, radius: 0.11, spacing: 0.16 },
  heart: { count: 1, radius: 0, spacing: 0.26 },
};

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 법선에 수직인 두 단위 벡터 */
export function tangentBasis(normal: Vec3): [Vec3, Vec3] {
  const n = normalize(normal);
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = normalize(cross(helper, n));
  return [t, cross(n, t)];
}

/**
 * 표면 점 center 주변 접평면 위에 토핑을 흩뿌린다. 개수는 종류별 SCATTER.count, budget 을 넘지 않는다.
 * 위치는 접평면 위라 곡면에서는 표면에서 아주 조금 떠 있을 수 있다(반경이 작아 눈에 띄지 않음).
 */
export function scatterToppings(
  type: ToppingType,
  center: Vec3,
  normal: Vec3,
  rand: () => number,
  budget: number,
): Topping[] {
  const { count, radius } = SCATTER[type];
  const n = roundVec(normalize(normal));
  const [t, b] = tangentBasis(normal);
  const out: Topping[] = [];
  for (let i = 0; i < Math.min(count, budget); i++) {
    // 원판 안에 고르게: r = R·√u
    const r = count === 1 ? 0 : radius * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    const p: Vec3 = [
      center[0] + t[0] * dx + b[0] * dy,
      center[1] + t[1] * dx + b[1] * dy,
      center[2] + t[2] * dx + b[2] * dy,
    ];
    const spin = Math.min(Math.round(rand() * Math.PI * 2 * 1000) / 1000, 6.283);
    out.push({ type, position: roundVec(p), normal: n, spin });
  }
  return out;
}
