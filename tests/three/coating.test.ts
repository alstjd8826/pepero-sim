import { describe, expect, it } from 'vitest';
import type { Coating } from '@/src/recipe/types';
import {
  MAX_COATING_LAYERS,
  createCookieMaterial,
  edgeOffset,
  isCoated,
  packCoatingUniforms,
} from '@/src/three/coatingMaterial';

const dip = (depth: number, edgeSeed = 0): Coating => ({
  type: 'milk-choco',
  plane: { normal: [0, -1, 0], offset: -depth },
  edgeSeed,
});

describe('isCoated', () => {
  it('depth 1.0 평면 하나: y=0.5 는 코팅, y=1.5 는 아님', () => {
    expect(isCoated([0, 0.5, 0], [dip(1.0)])).toBe('milk-choco');
    expect(isCoated([0, 1.5, 0], [dip(1.0)])).toBeNull();
  });

  it('레이어 0개면 null', () => {
    expect(isCoated([0, 0.5, 0], [])).toBeNull();
  });

  it('경계(y == depth + edgeOffset)는 코팅 (>= 규칙)', () => {
    // 경계는 물결·흘러내림만큼 depth 에서 [-0.35, 0.06] 벗어난다 (edgeOffset, 진행도 1)
    const edge = 1.0 + edgeOffset(0, 0, 0);
    expect(isCoated([0, edge, 0], [dip(1.0)])).toBe('milk-choco');
    expect(isCoated([0, edge + 1e-6, 0], [dip(1.0)])).toBeNull();
  });

  it('여러 레이어 중 하나라도 덮으면 코팅', () => {
    // 경계 보정 범위 [-0.35, 0.06] 밖으로 떨어진 점만 쓴다 (2.0 - 0.35 = 1.65)
    expect(isCoated([0, 1.6, 0], [dip(2.0), dip(0.5)])).toBe('milk-choco');
    expect(isCoated([0, 2.5, 0], [dip(2.0), dip(0.5)])).toBeNull();
  });

  it('뒤 레이어가 우선한다', () => {
    // v1 타입이 하나뿐이라, 뒤 레이어에 가짜 타입을 넣어 어느 레이어가 이겼는지 본다
    const later = 'later' as unknown as Coating['type'];
    const coatings: Coating[] = [dip(2.0), { ...dip(1.0), type: later }];
    expect(isCoated([0, 0.5, 0], coatings)).toBe(later); // 둘 다 덮음 → 뒤 레이어
    expect(isCoated([0, 1.5, 0], coatings)).toBe('milk-choco'); // 앞 레이어만 덮음
  });

  it('비스듬한 평면도 dot(n,p) >= offset 규칙을 따른다', () => {
    const tilted: Coating = {
      type: 'milk-choco',
      plane: { normal: [Math.SQRT1_2, -Math.SQRT1_2, 0], offset: -1 },
      edgeSeed: 0,
    };
    // dot = (x - y)/√2
    expect(isCoated([1, 1, 0], [tilted])).toBe('milk-choco'); // 0 >= -1
    expect(isCoated([0, 2, 0], [tilted])).toBeNull(); // -1.414 < -1
  });
});

describe('packCoatingUniforms', () => {
  it('고정 길이 16 배열에 평면·색·개수를 채운다', () => {
    const { planes, colors, count } = packCoatingUniforms([dip(2.0)]);
    expect(MAX_COATING_LAYERS).toBe(16);
    expect(planes).toHaveLength(16);
    expect(colors).toHaveLength(16);
    expect(count).toBe(1);
    expect(planes[0].toArray()).toEqual([0, -1, 0, -2]);
    expect(colors[0].getHexString()).toBe('4a2716');
  });

  it('edgeSeed 는 float32 에 정확히 들어가는 [0,1) 값으로 줄여 넣는다', async () => {
    const { seedUnit } = await import('@/src/three/coatingMaterial');
    const { edges } = packCoatingUniforms([dip(2.0, 4294967295), dip(4.5, 7)], undefined, 3.8);
    expect(edges).toHaveLength(16);
    expect(edges[0].x).toBe(seedUnit(4294967295));
    expect(Math.fround(edges[0].x)).toBe(edges[0].x);
    expect(edges[0].x).toBeGreaterThanOrEqual(0);
    expect(edges[0].x).toBeLessThan(1);
    // 막대 구간(depth 2.0 < 3.8)은 radial, 쿠키 구간(4.5)은 평면
    expect(edges[0].y).toBe(1);
    expect(edges[1].y).toBe(0);
  });

  it('16개 초과면 마지막 16개(최신)만 쓴다', () => {
    const many = Array.from({ length: 20 }, (_, i) => dip(i + 1));
    const { planes, count } = packCoatingUniforms(many);
    expect(count).toBe(16);
    expect(planes[0].w).toBe(-5); // 20개 중 5번째(인덱스 4) 부터
    expect(planes[15].w).toBe(-20);
  });

  it('기존 배열을 넘기면 그 객체를 제자리에서 갱신한다', () => {
    const first = packCoatingUniforms([dip(2.0)]);
    const again = packCoatingUniforms([dip(1.0)], first);
    expect(again.planes).toBe(first.planes);
    expect(again.planes[0]).toBe(first.planes[0]);
    expect(again.planes[0].w).toBe(-1);
  });
});

describe('createCookieMaterial', () => {
  it('uniform 객체를 userData 에 안정적으로 보관한다', () => {
    const m = createCookieMaterial();
    const u = m.userData.coatingUniforms;
    expect(u.uPlanes.value).toHaveLength(16);
    expect(u.uColors.value).toHaveLength(16);
    expect(u.uCount.value).toBe(0);
    expect(u.uDripProgress.value).toBe(1);
    m.dispose();
  });

  it('초코 셸은 베이스와 같은 uniform 객체를 공유한다 (setCoatings 한 번으로 둘 다 반영)', async () => {
    const { createChocoShellMaterial, setCoatings, setDripProgress } = await import(
      '@/src/three/coatingMaterial'
    );
    const base = createCookieMaterial();
    const shell = createChocoShellMaterial(base);
    expect(shell.userData.coatingUniforms).toBe(base.userData.coatingUniforms);
    setCoatings(base, [dip(1.0)]);
    setDripProgress(base, 0.25);
    expect(shell.userData.coatingUniforms.uCount.value).toBe(1);
    expect(shell.userData.coatingUniforms.uDripProgress.value).toBe(0.25);
    expect(shell.roughness).toBe(0.35);
    base.dispose();
    shell.dispose();
  });
});

describe('createCoatedMaterial', () => {
  it('생성 직후부터 코팅 uniform 이 채워져 있다 (첫 프레임 무코팅 방지)', async () => {
    const { createCoatedMaterial } = await import('@/src/three/coatingMaterial');
    const m = createCoatedMaterial([dip(1.0), dip(2.0)]);
    const u = m.userData.coatingUniforms as { uCount: { value: number } };
    expect(u.uCount.value).toBe(2);
  });
});
