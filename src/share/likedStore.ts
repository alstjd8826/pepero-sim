const key = (id: string) => `pepero:liked:${id}`;

/** 이 브라우저에서 이미 좋아요를 눌렀는지. 저장소 접근이 막혀 있으면 false. */
export function hasLiked(id: string): boolean {
  try {
    return window.localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

export function markLiked(id: string): void {
  try {
    window.localStorage.setItem(key(id), '1');
  } catch {
    // 시크릿 모드 등 — 이번 방문에서만 막으면 충분하다
  }
}
