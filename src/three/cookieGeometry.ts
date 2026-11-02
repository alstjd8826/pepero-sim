import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PeperoRecipe, Vec2 } from '@/src/recipe/types';
import { baseRegistry } from './registry';

export const BEVEL = 0.06;

function place(points: Vec2[], size: number, dx: number, dy: number): THREE.Vector2[] {
  return points.map(([x, y]) => new THREE.Vector2(x * size + dx, y * size + dy));
}

export function buildCookieGeometry(
  shape: PeperoRecipe['shape'],
  kind: PeperoRecipe['base']['kind'],
): THREE.BufferGeometry {
  const spec = baseRegistry[kind];
  const { outer, holes } = shape.silhouette;

  // 스케일 후 bbox x 중심 = 0, 최저 y = silhouetteBottomY 가 되도록 평행이동
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
  }
  const dx = -((minX + maxX) / 2) * spec.silhouetteSize;
  const dy = spec.silhouetteBottomY - minY * spec.silhouetteSize;

  const s = new THREE.Shape(place(outer, spec.silhouetteSize, dx, dy));
  for (const h of holes ?? []) {
    s.holes.push(new THREE.Path(place(h, spec.silhouetteSize, dx, dy)));
  }

  const depth = Math.max(shape.thickness - 2 * BEVEL, 0.001);
  const cookie = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 1,
  });
  cookie.translate(0, 0, -depth / 2);

  const extras = spec.buildExtras();
  if (!extras) return cookie;

  const parts = [cookie, extras.toNonIndexed()];
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) p.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(parts);
  extras.dispose();
  cookie.dispose();
  if (!merged) throw new Error('쿠키 지오메트리 병합 실패');
  return merged;
}
