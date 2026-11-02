import { describe, expect, it } from 'vitest';
import type { Coating } from '@/src/recipe/types';
import {
  DRIP_MAX,
  WAVE_AMP,
  dripCount,
  edgeOffset,
  isCoated,
  seedUnit,
} from '@/src/three/coatingMaterial';

/*
 * 부호 규약: 코팅 = y <= depth + edgeOffset(x, z, seed).
 *  - 물결: ±0.06
 *  - 흘러내림 줄기: 경계가 아래(-y, 담근 끝 쪽)로 끌려 내려감 → 음수. 줄기 총 길이 ≤ 0.35 중
 *    경계 처짐은 40%(≤ 0.14), 나머지는 셸 범프(판정 무관)
 *  → 전체 범위 [-0.35, 0.06] 안 (실제 [-0.2, 0.06])
 */

type Sample = [x: number, z: number, radial: boolean];

/** 단면 둘레를 두르는 샘플: 막대(반지름 0.18) 원(radial) + 납작한 쿠키(±1.8 × ±0.15) 테두리(평면) */
function samples(): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    out.push([0.18 * Math.cos(a), 0.18 * Math.sin(a), true]);
  }
  for (let i = 0; i <= 400; i++) {
    const x = -1.8 + (3.6 * i) / 400;
    out.push([x, 0.15, false], [x, -0.15, false]);
  }
  return out;
}

const SEEDS = [0, 1, 2, 7, 42, 123456, 2 ** 31, 4294967295, 0.5, -3];

describe('edgeOffset', () => {
  it('같은 seed → 같은 값', () => {
    for (const seed of SEEDS) {
      for (const [x, z, radial] of samples()) {
        expect(edgeOffset(x, z, seed, { radial })).toBe(edgeOffset(x, z, seed, { radial }));
      }
    }
  });

  it('다른 seed → 다른 값', () => {
    const profile = (seed: number) => samples().map(([x, z, radial]) => edgeOffset(x, z, seed, { radial }));
    const a = profile(1);
    const b = profile(2);
    const c = profile(4294967295);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(b).not.toEqual(c);
    expect(seedUnit(1)).not.toBe(seedUnit(2));
  });

  it('값 범위 [-0.35, 0.06] (물결 ±0.06, 줄기 ≤ 0.35)', () => {
    expect(WAVE_AMP).toBe(0.06);
    expect(DRIP_MAX).toBe(0.35);
    for (const seed of SEEDS) {
      let min = Infinity;
      let max = -Infinity;
      for (const [x, z, radial] of samples()) {
        const v = edgeOffset(x, z, seed, { radial });
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min).toBeGreaterThanOrEqual(-DRIP_MAX);
      expect(max).toBeLessThanOrEqual(WAVE_AMP);
      // 실제로 물결이 있고(일직선 아님), 줄기가 물결보다 깊게 내려온다
      expect(max - min).toBeGreaterThan(0.1);
      expect(min).toBeLessThan(-WAVE_AMP);
    }
  });

  it('흘러내림 진행도 0 이면 물결만 남는다 (±0.06)', () => {
    for (const seed of SEEDS) {
      for (const [x, z, radial] of samples()) {
        const v = edgeOffset(x, z, seed, { drip: 0, radial });
        expect(Math.abs(v)).toBeLessThanOrEqual(WAVE_AMP);
        // 진행도 1 은 0 보다 같거나 아래 (줄기는 경계를 내리기만 한다)
        expect(edgeOffset(x, z, seed, { drip: 1, radial })).toBeLessThanOrEqual(v + 1e-12);
      }
    }
  });

  it('줄기 개수는 seed 로 정해지는 4~7개', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const n = dripCount(seed);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(7);
      counts.add(n);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it('막대 둘레를 한 바퀴 돌면 끊김 없이 이어진다 (atan2 이음매)', () => {
    for (const seed of SEEDS) {
      const r = 0.18;
      const e = 1e-6;
      const above = edgeOffset(-r, e, seed, { radial: true });
      const below = edgeOffset(-r, -e, seed, { radial: true });
      expect(Math.abs(above - below)).toBeLessThan(1e-3);
    }
  });
});

describe('isCoated 는 경계 물결·줄기(진행도 1)를 포함한다', () => {
  const dip = (depth: number, edgeSeed: number): Coating => ({
    type: 'milk-choco',
    plane: { normal: [0, -1, 0], offset: -depth },
    edgeSeed,
  });

  it('경계 = depth + edgeOffset 와 정확히 일치 (막대 OFF → 평면 좌표)', () => {
    for (const seed of SEEDS) {
      for (const [x, z] of samples()) {
        const edge = 1.0 + edgeOffset(x, z, seed);
        expect(isCoated([x, edge, z], [dip(1.0, seed)])).toBe('milk-choco');
        expect(isCoated([x, edge + 1e-6, z], [dip(1.0, seed)])).toBeNull();
      }
    }
  });

  it('막대 ON: 막대 구간 레이어(depth < stickTop)는 radial, 그 위는 평면 좌표', () => {
    const stickTop = 3.8;
    for (const seed of SEEDS) {
      for (const [x, z] of samples().slice(0, 360)) {
        const low = 1.0 + edgeOffset(x, z, seed, { radial: true });
        expect(isCoated([x, low, z], [dip(1.0, seed)], stickTop)).toBe('milk-choco');
        expect(isCoated([x, low + 1e-6, z], [dip(1.0, seed)], stickTop)).toBeNull();
        const high = 4.2 + edgeOffset(x, z, seed);
        expect(isCoated([x, high, z], [dip(4.2, seed)], stickTop)).toBe('milk-choco');
        expect(isCoated([x, high + 1e-6, z], [dip(4.2, seed)], stickTop)).toBeNull();
      }
    }
  });
});
