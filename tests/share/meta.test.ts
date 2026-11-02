import { describe, expect, it } from 'vitest';
import { gallerySortFrom, peperoMetadata } from '@/src/share/meta';

describe('peperoMetadata', () => {
  it('닉네임 제목, 썸네일 og:image, "나도 만들어 보기" 설명', () => {
    const m = peperoMetadata({ nickname: '꾸그', thumbnailUrl: 'https://x.supabase.co/t/abc.png' });
    expect(m.title).toBe('꾸그의 빼빼로');
    expect(m.description).toBe('나도 만들어 보기');
    expect(m.openGraph).toMatchObject({
      title: '꾸그의 빼빼로',
      description: '나도 만들어 보기',
      images: [{ url: 'https://x.supabase.co/t/abc.png', width: 512, height: 512 }],
    });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('작품이 없으면 noindex', () => {
    const m = peperoMetadata(null);
    expect(m.robots).toMatchObject({ index: false });
    expect(m.openGraph).toBeUndefined();
  });
});

describe('gallerySortFrom', () => {
  it('popular 만 인기순, 나머지는 최신순', () => {
    expect(gallerySortFrom('popular')).toBe('popular');
    expect(gallerySortFrom('latest')).toBe('latest');
    expect(gallerySortFrom(undefined)).toBe('latest');
    expect(gallerySortFrom(['popular', 'latest'])).toBe('popular');
    expect(gallerySortFrom('hack')).toBe('latest');
  });
});
