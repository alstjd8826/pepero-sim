'use client';

import { useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, createPortal, useThree } from '@react-three/fiber';
import { Center, OrbitControls, type OnCenterCallbackProps } from '@react-three/drei';
import type { PeperoRecipe } from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';

const FOV = 35;
/** three 의 autoRotateSpeed 는 60fps 기준 (2π/60)*speed rad/s → 0.4 rad/s */
const AUTO_ROTATE_SPEED = (0.4 * 60) / (2 * Math.PI);

/** 공유 보기용 3D 뷰어: 가만히 두면 천천히 돌고, 드래그로 회전(줌·이동 없음). */
export default function PeperoViewer({ recipe }: { recipe: PeperoRecipe }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: FOV, position: [0, 0, 12] }}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
    >
      <ambientLight intensity={0.7} />
      <CameraLights />
      <ViewerModel recipe={recipe} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        makeDefault
      />
    </Canvas>
  );
}

/**
 * 조명을 카메라에 붙인다. OrbitControls 는 모델이 아니라 카메라를 돌리므로, 조명이 월드에 고정돼 있으면
 * 카메라가 뒤로 돌아갔을 때 보이는 면(뒷면)이 그늘이라 어둡게 보인다. 카메라 기준으로 두면 어느 방향에서 봐도
 * 만들기 화면과 같은 조명이 된다 (위치 값은 만들기 화면과 같은 오프셋).
 */
export function CameraLights() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // 카메라의 자식(조명)이 렌더되려면 카메라가 씬 그래프 안에 있어야 한다
    scene.add(camera);
    return () => {
      scene.remove(camera);
    };
  }, [camera, scene]);
  return createPortal(
    <>
      <directionalLight position={[3, 6, 5]} intensity={2} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} />
    </>,
    camera,
  );
}

function ViewerModel({ recipe }: { recipe: PeperoRecipe }) {
  const camera = useThree((s) => s.camera);
  const shape = recipe.shape;
  const kind = recipe.base.kind;
  const cacheKey = { shape, kind };

  // 돌려도 잘리지 않게 바운딩 구 기준으로 카메라 거리를 잡는다 (PeperoPreview spin 모드와 같은 규칙)
  const onCentered = useCallback(
    ({ boundingSphere }: OnCenterCallbackProps) => {
      const half = THREE.MathUtils.degToRad(FOV / 2);
      camera.position.set(0, 0, (boundingSphere.radius / Math.sin(half)) * 1.05);
      camera.lookAt(0, 0, 0);
    },
    [camera],
  );

  return (
    <Center cacheKey={cacheKey} onCentered={onCentered}>
      <PeperoModel recipe={recipe} />
    </Center>
  );
}
