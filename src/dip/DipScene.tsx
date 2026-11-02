'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { BaseKind, Coating, PeperoRecipe, Vec2 } from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';
import { BEVEL } from '@/src/three/cookieGeometry';
import { STICK_RADIUS, baseRegistry, coatingRegistry } from '@/src/three/registry';
import { finishDip, initialDip, liveCoating, stepDip, type DipState } from './dipState';

/*
 * 딥핑 장면.
 * - 모델 그룹의 월드 원점 = 담그는 끝(모델 로컬 원점). 코팅 깊이 = SURFACE_Y - 그룹 y (흔들림 회전은 무시).
 * - 드래그는 React 상태가 아니라 Object3D 를 이벤트 핸들러에서 직접 옮긴다 → 다음 프레임에 바로 반영(지연 없음).
 * - 카메라는 고정 방향(회전 0)으로 y 만 평행이동한다. 쿠키가 START_Y 아래로 내려가면 FOLLOW 비율로 따라 내려가는데,
 *   포인터→월드 변환에서 이 추종을 풀어서 계산하므로 쿠키는 여전히 포인터에 정확히 붙어 있다.
 */

const SURFACE_Y = -1.0;
const START_Y = 1.0;
const X_LIMIT = 1.5;
const FOLLOW = 0.55;
const FOV = 45;
const WALL_MARGIN = 0.05;
const MAX_SWAY = THREE.MathUtils.degToRad(6);

type Props = {
  recipe: PeperoRecipe;
  /** 새 코팅이 확정될 때만 호출 (기존 코팅 포함 전체 목록) */
  onChange?: (coatings: Coating[]) => void;
  /** 바뀌면 딥핑 상태를 initialDip(recipe.coatings) 로 되돌리고 쿠키를 처음 자리로 */
  resetKey?: number | string;
};

type RigProps = Omit<Props, 'resetKey'>;

/**
 * 쿠키를 직접 잡고 초코 통에 담그는 장면.
 *
 * Props 계약
 * - `recipe.coatings` 는 마운트 시점과 `resetKey` 가 바뀐 시점에만 읽는다. 이후 코팅은 장면이 소유하며
 *   `onChange` 로 알려 준다. 부모가 그 결과를 recipe 에 다시 넣어도(새 객체여도) 장면은 리셋되지 않는다.
 * - `recipe.shape` / `recipe.base` 가 바뀌면 통·카메라 배치(내용 기준 서명)와 모델만 갱신되고 상태는 유지된다.
 *   새 쿠키로 처음부터 하려면 `resetKey` 를 바꾼다. recipe 를 memo 하지 않아도 안전하다.
 * - `onChange` 는 새 코팅이 확정될 때만 호출된다: 표면 위로 빠져나올 때, 또는 잠긴 채 포인터를 놓을 때
 *   (놓으면 쿠키가 표면 위 처음 높이로 떠오른다).
 */
export function DipScene({ recipe, onChange, resetKey }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        cursor: 'grab',
      }}
    >
      <Canvas camera={{ fov: FOV, position: [0, 3, 12], rotation: [0, 0, 0] }} dpr={[1, 2]}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 6, 5]} intensity={2} />
        <directionalLight position={[-4, 2, 3]} intensity={0.6} />
        <DipRig key={String(resetKey ?? '')} recipe={recipe} onChange={onChange} />
      </Canvas>
    </div>
  );
}

type Layout = {
  modelHeight: number;
  potRadius: number;
  potBottom: number;
  /** 막대 ON 이면 실루엣이 시작되는 높이(그 아래는 막대만), 막대 OFF 면 0 */
  silhouetteStart: number;
  silhouetteHalfWidth: number;
  /** 카메라 기본 중심 y, 화면에 담아야 할 반높이/반폭 */
  camBaseY: number;
  frameHalfH: number;
  frameHalfW: number;
};

