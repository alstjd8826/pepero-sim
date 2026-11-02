'use client';

// 임시 확인용 페이지 (Task 6 딥핑). 이후 태스크에서 실제 만들기 흐름으로 교체된다.
import { useMemo, useState } from 'react';
import { createRecipe } from '@/src/recipe/defaults';
import type { Coating, Vec2 } from '@/src/recipe/types';
import { DipScene } from '@/src/dip/DipScene';

const circle: Vec2[] = Array.from({ length: 48 }, (_, i) => {
  const t = (i / 48) * Math.PI * 2;
  return [Math.cos(t) * 0.5, Math.sin(t) * 0.5];
});

export default function Home() {
  const [hasStick, setHasStick] = useState(true);
  const recipe = useMemo(() => createRecipe({ outer: circle }, hasStick), [hasStick]);
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [resetKey, setResetKey] = useState(0);
  // 부모가 확정 코팅을 레시피에 다시 넣어도(새 객체) 장면은 리셋되지 않아야 한다
  const liveRecipe = useMemo(() => ({ ...recipe, coatings }), [recipe, coatings]);

  return (
    <main style={{ background: '#f5efe6', color: '#3b2a1e' }}>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => {
            setHasStick((v) => !v);
            setCoatings([]);
            setResetKey((k) => k + 1);
          }}
        >
          {hasStick ? '막대 끄기' : '막대 켜기'}
        </button>
        <button
          onClick={() => {
            setCoatings([]);
            setResetKey((k) => k + 1);
          }}
        >
          처음부터
        </button>
        <span data-testid="coating-count">
          코팅 {coatings.length}번
          {coatings.length > 0 && ` (깊이 ${(-coatings[coatings.length - 1].plane.offset).toFixed(2)})`}
        </span>
      </div>
      <div style={{ width: '100vw', height: '80vh' }}>
        <DipScene recipe={liveRecipe} onChange={setCoatings} resetKey={resetKey} />
      </div>
      {/* 페이지가 스크롤 가능한 상태에서도 캔버스 드래그가 스크롤을 일으키지 않는지 확인용 */}
      <p style={{ padding: 16, height: '60vh' }}>쿠키를 잡고 아래 초코 통에 담갔다 빼 보세요.</p>
    </main>
  );
}
