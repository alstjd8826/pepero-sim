'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Coating, PeperoRecipe } from '@/src/recipe/types';
import { resolveReliefUrl } from '@/src/recipe/relief';
import { buildCookieGeometry, silhouettePlacement } from './cookieGeometry';
import { stickTopFor } from './registry';
import { Decorations } from './Decorations';
import {
  createChocoShellMaterial,
  createCoatedMaterial,
  setCoatings,
  setDripProgress,
  setRelief,
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
  const { silhouette, thickness, relief } = recipe.shape;
  const kind = recipe.base.kind;

  // 각인 강도만 바뀔 때(슬라이더) 지오메트리를 다시 만들지 않도록 실루엣·두께로만 memo
  const geometry = useMemo(
    () => buildCookieGeometry({ silhouette, thickness }, kind),
    [silhouette, thickness, kind],
  );
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

  // 앞면 각인: 텍스처가 오기 전(또는 실패 시)엔 각인 없이 그린다. 셰이더는 그대로라 재컴파일 없음.
  const reliefTexture = useReliefTexture(relief ? resolveReliefUrl(relief.heightmapUrl) : null);
  const placement = useMemo(() => silhouettePlacement(silhouette, kind), [silhouette, kind]);
  const reliefStrength = relief?.strength ?? 0;
  useLayoutEffect(() => {
    setRelief(material, { texture: reliefTexture, strength: reliefStrength, placement, thickness });
  }, [material, reliefTexture, reliefStrength, placement, thickness]);

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
      {/* userData.pepero: 꾸미기 화면이 레이캐스트로 쿠키 표면만 고르는 표시 */}
      <mesh geometry={geometry} material={material} castShadow receiveShadow userData={{ pepero: 'cookie' }} />
      <mesh geometry={geometry} material={shell} raycast={() => {}} />
      <Decorations strokes={recipe.strokes} toppings={recipe.toppings} />
    </group>
  );
}

/** 높이맵 URL → 텍스처 (비동기). 로딩 중·실패·URL 없음이면 null. URL 이 바뀌면 이전 텍스처를 dispose. */
function useReliefTexture(url: string | null): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let texture: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        texture = t;
        setLoaded({ url, texture: t });
      },
      undefined,
      (err) => {
        if (alive) console.warn('[pepero] 각인 높이맵을 불러오지 못했어요', err);
      },
    );
    return () => {
      alive = false;
      texture?.dispose();
    };
  }, [url]);
  return loaded && loaded.url === url ? loaded.texture : null;
}
