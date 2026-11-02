import { describe, expect, it } from 'vitest';
import { tightFraming } from '@/src/maker/framing';

describe('tightFraming', () => {
  it('박스 중심을 바라보고, 긴 변 + 양쪽 8% 여백이 화면에 딱 맞는 거리', () => {
    const box = { minX: -1, maxX: 3, minY: 0, maxY: 2, maxZ: 0.5 };
    const p = tightFraming(box, 90, 0.08);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
    // 긴 변 4 → 반 2, 내용 84% → 보이는 반 = 2/0.84, tan(45°)=1
    expect(p.z).toBeCloseTo(0.5 + 2 / 0.84);
  });

  it('세로로 긴 박스는 세로 기준', () => {
    const p = tightFraming({ minX: 0, maxX: 1, minY: 0, maxY: 6, maxZ: 0 }, 90, 0);
    expect(p.z).toBeCloseTo(3);
  });
});
