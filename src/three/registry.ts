import * as THREE from 'three';
import type { BaseKind, CoatingType } from '@/src/recipe/types';

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

export const coatingRegistry: Record<CoatingType, { color: string; roughness: number }> = {
  'milk-choco': { color: '#4a2716', roughness: 0.35 },
};
