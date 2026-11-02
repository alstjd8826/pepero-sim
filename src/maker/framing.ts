/** 화면 축에 정렬된 박스(카메라는 -Z 를 바라보고 회전 없음). */
export type ScreenBox = { minX: number; maxX: number; minY: number; maxY: number; maxZ: number };

/**
 * 정사각형(aspect 1) 원근 카메라가 박스를 꽉 차게 담는 위치.
 * margin = 한쪽 여백 비율(0.08 → 내용이 프레임의 84%). 가장 앞면(maxZ) 기준이라 원근에서도 보수적.
 */
export function tightFraming(box: ScreenBox, fovDeg: number, margin = 0.08) {
  const half = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2;
  const visibleHalf = half / (1 - 2 * margin);
  const dist = visibleHalf / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    z: box.maxZ + dist,
  };
}
