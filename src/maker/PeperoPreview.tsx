'use client';

import { useCallback, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Center, type OnCenterCallbackProps } from '@react-three/drei';
import type { PeperoRecipe } from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';
import { captureThumbnail } from './steps';

export type CaptureFn = () => Promise<Blob>;

const FOV = 35;
const SPIN_SPEED = 0.6; // rad/s
/** 썸네일 고정 자세: 정면에서 살짝 돌린 3/4 뷰 */
const THUMBNAIL_POSE = -0.6;
/** 코팅 uniform 은 useEffect 에서 들어가므로 최소 이 만큼 그린 뒤에 캡처를 허용한다 */
const FRAMES_BEFORE_READY = 2;

type Props = {
  recipe: PeperoRecipe;
  /** 넘기면 캡처 가능한 시점(2프레임 이후)에 캡처 함수를 알려 준다 */
  onCaptureReady?: (capture: CaptureFn) => void;
};

/**
 * 천천히 도는 빼빼로 미리보기. 캔버스 버퍼는 dpr 2 고정 → 256px 상자면 512px 버퍼라 썸네일이 선명하다.
 * `preserveDrawingBuffer` 로 캡처 시점에 내용이 남아 있게 한다.
 */
export default function PeperoPreview({ recipe, onCaptureReady }: Props) {
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
      <SpinningModel recipe={recipe} onCaptureReady={onCaptureReady} />
    </Canvas>
  );
}

function SpinningModel({ recipe, onCaptureReady }: Props) {
  const spin = useRef<THREE.Group>(null);
  const frames = useRef(0);
  const notified = useRef(false);
  const { gl, scene, camera } = useThree();

  // 모양·막대가 바뀔 때만 다시 가운데 정렬(코팅은 셰이더라 바운딩 박스에 영향 없음)
  const shape = recipe.shape;
  const kind = recipe.base.kind;
  const cacheKey = useMemo(() => ({ shape, kind }), [shape, kind]);

  const frame = useCallback(
    ({ boundingSphere }: OnCenterCallbackProps) => {
      const half = ((FOV / 2) * Math.PI) / 180;
      const dist = (boundingSphere.radius / Math.sin(half)) * 1.05;
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
    },
    [camera],
  );

  const capture = useCallback<CaptureFn>(async () => {
    const g = spin.current;
    if (!g) throw new Error('미리보기가 아직 준비되지 않았어요');
    const prev = g.rotation.y;
    g.rotation.y = THUMBNAIL_POSE;
    try {
      gl.render(scene, camera);
      // captureThumbnail 은 첫 await 전에 픽셀을 동기적으로 복사하므로 바로 되돌려도 된다
      return await captureThumbnail(gl, 512);
    } finally {
      g.rotation.y = prev;
    }
  }, [gl, scene, camera]);

  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * SPIN_SPEED;
    frames.current += 1;
    if (!notified.current && frames.current >= FRAMES_BEFORE_READY && onCaptureReady) {
      notified.current = true;
      onCaptureReady(capture);
    }
  });

  return (
    <group ref={spin}>
      <Center cacheKey={cacheKey} onCentered={frame}>
        <PeperoModel recipe={recipe} />
      </Center>
    </group>
  );
}
