'use client';

import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Center, type OnCenterCallbackProps } from '@react-three/drei';
import type { PeperoRecipe } from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';
import { captureThumbnail } from './steps';
import { tightFraming } from './framing';

export type CaptureFn = () => Promise<Blob>;

const FOV = 35;
const SPIN_SPEED = 0.6; // rad/s
/** 제품 사진 자세: 거의 정면(살짝 yaw) + 대각선 기울기(쿠키가 오른쪽 위) */
const POSE_YAW = 0.3;
const POSE_ROLL = THREE.MathUtils.degToRad(-40);
/** pose 모드에서 좌우로 살짝 흔들리는 폭·속도 */
const SWAY = 0.12;
const SWAY_SPEED = 0.8;
const MARGIN = 0.08;
/** 코팅 uniform 은 useEffect 에서 들어가므로 최소 이 만큼 그린 뒤에 캡처를 허용한다 */
const FRAMES_BEFORE_READY = 2;

type Props = {
  recipe: PeperoRecipe;
  /**
   * spin: 세운 채 계속 회전(모양 단계).
   * pose: 썸네일과 같은 대각선 제품 자세로 살짝만 흔들림(완성 단계, 저장될 모습 그대로).
   */
  mode?: 'spin' | 'pose';
  /** 넘기면 캡처 가능한 시점(2프레임 이후)에 캡처 함수를 알려 준다 */
  onCaptureReady?: (capture: CaptureFn) => void;
};

/**
 * 빼빼로 미리보기. 캔버스 버퍼는 dpr 2 고정 → 256px 상자면 약 512px 버퍼라 썸네일이 선명하다.
 * `preserveDrawingBuffer` 로 캡처 시점에 내용이 남아 있게 한다.
 */
export default function PeperoPreview({ recipe, mode = 'spin', onCaptureReady }: Props) {
  return (
    <Canvas
      dpr={2}
      gl={{ preserveDrawingBuffer: true }}
      camera={{ fov: FOV, position: [0, 0, 12] }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 6, 5]} intensity={2} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} />
      <PreviewModel recipe={recipe} mode={mode} onCaptureReady={onCaptureReady} />
    </Canvas>
  );
}

const box = new THREE.Box3();

/** 현재 자세의 모델을 정점 기준(precise) 화면 박스로 꽉 차게 카메라를 옮긴다. 카메라는 회전 없이 -Z 를 본다. */
function frameTight(camera: THREE.Camera, target: THREE.Object3D) {
  box.setFromObject(target, true);
  if (box.isEmpty()) return;
  const p = tightFraming(
    { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, maxZ: box.max.z },
    FOV,
    MARGIN,
  );
  camera.position.set(p.x, p.y, p.z);
  camera.lookAt(p.x, p.y, p.z - 1);
}

function PreviewModel({ recipe, mode, onCaptureReady }: Required<Pick<Props, 'mode'>> & Props) {
  const roll = useRef<THREE.Group>(null);
  const yaw = useRef<THREE.Group>(null);
  const frames = useRef(0);
  const elapsed = useRef(0);
  const notified = useRef(false);
  /** Center 의 layout effect 시점엔 부모 그룹 ref 가 아직 없을 수 있어, 다음 프레임에서 맞춘다 */
  const needsFraming = useRef(false);
  const { gl, scene, camera } = useThree();

  // 모양·막대가 바뀔 때만 다시 가운데 정렬(코팅은 셰이더라 바운딩 박스에 영향 없음)
  const shape = recipe.shape;
  const kind = recipe.base.kind;
  const cacheKey = useMemo(() => ({ shape, kind }), [shape, kind]);

  const onCentered = useCallback(
    ({ boundingSphere }: OnCenterCallbackProps) => {
      if (mode === 'spin') {
        // 계속 도니까 어느 각도에서도 잘리지 않게 바운딩 구 기준
        const half = THREE.MathUtils.degToRad(FOV / 2);
        camera.position.set(0, 0, (boundingSphere.radius / Math.sin(half)) * 1.05);
        camera.lookAt(0, 0, 0);
      } else {
        needsFraming.current = true;
      }
    },
    [camera, mode],
  );

  const capture = useCallback<CaptureFn>(async () => {
    const r = roll.current;
    const y = yaw.current;
    if (!r || !y) throw new Error('미리보기가 아직 준비되지 않았어요');
    const prev = { roll: r.rotation.z, yaw: y.rotation.y, cam: camera.position.clone() };
    r.rotation.z = POSE_ROLL;
    y.rotation.y = POSE_YAW;
    try {
      frameTight(camera, r);
      gl.render(scene, camera);
      // captureThumbnail 은 첫 await 전에 픽셀을 동기적으로 복사하므로 바로 되돌려도 된다
      return await captureThumbnail(gl, 512);
    } finally {
      r.rotation.z = prev.roll;
      y.rotation.y = prev.yaw;
      camera.position.copy(prev.cam);
      camera.lookAt(prev.cam.x, prev.cam.y, prev.cam.z - 1);
    }
  }, [gl, scene, camera]);

  useFrame((_, delta) => {
    if (needsFraming.current && roll.current && yaw.current) {
      needsFraming.current = false;
      yaw.current.rotation.y = POSE_YAW;
      frameTight(camera, roll.current);
    }
    elapsed.current += delta;
    if (yaw.current) {
      yaw.current.rotation.y =
        mode === 'spin'
          ? yaw.current.rotation.y + delta * SPIN_SPEED
          : POSE_YAW + Math.sin(elapsed.current * SWAY_SPEED) * SWAY;
    }
    frames.current += 1;
    if (!notified.current && frames.current >= FRAMES_BEFORE_READY && onCaptureReady) {
      notified.current = true;
      onCaptureReady(capture);
    }
  });

  return (
    <group ref={roll} rotation-z={mode === 'pose' ? POSE_ROLL : 0}>
      <group ref={yaw}>
        <Center cacheKey={cacheKey} onCentered={onCentered}>
          <PeperoModel recipe={recipe} />
        </Center>
      </group>
    </group>
  );
}
