import type { Coating } from '@/src/recipe/types';

/** 딥핑 진행 상태. 순수 데이터 — 포인터 이벤트마다 stepDip 으로 갱신한다. */
export type DipState = {
  /** 모델 끝이 초코 표면 아래에 있는지 */
  inChoco: boolean;
  /** 이번 담금에서 내려갔던 가장 깊은 깊이 (밖에 있으면 0) */
  currentDepth: number;
  /** 확정된 코팅 (기존 레시피 코팅 포함) */
  committed: Coating[];
};

export function initialDip(existing: Coating[]): DipState {
  return { inChoco: false, currentDepth: 0, committed: existing };
}

function coatingAt(depth: number, edgeSeed: number): Coating {
  return { type: 'milk-choco', plane: { normal: [0, -1, 0], offset: -depth }, edgeSeed };
}

/** 확정된 코팅 중 가장 깊은 깊이. 코팅 평면은 p.y <= -offset 이므로 깊이 = -offset. */
export function maxCommittedDepth(committed: Coating[]): number {
  let max = 0;
  for (const c of committed) max = Math.max(max, -c.plane.offset);
  return max;
}

/**
 * 포인터 이벤트 하나 반영. depth = surfaceY - modelBottomY.
 * 프레임이 아니라 이벤트 단위로 호출되므로, 이벤트 사이가 멀어도(휙 지나감) 각 이벤트의 깊이만 보면 된다.
 */
export function stepDip(
  s: DipState,
  modelBottomY: number,
  surfaceY: number,
  seed: () => number,
): DipState {
  const depth = surfaceY - modelBottomY;
  if (depth > 0) {
    return { ...s, inChoco: true, currentDepth: Math.max(s.inChoco ? s.currentDepth : 0, depth) };
  }
  if (!s.inChoco) return s;
  // 빠져나오는 순간
  const committed =
    s.currentDepth > maxCommittedDepth(s.committed)
      ? [...s.committed, coatingAt(s.currentDepth, seed())]
      : s.committed;
  return { inChoco: false, currentDepth: 0, committed };
}

/** 담그는 중 미리보기용 코팅. 기존 최대보다 깊이 들어가 있을 때만 의미가 있다. */
export function liveCoating(s: DipState): Coating | null {
  if (!s.inChoco || s.currentDepth <= maxCommittedDepth(s.committed)) return null;
  return coatingAt(s.currentDepth, 0);
}
