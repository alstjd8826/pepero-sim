'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Coating, PeperoRecipe } from '@/src/recipe/types';
import { buildCookieGeometry } from './cookieGeometry';
import { stickTopFor } from './registry';
import {
  createChocoShellMaterial,
  createCoatedMaterial,
  setCoatings,
  setDripProgress,
} from './coatingMaterial';

type Props = { recipe: PeperoRecipe; liveCoatings?: Coating[] };

const EMPTY: Coating[] = [];

/** 통에서 뺀 뒤 초코가 흘러내리다 굳는 시간 */
export const DRIP_DURATION = 1.5;

/** 레시피 하나를 그리는 단일 렌더 경로. 저장된 구버전 레시피도 열 수 있도록 schemaVersion 으로 분기한다. */
export function PeperoModel({ recipe, liveCoatings }: Props) {
  switch (recipe.schemaVersion) {
    case 1:
      return <PeperoModelV1 recipe={recipe} liveCoatings={liveCoatings ?? EMPTY} />;
    default: {
      const unknown: never = recipe.schemaVersion;
      throw new Error(`지원하지 않는 레시피 버전: ${String(unknown)}`);
    }
  }
}

const coatingKey = (c: Coating | undefined) => (c ? `${c.plane.offset}|${c.edgeSeed}` : '');

/** 흘러내림: 처음엔 빠르게, 끝에서 느려지며 굳는다 */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

function PeperoModelV1({ recipe, liveCoatings }: { recipe: PeperoRecipe; liveCoatings: Coating[] }) {
  const { shape } = recipe;
  const kind = recipe.base.kind;

  const geometry = useMemo(() => buildCookieGeometry(shape, kind), [shape, kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const coatings = recipe.coatings;
  const all = useMemo(
    () => (liveCoatings.length ? [...coatings, ...liveCoatings] : coatings),
    [coatings, liveCoatings],
  );
  const isLive = liveCoatings.length > 0;

  // 코팅을 머티리얼 생성 시점에 채워 첫 프레임부터 초코가 보이게 한다 (effect 는 이후 변경만 반영).
  // 처음부터 있던 코팅(저장된 레시피)은 흘러내림이 끝난 모습(1), 담그는 중이면 0.
  const stickTop = stickTopFor(kind);
  const [material] = useState(() =>
    createCoatedMaterial(all, { dripProgress: isLive ? 0 : 1, stickTop }),
  );
  const [shell] = useState(() => createChocoShellMaterial(material));
  useEffect(
    () => () => {
      material.dispose();
      shell.dispose();
    },
    [material, shell],
  );

  // 흘러내림 애니메이션: 가장 최근 코팅이 '잠겨 있던 미리보기 → 확정'으로 바뀌거나 새로 늘어났을 때만 0→1
  const drip = useRef({ key: coatingKey(all[all.length - 1]), live: isLive, count: all.length, t: -1 });
  useLayoutEffect(() => {
    // layout effect: 새 코팅과 진행도가 같은 프레임에 반영돼야 줄기가 한 프레임 튀지 않는다
    setCoatings(material, all, stickTop);
    const prev = drip.current;
    const key = coatingKey(all[all.length - 1]);
    if (isLive) {
      prev.t = -1;
      setDripProgress(material, 0);
    } else if ((prev.live && prev.key === key) || (key !== prev.key && all.length > prev.count)) {
      prev.t = 0;
      setDripProgress(material, 0);
    } else if (key !== prev.key) {
      prev.t = -1;
      setDripProgress(material, 1);
    }
    prev.key = key;
    prev.live = isLive;
    prev.count = all.length;
  }, [material, all, isLive, stickTop]);

  useFrame((_, delta) => {
    const d = drip.current;
    if (d.t < 0) return;
    d.t = Math.min(1, d.t + delta / DRIP_DURATION);
    setDripProgress(material, easeOut(d.t));
    if (d.t >= 1) d.t = -1;
  });

  return (
    <group>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
      <mesh geometry={geometry} material={shell} />
    </group>
  );
}
