import { MAX_COATINGS, type Coating, type CoatingType } from '@/src/recipe/types';

/** 딥핑 진행 상태. 순수 데이터 — 포인터 이벤트마다 stepDip 으로 갱신한다. */
export type DipState = {
  /** 모델 끝이 초코 표면 아래에 있는지 */
  inChoco: boolean;
  /** 이번 담금에서 내려갔던 가장 깊은 깊이 (밖에 있으면 0) */
  currentDepth: number;
  /** 확정된 코팅 (기존 레시피 코팅 포함) */
  committed: Coating[];
  /** 이번 담금의 경계 시드. 들어가는 순간 뽑아 미리보기와 확정 코팅에 같이 쓴다 (밖이면 null). */
  pendingSeed: number | null;
  /** 이번 담금의 초코 색. 들어가는 순간 고정한다 (담그는 중에 색을 바꿔도 이번 담금은 그대로). 밖이면 null. */
  pendingType: CoatingType | null;
};

export function initialDip(existing: Coating[]): DipState {
  return { inChoco: false, currentDepth: 0, committed: existing, pendingSeed: null, pendingType: null };
}

function coatingAt(depth: number, edgeSeed: number, type: CoatingType): Coating {
  return { type, plane: { normal: [0, -1, 0], offset: -depth }, edgeSeed };
}

/**
 * (0, depth] 구간이 이미 전부 type 색으로 보이는가 (경계 물결은 무시하고 깊이로만 본다).
 * 나중 층이 위에 덮이므로 뒤에서부터 각 층이 새로 드러내는 구간의 색을 확인한다.
 */
export function alreadyShows(committed: Coating[], depth: number, type: CoatingType): boolean {
  let covered = 0;
  for (let i = committed.length - 1; i >= 0 && covered < depth; i--) {
    const d = -committed[i].plane.offset;
    if (d <= covered) continue;
    if (committed[i].type !== type) return false;
    covered = d;
  }
  return covered >= depth;
}

/** 이번 담금이 새 층으로 남을 만한가: 층 한도 안이고, 이미 같은 모습이 아니어야 한다 */
function addsLayer(s: DipState): boolean {
  return (
    s.committed.length < MAX_COATINGS &&
    s.currentDepth > 0 &&
    !alreadyShows(s.committed, s.currentDepth, s.pendingType ?? 'milk-choco')
  );
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
  type: CoatingType = 'milk-choco',
): DipState {
  const depth = surfaceY - modelBottomY;
  if (depth > 0) {
    if (!s.inChoco) return { ...s, inChoco: true, currentDepth: depth, pendingSeed: seed(), pendingType: type };
    return { ...s, currentDepth: Math.max(s.currentDepth, depth) };
  }
  // 빠져나오는 순간
  return finishDip(s, seed);
}

/**
 * 담금을 끝낸다 (표면 위로 빠져나옴, 또는 잠긴 채 포인터를 놓음).
 * 모습이 바뀌는 담금일 때만 새 코팅을 확정한다 (더 깊거나, 그 구간에 다른 색이 보이거나). 초코 밖이면 그대로 반환.
 */
export function finishDip(s: DipState, seed: () => number): DipState {
  if (!s.inChoco) return s;
  const committed = addsLayer(s)
    ? [...s.committed, coatingAt(s.currentDepth, s.pendingSeed ?? seed(), s.pendingType ?? 'milk-choco')]
    : s.committed;
  return { inChoco: false, currentDepth: 0, committed, pendingSeed: null, pendingType: null };
}

/** 담그는 중 미리보기용 코팅. 확정하면 새 층이 될 담금일 때만 의미가 있다. */
export function liveCoating(s: DipState): Coating | null {
  if (!s.inChoco || !addsLayer(s)) return null;
  return coatingAt(s.currentDepth, s.pendingSeed ?? 0, s.pendingType ?? 'milk-choco');
}
