import { Suspense } from 'react';
import { connection } from 'next/server';
import { listGallery, type PeperoRow } from '@/src/api/peperos';
import { GalleryGrid } from '@/src/share/GalleryGrid';
import { gallerySortFrom, type GallerySort } from '@/src/share/meta';
import { PageShell, RetryLater } from '@/src/share/PageShell';
import { SortToggle } from '@/src/share/SortToggle';

export const metadata = { title: '갤러리 · 빼빼로 시뮬레이터' };

export default function GalleryPage({ searchParams }: PageProps<'/gallery'>) {
  return (
    <Suspense fallback={<PageShell nav={{ href: '/', label: '나도 만들기' }}><p style={{ textAlign: 'center' }}>불러오는 중…</p></PageShell>}>
      <GalleryContent searchParams={searchParams} />
    </Suspense>
  );
}

async function GalleryContent({ searchParams }: { searchParams: PageProps<'/gallery'>['searchParams'] }) {
  await connection();
  const sort: GallerySort = gallerySortFrom((await searchParams).sort);
  let page: { items: PeperoRow[]; nextCursor?: string } | null = null;
  try {
    page = await listGallery({ sort });
  } catch (e) {
    console.error('[gallery] listGallery 실패', e);
  }

  return (
    <PageShell nav={{ href: '/', label: '나도 만들기' }}>
      <SortToggle sort={sort} />
      {page ? (
        // 정렬이 바뀌면 그리드 상태(더 보기 커서·목록)를 새로 시작한다
        <GalleryGrid key={sort} initialItems={page.items} initialCursor={page.nextCursor} sort={sort} />
      ) : (
        <RetryLater />
      )}
    </PageShell>
  );
}
