import { Suspense } from 'react';
import { connection } from 'next/server';
import { listGallery, type PeperoRow } from '@/src/api/peperos';
import { GalleryGrid } from '@/src/share/GalleryGrid';
import { PageShell, RetryLater } from '@/src/share/PageShell';

export const metadata = { title: '갤러리 · 빼빼로 시뮬레이터' };

export default function GalleryPage() {
  return (
    <Suspense fallback={<PageShell nav={{ href: '/', label: '나도 만들기' }}><p style={{ textAlign: 'center' }}>불러오는 중…</p></PageShell>}>
      <GalleryContent />
    </Suspense>
  );
}

async function GalleryContent() {
  await connection();
  let page: { items: PeperoRow[]; nextCursor?: string } | null = null;
  try {
    page = await listGallery({ sort: 'latest' });
  } catch (e) {
    console.error('[gallery] listGallery 실패', e);
  }

  return (
    <PageShell nav={{ href: '/', label: '나도 만들기' }}>
      {page ? <GalleryGrid initialItems={page.items} initialCursor={page.nextCursor} /> : <RetryLater />}
    </PageShell>
  );
}