function computeLayout(kind: BaseKind, outer: Vec2[]): Layout {
  const spec = baseRegistry[kind];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const modelHeight = spec.silhouetteBottomY + (maxY - minY) * spec.silhouetteSize + BEVEL;
  const silhouetteHalfWidth = ((maxX - minX) / 2) * spec.silhouetteSize + BEVEL;
  // 실루엣이 잠길 때도 좌우로 ±0.65 정도 움직일 여유를 둔다 (너무 좁으면 통 입구에 걸려 안 들어감)
  const potRadius = Math.max(1.9, silhouetteHalfWidth + 0.7);
  // 통 안쪽 깊이 ≥ 모델 높이 + 0.3 → 쿠키 전체를 담글 수 있다
  const potBottom = SURFACE_Y - (modelHeight + 0.3);
  const top = START_Y + modelHeight + 0.4;
  const bottom = SURFACE_Y - 0.8;
  return {
    modelHeight,
    potRadius,
    potBottom,
    silhouetteStart: kind === 'stick' ? spec.silhouetteBottomY : 0,
    silhouetteHalfWidth,
    camBaseY: (top + bottom) / 2,
    frameHalfH: (top - bottom) / 2,
    frameHalfW: potRadius + 0.3,
  };
}

/** 쿠키 아래쪽이 depth 만큼 잠겼을 때 통 벽에 닿지 않는 최대 |x| */
function xLimitAtDepth(L: Layout, depth: number): number {
  const halfW = depth <= L.silhouetteStart ? STICK_RADIUS : L.silhouetteHalfWidth;
  return Math.max(0, L.potRadius - halfW - WALL_MARGIN);
}

/** |x| 위치에서 내려갈 수 있는 최대 깊이 (벽에 걸리면 그 위에서 멈춤) */
function depthLimitAtX(L: Layout, ax: number): number {
  if (ax <= L.potRadius - L.silhouetteHalfWidth - WALL_MARGIN) return Infinity;
  if (L.silhouetteStart > 0 && ax <= L.potRadius - STICK_RADIUS - WALL_MARGIN) return L.silhouetteStart;
  return 0;
}

