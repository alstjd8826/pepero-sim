import { RELIEF_KEY_RE } from './types';

export const RELIEF_BUCKET = 'reliefs';
/** 각인 기본 강도 (슬라이더 초기값) */
export const DEFAULT_RELIEF_STRENGTH = 0.6;

/** 저장 id → 레시피에 넣는 높이맵 키 */
export function reliefKeyFor(id: string): string {
  return `${RELIEF_BUCKET}/${id}.png`;
}

/**
 * 레시피의 heightmapUrl → 실제로 불러올 주소.
 * - 저장 키 `reliefs/<id>.png` → 이 프로젝트 Supabase 의 공개 URL
 * - `blob:` → 만드는 중(저장 전) 로컬 미리보기. 같은 출처에서만 열리므로 안전하다.
 * - 그 밖(외부 URL 등) → null (불러오지 않는다)
 */
export function resolveReliefUrl(
  heightmapUrl: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (heightmapUrl.startsWith('blob:')) return heightmapUrl;
  if (!RELIEF_KEY_RE.test(heightmapUrl) || !supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${heightmapUrl}`;
}
