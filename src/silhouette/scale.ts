/** 긴 변이 max를 넘으면 비율 유지로 줄인다(반올림). 작은 이미지는 키우지 않는다. */
export function computeScaledSize(w: number, h: number, max: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