function camOffsetFor(groupY: number): number {
  return FOLLOW * Math.min(0, groupY - START_Y);
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function DipRig({ recipe, onChange }: RigProps) {
  // three 객체는 렌더 중이 아니라 핸들러/이펙트 안에서 get() 으로 꺼내 변경한다.
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  // 배치는 모양 '내용' 기준으로만 다시 계산 (recipe 객체가 매번 새로 와도 카메라가 흔들리지 않게)
  const shapeSignature = useMemo(
    () => JSON.stringify([recipe.base.kind, recipe.shape.silhouette.outer]),
    [recipe.base.kind, recipe.shape.silhouette.outer],
  );
  const L = useMemo(() => {
    const [kind, outer] = JSON.parse(shapeSignature) as [BaseKind, Vec2[]];
    return computeLayout(kind, outer);
  }, [shapeSignature]);
  const layoutRef = useRef(L);
  useLayoutEffect(() => {
    layoutRef.current = L;
  }, [L]);

  const groupRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);

  // 장면은 recipe 의 모양/베이스로 key 되어 있으므로 초기 코팅은 마운트 시점 값으로 충분하다.
  const [initialCoatings] = useState(() => recipe.coatings);
  const dipRef = useRef<DipState>(initialDip(initialCoatings));
  const [committed, setCommitted] = useState<Coating[]>(initialCoatings);
  const [live, setLive] = useState<Coating | null>(null);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 초기 위치. 카메라 맞춤(아래)보다 먼저 실행돼야 카메라 추종 오프셋이 0 으로 시작한다.
  useLayoutEffect(() => {
    groupRef.current?.position.set(0, START_Y, 0);
  }, []);

  // 화면 맞춤: 통 폭과 쿠키+통 입구 높이가 모두 들어오도록 카메라 거리 결정
  const viewRef = useRef({ baseY: L.camBaseY, yMax: START_Y, xMax: X_LIMIT });
  const applyCamera = useCallback(
    (groupY: number) => {
      const camera = get().camera;
      camera.position.y = viewRef.current.baseY + camOffsetFor(groupY);
      camera.updateMatrixWorld();
    },
    [get],
  );
  useLayoutEffect(() => {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = size.width / Math.max(1, size.height);
    const dist = Math.max(L.frameHalfH / tan, L.frameHalfW / (tan * aspect));
    const camera = get().camera as THREE.PerspectiveCamera;
    camera.fov = FOV;
    camera.position.set(0, L.camBaseY, dist);
    camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix();
    const halfH = dist * tan;
    const halfW = halfH * aspect;
    viewRef.current = {
      baseY: L.camBaseY,
      // 쿠키 꼭대기·옆이 화면 밖으로 나가지 않게
      yMax: Math.max(START_Y, L.camBaseY + halfH - L.modelHeight - 0.1),
      xMax: THREE.MathUtils.clamp(halfW - L.silhouetteHalfWidth - 0.05, 0, X_LIMIT),
    };
    applyCamera(groupRef.current?.position.y ?? START_Y);
  }, [get, size.width, size.height, L, applyCamera]);

  // 잠긴 채 놓으면 쿠키를 처음 높이로 띄워 올린다 (다시 잡으면 즉시 중단)
  const liftRef = useRef(false);

  // 흔들림(시각용): x 속도 → z 회전 스프링
  const sway = useRef({ vx: 0, angle: 0, angVel: 0, lastX: 0, lastT: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const g = groupRef.current;
    if (liftRef.current && g) {
      const y = g.position.y + (START_Y - g.position.y) * (1 - Math.exp(-dt * 9));
      const done = START_Y - y < 0.005;
      g.position.y = done ? START_Y : y;
      applyCamera(g.position.y);
      if (done) liftRef.current = false;
    }
    const pivot = pivotRef.current;
    if (!pivot) return;
    const s = sway.current;
    s.vx *= Math.exp(-dt * 8);
    const target = THREE.MathUtils.clamp(-s.vx * 0.04, -MAX_SWAY, MAX_SWAY);
    s.angVel += (140 * (target - s.angle) - 11 * s.angVel) * dt;
    s.angle = THREE.MathUtils.clamp(s.angle + s.angVel * dt, -MAX_SWAY, MAX_SWAY);
    pivot.rotation.z = s.angle;
  });

  // 포인터: 캔버스 어디를 잡아도 되고, 잡은 지점과의 오프셋을 유지해 튀지 않는다.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    let activeId: number | null = null;
    let offX = 0;
    let offY = 0;

    const project = (e: PointerEvent): boolean => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      return raycaster.ray.intersectPlane(plane, hit) !== null;
    };

    const onDown = (e: PointerEvent) => {
      if (activeId !== null || !e.isPrimary) return;
      const g = groupRef.current;
      if (!g || !project(e)) return;
      e.preventDefault();
      liftRef.current = false;
      activeId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      offX = hit.x - g.position.x;
      offY = hit.y - g.position.y;
      // 흔들림 축 = 잡은 높이
      const grabY = THREE.MathUtils.clamp(offY, 0, layoutRef.current.modelHeight);
      pivotRef.current?.position.set(0, grabY, 0);
      innerRef.current?.position.set(0, -grabY, 0);
      sway.current.lastX = g.position.x;
      sway.current.lastT = e.timeStamp;
    };

    /** 상태 전이 반영: 확정이 생기면 렌더 상태 갱신 + onChange, 미리보기는 깊이가 바뀔 때만 갱신 */
    const applyDip = (next: DipState) => {
      const prev = dipRef.current;
      dipRef.current = next;
      if (next.committed !== prev.committed) {
        setCommitted(next.committed);
        onChangeRef.current?.(next.committed);
      }
      const nextLive = liveCoating(next);
      setLive((cur) =>
        cur?.plane.offset === nextLive?.plane.offset && cur?.edgeSeed === nextLive?.edgeSeed ? cur : nextLive,
      );
    };

    /** 포인터 샘플 하나만큼 쿠키를 옮기고 딥핑 상태를 한 단계 진행 */
    const moveTo = (ev: PointerEvent, g: THREE.Group) => {
      if (!project(ev)) return;
      const Lc = layoutRef.current;
      const prevY = g.position.y;

      // 카메라 추종을 되돌린 기준 좌표에서 목표 y 를 푼다: g + offY = refY + FOLLOW·min(0, g − START_Y)
      const refY = hit.y - camOffsetFor(prevY);
      const a = refY - offY;
      let y = a >= START_Y ? a : (a - FOLLOW * START_Y) / (1 - FOLLOW);
      const xMax = viewRef.current.xMax;
      let x = THREE.MathUtils.clamp(hit.x - offX, -xMax, xMax);

      // 이미 잠겨 있으면 벽 안쪽으로만, 그다음 그 x 에서 내려갈 수 있는 깊이로 y 제한
      const prevDepth = SURFACE_Y - prevY;
      if (prevDepth > 0) {
        const lim = xLimitAtDepth(Lc, prevDepth);
        x = THREE.MathUtils.clamp(x, -lim, lim);
      }
      y = Math.max(y, SURFACE_Y - depthLimitAtX(Lc, Math.abs(x)), Lc.potBottom);
      y = Math.min(y, viewRef.current.yMax);

      g.position.set(x, y, 0);
      applyCamera(y);

      const s = sway.current;
      const dt = Math.max((ev.timeStamp - s.lastT) / 1000, 1 / 240);
      s.vx = s.vx * 0.5 + ((x - s.lastX) / dt) * 0.5;
      s.lastX = x;
      s.lastT = ev.timeStamp;

      applyDip(stepDip(dipRef.current, y, SURFACE_Y, randomSeed));
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      const g = groupRef.current;
      if (!g) return;
      e.preventDefault();
      // 프레임 사이에 합쳐진 샘플까지 모두 반영 → 빠르게 휙 담가도 가장 깊은 지점을 놓치지 않는다
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) moveTo(ev, g);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      el.style.cursor = '';
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // 잠긴 채 놓으면 이번 담금을 확정하고 표면 위로 띄운다
      if (dipRef.current.inChoco) {
        applyDip(finishDip(dipRef.current, randomSeed));
        liftRef.current = true;
      }
    };

    // iOS Safari 등 touch-action 을 무시하는 경우 대비
    const onTouchMove = (e: TouchEvent) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [gl, get, applyCamera]);

  const renderRecipe = useMemo(() => ({ ...recipe, coatings: committed }), [recipe, committed]);
  const liveList = useMemo(() => (live ? [live] : []), [live]);

  return (
    <>
      <group ref={groupRef}>
        <group ref={pivotRef}>
          <group ref={innerRef}>
            <PeperoModel recipe={renderRecipe} liveCoatings={liveList} />
          </group>
        </group>
      </group>
      <ChocoPot layout={L} />
    </>
  );
}

