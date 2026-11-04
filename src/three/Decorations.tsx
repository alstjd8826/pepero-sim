'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TOPPING_TYPES, type Stroke, type Topping, type ToppingType } from '@/src/recipe/types';
import { SHELL_THICKNESS } from './coatingMaterial';
import { SPRINKLE_COLORS, penRegistry, penWidthRegistry, toppingRegistry } from './registry';

/*
 * 꾸미기(초코펜 선 + 토핑) 렌더링. 레시피 좌표 = 모델 로컬.
 * - 선: points 는 튜브 중심선(이미 표면에서 띄운 점). CatmullRom 곡선 → TubeGeometry, 양 끝은 둥근 캡.
 * - 토핑: position 은 표면 점, normal 은 표면 법선. 초코 셸 두께 + 토핑 반높이만큼 띄워 얹는다.
 *   토핑 지오메트리는 +z 가 위(납작한 면이 표면에 닿는 쪽 = -z).
 * 꾸미기 화면이 쿠키만 골라 맞추도록(raycast) 장식 메시는 레이캐스트에서 빠진다.
 */

const noRaycast = () => {};

/** 펜 중심선을 표면에서 띄우는 거리 = 셸 두께 + 반지름의 이 비율 (나머지는 표면에 살짝 묻힘) */
export const PEN_LIFT_RATIO = 0.6;
export function penLift(radius: number): number {
  return SHELL_THICKNESS + radius * PEN_LIFT_RATIO;
}

const penMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
function penMaterial(color: string): THREE.MeshPhysicalMaterial {
  let m = penMaterials.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    penMaterials.set(color, m);
  }
  return m;
}

const capGeometry = new THREE.SphereGeometry(1, 12, 8);

function StrokeMesh({ stroke }: { stroke: Stroke }) {
  const radius = penWidthRegistry[stroke.width].radius;
  const material = penMaterial(penRegistry[stroke.color].color);
  // 그리기를 막 시작한 획은 점이 하나뿐 → 곡선 없이 둥근 점만 그린다 (CatmullRom 은 점 2개 이상 필요)
  const geometry = useMemo(() => {
    if (stroke.points.length < 2) return null;
    const pts = stroke.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segments = Math.min(900, Math.max(4, pts.length * 4));
    return new THREE.TubeGeometry(curve, segments, radius, 8, false);
  }, [stroke.points, radius]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return (
    <group>
      {geometry && <mesh geometry={geometry} material={material} raycast={noRaycast} />}
      <mesh geometry={capGeometry} material={material} position={first} scale={radius} raycast={noRaycast} />
      <mesh geometry={capGeometry} material={material} position={last} scale={radius} raycast={noRaycast} />
    </group>
  );
}

function starShape(outer: number, inner: number, points = 5): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function heartShape(size: number): THREE.Shape {
  const k = size / 10;
  const s = new THREE.Shape();
  s.moveTo(0, -6 * k);
  s.bezierCurveTo(-1 * k, -4.5 * k, -7 * k, -1 * k, -6 * k, 3 * k);
  s.bezierCurveTo(-5.2 * k, 6.5 * k, -1 * k, 6.5 * k, 0, 3.5 * k);
  s.bezierCurveTo(1 * k, 6.5 * k, 5.2 * k, 6.5 * k, 6 * k, 3 * k);
  s.bezierCurveTo(7 * k, -1 * k, 1 * k, -4.5 * k, 0, -6 * k);
  return s;
}

function extruded(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.35,
    bevelSize: depth * 0.35,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

type ToppingLook = { geometry: THREE.BufferGeometry; halfHeight: number; material: THREE.MeshStandardMaterial };

let looks: Record<ToppingType, ToppingLook> | null = null;
/** 토핑 지오메트리·머티리얼은 한 번 만들어 모든 장면이 공유한다 (dispose 하지 않음) */
function toppingLooks(): Record<ToppingType, ToppingLook> {
  if (looks) return looks;
  const mat = (t: ToppingType) => {
    const r = toppingRegistry[t];
    return new THREE.MeshStandardMaterial({ color: r.color, roughness: r.roughness, metalness: r.metalness ?? 0 });
  };
  const almond = new THREE.SphereGeometry(1, 20, 10);
  almond.scale(0.14, 0.085, 0.024);
  const crunch = new THREE.IcosahedronGeometry(0.06, 0);
  crunch.scale(1, 0.8, 0.6);
  const sprinkle = new THREE.CapsuleGeometry(0.016, 0.08, 4, 8);
  const pearl = new THREE.SphereGeometry(0.045, 16, 12);
  looks = {
    almond: { geometry: almond, halfHeight: 0.02, material: mat('almond') },
    crunch: { geometry: crunch, halfHeight: 0.03, material: mat('crunch') },
    sprinkle: { geometry: sprinkle, halfHeight: 0.014, material: mat('sprinkle') },
    star: { geometry: extruded(starShape(0.085, 0.037), 0.022), halfHeight: 0.016, material: mat('star') },
    pearl: { geometry: pearl, halfHeight: 0.033, material: mat('pearl') },
    heart: { geometry: extruded(heartShape(0.11), 0.024), halfHeight: 0.017, material: mat('heart') },
  };
  return looks;
}

const Z = new THREE.Vector3(0, 0, 1);
const tmp = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  qs: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  n: new THREE.Vector3(),
  s: new THREE.Vector3(),
  c: new THREE.Color(),
};

/** spin 값에서 뽑는 결정적 난수 (토핑마다 늘 같은 크기·색) */
function spinHash(spin: number, k: number): number {
  const x = Math.sin(spin * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ToppingInstances({ type, items }: { type: ToppingType; items: Topping[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const look = toppingLooks()[type];
  // 인스턴스 버퍼는 개수가 늘 때만 다시 만든다 (2의 거듭제곱으로 여유)
  const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, items.length))));
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((t, i) => {
      tmp.n.set(t.normal[0], t.normal[1], t.normal[2]).normalize();
      tmp.q.setFromUnitVectors(Z, tmp.n);
      tmp.qs.setFromAxisAngle(Z, t.spin);
      tmp.q.multiply(tmp.qs);
      tmp.p.set(t.position[0], t.position[1], t.position[2]).addScaledVector(tmp.n, SHELL_THICKNESS + look.halfHeight);
      const k = 0.85 + 0.3 * spinHash(t.spin, 1);
      tmp.s.set(k, k, k);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
      if (type === 'sprinkle') {
        tmp.c.set(SPRINKLE_COLORS[Math.floor(spinHash(t.spin, 2) * SPRINKLE_COLORS.length)]);
        mesh.setColorAt(i, tmp.c);
      }
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, look, type, capacity]);
  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[look.geometry, look.material, capacity]}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
}

export function Decorations({ strokes, toppings }: { strokes?: Stroke[]; toppings: Topping[] }) {
  const byType = useMemo(() => {
    const m = new Map<ToppingType, Topping[]>();
    for (const t of toppings) {
      const list = m.get(t.type);
      if (list) list.push(t);
      else m.set(t.type, [t]);
    }
    return m;
  }, [toppings]);
  return (
    <group>
      {strokes?.map((s, i) => <StrokeMesh key={i} stroke={s} />)}
      {TOPPING_TYPES.map((type) => {
        const items = byType.get(type);
        return items ? <ToppingInstances key={type} type={type} items={items} /> : null;
      })}
    </group>
  );
}
