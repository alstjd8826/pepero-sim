'use client';

import { useEffect, useMemo } from 'react';
import type { Coating, PeperoRecipe } from '@/src/recipe/types';
import { buildCookieGeometry } from './cookieGeometry';
import { createCookieMaterial, setCoatings } from './coatingMaterial';

type Props = { recipe: PeperoRecipe; liveCoatings?: Coating[] };

const EMPTY: Coating[] = [];

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

function PeperoModelV1({ recipe, liveCoatings }: { recipe: PeperoRecipe; liveCoatings: Coating[] }) {
  const { shape } = recipe;
  const kind = recipe.base.kind;

  const geometry = useMemo(() => buildCookieGeometry(shape, kind), [shape, kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => createCookieMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);

  const coatings = recipe.coatings;
  useEffect(() => {
    setCoatings(material, liveCoatings.length ? [...coatings, ...liveCoatings] : coatings);
  }, [material, coatings, liveCoatings]);

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}