function ChocoPot({ layout: L }: { layout: Layout }) {
  const chocoDepth = SURFACE_Y - L.potBottom;
  const rimTop = SURFACE_Y + 0.35;
  const wallHeight = rimTop - (L.potBottom - 0.12);
  const choco = coatingRegistry['milk-choco'];
  return (
    <group>
      {/* 녹은 초코 */}
      <mesh position={[0, L.potBottom + chocoDepth / 2, 0]}>
        <cylinderGeometry args={[L.potRadius - 0.02, L.potRadius - 0.02, chocoDepth, 48]} />
        <meshStandardMaterial color={choco.color} roughness={0.25} />
      </mesh>
      {/* 유리 통 */}
      <mesh position={[0, L.potBottom - 0.12 + wallHeight / 2, 0]} renderOrder={1}>
        <cylinderGeometry args={[L.potRadius + 0.06, L.potRadius + 0.06, wallHeight, 48, 1, true]} />
        <meshStandardMaterial
          color="#dfeef5"
          transparent
          opacity={0.22}
          roughness={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* 입구 테두리 */}
      <mesh position={[0, rimTop, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[L.potRadius + 0.06, 0.05, 12, 64]} />
        <meshStandardMaterial color="#f4fbff" transparent opacity={0.6} roughness={0.1} />
      </mesh>
    </group>
  );
}
