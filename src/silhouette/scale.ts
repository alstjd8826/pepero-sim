/**
 * 긴 변을 max 에 맞춘다(비율 유지, 반올림). 큰 이미지는 줄이고 작은 이미지는 키운다.
 * 작은 이미지를 키워 두면 윤곽 추적·색 분리가 픽셀 계단 없이 매끈하게 나온다.
 */
export function computeScaledSize(w: number, h: number, max: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest === max || longest <= 0) return { width: w, height: h };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
