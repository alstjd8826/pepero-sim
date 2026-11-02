'use client';

import { useCallback } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
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
      <directionalLight position={[3, 6, 5]} intensity={2} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} />
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
