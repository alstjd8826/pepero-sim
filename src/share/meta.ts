import type { Metadata } from 'next';

export type GallerySort = 'latest' | 'popular';

/** `?sort=` 값 → 정렬. 모르는 값은 최신순. */
export function gallerySortFrom(value: string | string[] | undefined): GallerySort {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'popular' ? 'popular' : 'latest';
}

const DESCRIPTION = '나도 만들어 보기';
/** 썸네일은 512×512 PNG (전역 제약) */
const THUMB_SIZE = 512;

/** 공유 보기 페이지 메타데이터. 카카오톡·트위터 링크 미리보기에 썸네일이 뜨게 한다. */
export function peperoMetadata(row: { nickname: string; thumbnailUrl: string } | null): Metadata {
  if (!row) return { title: '빼빼로를 찾을 수 없어요', robots: { index: false } };
  const title = `${row.nickname}의 빼빼로`;
  const images = [{ url: row.thumbnailUrl, width: THUMB_SIZE, height: THUMB_SIZE, alt: title }];
  return {
    title,
    description: DESCRIPTION,
    openGraph: { type: 'website', title, description: DESCRIPTION, images },
    twitter: { card: 'summary_large_image', title, description: DESCRIPTION, images: [row.thumbnailUrl] },
  };
}
