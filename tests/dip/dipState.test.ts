import { describe, expect, it } from 'vitest';
import { finishDip, initialDip, liveCoating, stepDip, type DipState } from '@/src/dip/dipState';
import { MAX_COATINGS, type Coating, type CoatingType } from '@/src/recipe/types';

const SURFACE = 0;

function makeSeed() {
  let n = 0;
  return () => ++n;
}

/** 모델 바닥 y 시퀀스를 이벤트로 흘려보낸다. */
function run(s: DipState, ys: number[], seed = makeSeed(), type: CoatingType = 'milk-choco'): DipState {
  return ys.reduce((acc, y) => stepDip(acc, y, SURFACE, seed, type), s);
}

const layer = (depth: number, type: CoatingType, edgeSeed = 9): Coating => ({
  type,
  plane: { normal: [0, -1, 0], offset: -depth },
  edgeSeed,
});

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
    expect(s0).toEqual({ inChoco: false, currentDepth: 0, committed: [], pendingSeed: null, pendingType: null });
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

  it('미리보기와 확정 코팅의 edgeSeed 가 같다 (뺄 때 경계가 바뀌지 않음)', () => {
    const seed = makeSeed();
    const dipping = run(initialDip([]), [1, -0.3, -0.7], seed);
    const live = liveCoating(dipping);
    const done = stepDip(dipping, 1, SURFACE, seed);
    expect(live?.edgeSeed).toBe(1);
    expect(done.committed[0].edgeSeed).toBe(live?.edgeSeed);
  });

  it('밖에 있거나 기존보다 얕으면 null', () => {
    expect(liveCoating(initialDip([]))).toBeNull();
    const s = run(initialDip([]), [1, -1, 1, -0.5]);
    expect(s.inChoco).toBe(true);
    expect(liveCoating(s)).toBeNull();
  });
});

describe('finishDip (잠긴 채 놓기)', () => {
  it('기존보다 깊게 잠긴 상태면 확정하고 밖 상태로', () => {
    const seed = makeSeed();
    const s = finishDip(run(initialDip([]), [1, -0.8], seed), seed);
    expect(s.inChoco).toBe(false);
    expect(s.currentDepth).toBe(0);
    expect(s.pendingSeed).toBeNull();
    expect(s.committed).toHaveLength(1);
    expect(s.committed[0].plane.offset).toBeCloseTo(-0.8);
    expect(s.committed[0].edgeSeed).toBe(1);
  });

  it('기존보다 얕게 잠긴 상태면 새 층 없이 밖 상태로', () => {
    const s0 = run(initialDip([]), [1, -1, 1, -0.4]);
    const s = finishDip(s0, makeSeed());
    expect(s.inChoco).toBe(false);
    expect(s.committed).toBe(s0.committed);
    expect(s.committed).toHaveLength(1);
  });

  it('초코 밖이면 그대로', () => {
    const s0 = run(initialDip([]), [1, -1, 1]);
    expect(finishDip(s0, makeSeed())).toBe(s0);
  });
});

describe('초코 색', () => {
  it('고른 색으로 코팅된다', () => {
    const s = run(initialDip([]), [1, -0.5, 1], makeSeed(), 'white-choco');
    expect(s.committed[0].type).toBe('white-choco');
  });

  it('같은 깊이라도 다른 색으로 다시 담그면 새 층이 생긴다', () => {
    const seed = makeSeed();
    const s1 = run(initialDip([]), [1, -0.5, 1], seed, 'dark-choco');
    const s2 = run(s1, [1, -0.5, 1], seed, 'strawberry');
    expect(s2.committed.map((c) => c.type)).toEqual(['dark-choco', 'strawberry']);
  });

  it('얕게 다른 색으로 담그면 끝만 덮는 층이 생긴다', () => {
    const s = run(initialDip([layer(1, 'dark-choco')]), [1, -0.3, 1], makeSeed(), 'white-choco');
    expect(s.committed).toHaveLength(2);
    expect(s.committed[1].plane.offset).toBeCloseTo(-0.3);
  });

  it('이미 그 색으로 보이는 구간보다 얕게 같은 색이면 추가 안 함', () => {
    const base = [layer(1, 'dark-choco'), layer(0.5, 'white-choco')];
    const s = run(initialDip(base), [1, -0.4, 1], makeSeed(), 'white-choco');
    expect(s.committed).toBe(base);
  });

  it('같은 색이라도 그 색 구간을 넘어 다른 색 위까지 담그면 추가', () => {
    const base = [layer(1, 'dark-choco'), layer(0.5, 'white-choco')];
    const s = run(initialDip(base), [1, -0.8, 1], makeSeed(), 'white-choco');
    expect(s.committed).toHaveLength(3);
  });

  it('담그는 중에 색을 바꿔도 이번 담금은 들어갈 때 색', () => {
    const seed = makeSeed();
    let s = stepDip(initialDip([]), -0.2, SURFACE, seed, 'matcha');
    s = stepDip(s, -0.6, SURFACE, seed, 'blueberry');
    expect(liveCoating(s)?.type).toBe('matcha');
    s = stepDip(s, 1, SURFACE, seed, 'blueberry');
    expect(s.committed[0].type).toBe('matcha');
  });

  it('기존보다 얕아도 다른 색이면 미리보기가 보인다', () => {
    const s = run(initialDip([layer(1, 'milk-choco')]), [1, -0.4], makeSeed(), 'white-choco');
    expect(liveCoating(s)?.type).toBe('white-choco');
  });

  it(`코팅은 최대 ${MAX_COATINGS}층`, () => {
    const full = Array.from({ length: MAX_COATINGS }, (_, i) => layer(0.1 + i * 0.01, 'milk-choco'));
    const s = run(initialDip(full), [1, -5, 1], makeSeed(), 'dark-choco');
    expect(s.committed).toBe(full);
    expect(liveCoating(run(initialDip(full), [1, -5], makeSeed(), 'dark-choco'))).toBeNull();
  });
});
