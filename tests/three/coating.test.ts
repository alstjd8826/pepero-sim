import { describe, expect, it } from 'vitest';
import type { Coating } from '@/src/recipe/types';
import {
  MAX_COATING_LAYERS,
  createCookieMaterial,
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

  it('경계(y == depth)는 코팅 (>= 규칙)', () => {
    expect(isCoated([0, 1.0, 0], [dip(1.0)])).toBe('milk-choco');
  });

  it('여러 레이어 중 하나라도 덮으면 코팅', () => {
    expect(isCoated([0, 1.8, 0], [dip(2.0), dip(0.5)])).toBe('milk-choco');
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
    m.dispose();
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
