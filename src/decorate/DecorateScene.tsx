'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { Center, OrbitControls, type OnCenterCallbackProps } from '@react-three/drei';
import {
  MAX_STROKE_POINTS,
  type PenColor,
  type PenWidth,
  type PeperoRecipe,
  type Stroke,
  type Topping,
  type ToppingType,
  type Vec3,
} from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';
import { CameraLights } from '@/src/share/PeperoViewer';
import { penLift } from '@/src/three/Decorations';
import { penWidthRegistry } from '@/src/three/registry';
import { SCATTER, roundVec, scatterToppings, shouldAddPoint } from './decorations';

export type DecoTool =
  | { kind: 'pen'; color: PenColor; width: PenWidth }
  | { kind: 'topping'; type: ToppingType };

type Props = {
  /** 코팅과 지금까지의 꾸미기가 들어간 레시피 */
  recipe: PeperoRecipe;
  tool: DecoTool;
  /** 남은 선 점 개수 (0 이하면 새 선을 못 그음) / 새 선을 시작할 수 있는가 */
  strokePointsLeft: number;
  canStartStroke: boolean;
  /** 남은 토핑 개수 */
  toppingsLeft: number;
  onStroke: (stroke: Stroke) => void;
  onToppings: (items: Topping[]) => void;
  /** 한도에 걸려 더 못 그리거나 못 올릴 때 */
  onLimit?: () => void;
};

const FOV = 35;
/** 펜 점 간격 (모델 단위). 너무 촘촘하면 저장 한도를 빨리 쓰고, 성기면 곡선이 각진다 */
const PEN_SPACING = 0.035;

/**
 * 꾸미기 장면: 쿠키 위를 누르고 끌면 초코펜/토핑, 빈 곳을 끌면 돌려 보기(OrbitControls).
 * 쿠키를 눌렀을 때는 포인터 이벤트 전파를 막아 OrbitControls 가 회전하지 않게 한다.
 */
