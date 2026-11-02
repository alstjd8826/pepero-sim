import { describe, expect, it } from 'vitest';
import { initialDip, liveCoating, stepDip, type DipState } from '@/src/dip/dipState';
import type { Coating } from '@/src/recipe/types';

const SURFACE = 0;

function makeSeed() {
  let n = 0;
  return () => ++n;
}

/** 모델 바닥 y 시퀀스를 이벤트로 흘려보낸다. */
function run(s: DipState, ys: number[], seed = makeSeed()): DipState {
  return ys.reduce((acc, y) => stepDip(acc, y, SURFACE, seed), s);
}

describe('stepDip', () => {
  it('한 번 담그면 가장 깊었던 곳까지 코팅 1개', () => {
    const s = run(initialDip([]), [1, -0.5, 1]);
    expect(s.committed).toHaveLength(1);
    expect(s.committed[0]).toEqual({
      type: 'milk-choco',
      plane: { normal: [0, -1, 0], offset: -0.5 },
      edgeSeed: 1,
    });
    expect(s.inChoco).toBe(false);
  });

  it('같은 깊이로 다시 담그면 추가되지 않는다', () => {
    const s = run(initialDip([]), [1, -0.5, 1, -0.5, 1]);
    expect(s.committed).toHaveLength(1);
  });

  it('얕게 다시 담그면 추가되지 않는다', () => {
    const s = run(initialDip([]), [1, -0.5, 1, -0.2, 1]);
    expect(s.committed).toHaveLength(1);
  });

  it('더 깊게 담그면 새 코팅이 추가된다', () => {
    const s = run(initialDip([]), [1, -0.5, 1, -1.2, 1]);
    expect(s.committed).toHaveLength(2);
    expect(s.committed[1].plane.offset).toBeCloseTo(-1.2);
  });

  it('이벤트 2개로 휙 지나가도 가장 깊은 지점까지 (Review Focus 4)', () => {
    const s = run(initialDip([]), [1, -2, 1]);
    expect(s.committed).toHaveLength(1);
    expect(s.committed[0].plane.offset).toBe(-2);
  });

  it('여러 이벤트에 걸쳐 내려갔다 올라오면 최대 깊이를 쓴다', () => {
    const s = run(initialDip([]), [1, -0.3, -0.9, -0.4, 0.5]);
    expect(s.committed).toHaveLength(1);
    expect(s.committed[0].plane.offset).toBeCloseTo(-0.9);
  });

  it('표면에 닿기만 하면(depth 0) 코팅 없음', () => {
    const s = run(initialDip([]), [1, 0, 1]);
    expect(s.committed).toHaveLength(0);
    expect(s.inChoco).toBe(false);
  });

  it('기존 코팅보다 얕으면 추가 안 함, 깊으면 추가', () => {
    const existing: Coating[] = [
      { type: 'milk-choco', plane: { normal: [0, -1, 0], offset: -1 }, edgeSeed: 7 },
    ];
    const shallow = run(initialDip(existing), [1, -0.8, 1]);
    expect(shallow.committed).toEqual(existing);
    const deep = run(initialDip(existing), [1, -1.5, 1]);
    expect(deep.committed).toHaveLength(2);
    expect(deep.committed[1].plane.offset).toBeCloseTo(-1.5);
  });

  it('입력 상태를 변경하지 않는다', () => {
    const s0 = initialDip([]);
    const s1 = stepDip(s0, -1, SURFACE, makeSeed());
    expect(s0).toEqual({ inChoco: false, currentDepth: 0, committed: [] });
    expect(s1.inChoco).toBe(true);
    expect(s1.currentDepth).toBe(1);
  });
});

describe('liveCoating', () => {
  it('담그는 중 기존 최대보다 깊으면 미리보기 코팅', () => {
    const s = run(initialDip([]), [1, -0.7]);
    const live = liveCoating(s);
    expect(live?.plane).toEqual({ normal: [0, -1, 0], offset: -0.7 });
  });

  it('밖에 있거나 기존보다 얕으면 null', () => {
    expect(liveCoating(initialDip([]))).toBeNull();
    const s = run(initialDip([]), [1, -1, 1, -0.5]);
    expect(s.inChoco).toBe(true);
    expect(liveCoating(s)).toBeNull();
  });
});
