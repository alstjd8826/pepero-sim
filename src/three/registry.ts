import * as THREE from 'three';
import type { BaseKind, CoatingType, PenColor, PenWidth, ToppingType } from '@/src/recipe/types';

export const STICK_RADIUS = 0.18;
export const STICK_LENGTH = 4.0;

export type BaseSpec = {
  silhouetteSize: number;
  silhouetteBottomY: number;
  buildExtras(): THREE.BufferGeometry | null;
};

export const baseRegistry: Record<BaseKind, BaseSpec> = {
  stick: {
    silhouetteSize: 2.0,
    silhouetteBottomY: 3.8,
    buildExtras() {
      const g = new THREE.CapsuleGeometry(STICK_RADIUS, STICK_LENGTH - 2 * STICK_RADIUS, 8, 16);
      g.translate(0, STICK_LENGTH / 2, 0);
      return g;
    },
  },
  none: {
    silhouetteSize: 3.6,
    silhouetteBottomY: 0,
    buildExtras: () => null,
  },
};

/** 코팅 경계가 막대(원기둥) 구간인지 가르는 높이: 막대 ON 이면 실루엣 시작 높이, OFF 면 0 */
export function stickTopFor(kind: BaseKind): number {
  return kind === 'stick' ? baseRegistry.stick.silhouetteBottomY : 0;
}

export const coatingRegistry: Record<CoatingType, { label: string; color: string; roughness: number }> = {
  'milk-choco': { label: '밀크', color: '#4a2716', roughness: 0.35 },
  'dark-choco': { label: '다크', color: '#24120a', roughness: 0.3 },
  'white-choco': { label: '화이트', color: '#efe0c4', roughness: 0.42 },
  strawberry: { label: '딸기', color: '#e98aa3', roughness: 0.38 },
  matcha: { label: '말차', color: '#7d9e52', roughness: 0.4 },
  blueberry: { label: '블루베리', color: '#6b5196', roughness: 0.38 },
};

export const penRegistry: Record<PenColor, { label: string; color: string }> = {
  white: { label: '화이트', color: '#f7efe2' },
  dark: { label: '다크', color: '#2a150b' },
  pink: { label: '핑크', color: '#f08cab' },
  yellow: { label: '바나나', color: '#f5d34f' },
  mint: { label: '민트', color: '#7fd6bf' },
  sky: { label: '소다', color: '#7cc0ee' },
};

/** 초코펜 굵기 = 튜브 반지름 (모델 단위, 쿠키 폭 ≈ 2) */
export const penWidthRegistry: Record<PenWidth, { label: string; radius: number }> = {
  thin: { label: '가늘게', radius: 0.022 },
  thick: { label: '굵게', radius: 0.042 },
};

/** 무지개 스프링클 색 (토핑마다 spin 으로 골라 늘 같은 색) */
export const SPRINKLE_COLORS = ['#f26d7d', '#f7c548', '#7bd389', '#6cb4ee', '#b48ef0', '#ffffff'];

export const toppingRegistry: Record<
  ToppingType,
  { label: string; color: string; roughness: number; metalness?: number }
> = {
  almond: { label: '아몬드', color: '#e3c08f', roughness: 0.7 },
  crunch: { label: '땅콩 크런치', color: '#c58b4c', roughness: 0.85 },
  sprinkle: { label: '스프링클', color: '#ffffff', roughness: 0.45 },
  star: { label: '별', color: '#f6cf3e', roughness: 0.4 },
  pearl: { label: '펄', color: '#e9e6e1', roughness: 0.2, metalness: 0.8 },
  heart: { label: '하트', color: '#ef5f86', roughness: 0.4 },
};