export function DecorateScene(props: Props) {
  return (
    <div style={{ width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <Canvas dpr={[1, 2]} camera={{ fov: FOV, position: [0, 0, 12] }} gl={{ preserveDrawingBuffer: false }}>
        <ambientLight intensity={0.7} />
        <CameraLights />
        <DecorateRig {...props} />
        <OrbitControls enablePan={false} minDistance={2.5} maxDistance={24} makeDefault />
      </Canvas>
    </div>
  );
}

function rand() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

function DecorateRig({
  recipe,
  tool,
  strokePointsLeft,
  canStartStroke,
  toppingsLeft,
  onStroke,
  onToppings,
  onLimit,
}: Props) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const camera = useThree((s) => s.camera);
  const modelRef = useRef<THREE.Group>(null);

  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [liveToppings, setLiveToppings] = useState<Topping[]>([]);

  // 핸들러는 effect 한 번만 등록하고 최신 값은 ref 로 읽는다
  const latest = useRef({ tool, strokePointsLeft, canStartStroke, toppingsLeft, onStroke, onToppings, onLimit });
  useEffect(() => {
    latest.current = { tool, strokePointsLeft, canStartStroke, toppingsLeft, onStroke, onToppings, onLimit };
  });

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    type Gesture =
      | { kind: 'pen'; id: number; stroke: Stroke; lift: number; limited: boolean }
      | { kind: 'topping'; id: number; type: ToppingType; items: Topping[]; last: Vec3; limited: boolean };
    let g: Gesture | null = null;

    /** 포인터 아래 쿠키 표면 점과 법선 (모델 로컬). 쿠키가 아니면 null */
    const pick = (e: PointerEvent): { p: Vec3; n: Vec3 } | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const root = modelRef.current;
      if (!root) return null;
      const hit = raycaster.intersectObject(root, true).find((h) => h.object.userData.pepero === 'cookie');
      if (!hit || !hit.face) return null;
      // 쿠키 메시는 PeperoModel 안에서 변환이 없다 → 메시 로컬 = 레시피 좌표, 면 법선도 그대로 쓴다.
      // 레이캐스트는 앞면(FrontSide)만 맞으므로 법선은 늘 카메라 쪽이다.
      const local = hit.object.worldToLocal(hit.point.clone());
      const n = hit.face.normal;
      return { p: [local.x, local.y, local.z], n: [n.x, n.y, n.z] };
    };

    const lifted = (p: Vec3, n: Vec3, lift: number): Vec3 =>
      roundVec([p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift]);

    const addToppingsAt = (gest: Extract<Gesture, { kind: 'topping' }>, p: Vec3, n: Vec3) => {
      const L = latest.current;
      const budget = L.toppingsLeft - gest.items.length;
      if (budget <= 0) {
        if (!gest.limited) L.onLimit?.();
        gest.limited = true;
        return;
      }
      gest.items = [...gest.items, ...scatterToppings(gest.type, p, n, rand, budget)];
      gest.last = p;
      setLiveToppings(gest.items);
    };

    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary) return;
      const hit = pick(e);
      if (!hit) return; // 빈 곳 → OrbitControls 회전
      e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const L = latest.current;
      if (L.tool.kind === 'pen') {
        if (!L.canStartStroke) {
          L.onLimit?.();
          return;
        }
        const lift = penLift(penWidthRegistry[L.tool.width].radius);
        const stroke: Stroke = { color: L.tool.color, width: L.tool.width, points: [lifted(hit.p, hit.n, lift)] };
        g = { kind: 'pen', id: e.pointerId, stroke, lift, limited: false };
        setLiveStroke(stroke);
      } else {
        const gest: Extract<Gesture, { kind: 'topping' }> = {
          kind: 'topping',
          id: e.pointerId,
          type: L.tool.type,
          items: [],
          last: hit.p,
          limited: false,
        };
        g = gest;
        addToppingsAt(gest, hit.p, hit.n);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      e.stopPropagation();
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) {
        const hit = pick(ev);
        if (!hit) continue; // 쿠키 밖으로 나가면 그 구간은 건너뛴다
        if (g.kind === 'pen') {
          const pts = g.stroke.points;
          const p = lifted(hit.p, hit.n, g.lift);
          if (!shouldAddPoint(pts[pts.length - 1], p, PEN_SPACING)) continue;
          if (pts.length >= Math.min(MAX_STROKE_POINTS, latest.current.strokePointsLeft)) {
            if (!g.limited) latest.current.onLimit?.();
            g.limited = true;
            continue;
          }
          g.stroke = { ...g.stroke, points: [...pts, p] };
        } else if (shouldAddPoint(g.last, hit.p, SCATTER[g.type].spacing)) {
          addToppingsAt(g, hit.p, hit.n);
        }
      }
      if (g.kind === 'pen') setLiveStroke(g.stroke);
    };

    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      e.stopPropagation();
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      const done = g;
      g = null;
      if (done.kind === 'pen') {
        let pts = done.stroke.points;
        // 톡 찍기만 하면 점 하나 → 아주 짧은 선으로 동그란 점을 만든다
        if (pts.length === 1) pts = [pts[0], roundVec([pts[0][0] + 0.002, pts[0][1], pts[0][2]])];
        latest.current.onStroke({ ...done.stroke, points: pts });
        setLiveStroke(null);
      } else {
        if (done.items.length) latest.current.onToppings(done.items);
        setLiveToppings([]);
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [gl, get]);

  const shown = useMemo<PeperoRecipe>(() => {
    if (!liveStroke && !liveToppings.length) return recipe;
    return {
      ...recipe,
      strokes: liveStroke ? [...(recipe.strokes ?? []), liveStroke] : recipe.strokes,
      toppings: liveToppings.length ? [...recipe.toppings, ...liveToppings] : recipe.toppings,
    };
  }, [recipe, liveStroke, liveToppings]);

  // 모양·막대가 바뀔 때만 다시 가운데 정렬 (꾸미기가 늘어도 화면이 튀지 않게)
  const { silhouette, thickness } = recipe.shape;
  const kind = recipe.base.kind;
  const cacheKey = useMemo(() => ({ silhouette, thickness, kind }), [silhouette, thickness, kind]);
  const onCentered = useCallback(
    ({ boundingSphere }: OnCenterCallbackProps) => {
      const half = THREE.MathUtils.degToRad(FOV / 2);
      // 앞면이 보이게 정면에서, 살짝 가깝게 (꾸미기는 크게 보는 게 편하다)
      camera.position.set(0, 0, (boundingSphere.radius / Math.sin(half)) * 0.95);
      camera.lookAt(0, 0, 0);
    },
    [camera],
  );

  return (
    <Center cacheKey={cacheKey} onCentered={onCentered}>
      <group ref={modelRef}>
        <PeperoModel recipe={shown} />
      </group>
    </Center>
  );
}
