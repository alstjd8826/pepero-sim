'use client';

// 임시 확인용 페이지 (Task 5). 이후 태스크에서 실제 화면으로 교체된다.
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { createRecipe } from '@/src/recipe/defaults';
import type { PeperoRecipe } from '@/src/recipe/types';
import { PeperoModel } from '@/src/three/PeperoModel';

const recipe: PeperoRecipe = {
  ...createRecipe(
    {
      outer: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ],
    },
    true,
  ),
  coatings: [{ type: 'milk-choco', plane: { normal: [0, -1, 0], offset: -2.0 }, edgeSeed: 0 }],
};

export default function Home() {
  return (
    <main style={{ width: '100vw', height: '100vh', background: '#f5efe6', touchAction: 'none' }}>
      <Canvas camera={{ position: [0, 3, 8], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={2} />
        <PeperoModel recipe={recipe} />
        <OrbitControls target={[0, 2.9, 0]} />
      </Canvas>
    </main>
  );
}
