import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import { getPepero, type PeperoRow } from '@/src/api/peperos';
import { LikeButton } from '@/src/share/LikeButton';
import { PageShell, RetryLater } from '@/src/share/PageShell';
import { PeperoViewerLoader } from '@/src/share/PeperoViewerLoader';
import styles from '@/src/share/share.module.css';

export const metadata = { title: '빼빼로 보기 · 빼빼로 시뮬레이터' };

export default function ViewPage({ params }: PageProps<'/p/[id]'>) {
  return (
    <Suspense fallback={<PageShell nav={{ href: '/gallery', label: '갤러리' }}><p className={styles.loading}>불러오는 중…</p></PageShell>}>
      <ViewContent params={params} />
    </Suspense>
  );
}

async function ViewContent({ params }: { params: PageProps<'/p/[id]'>['params'] }) {
  // 요청 시점에만 데이터를 가져온다 (빌드 시 prerender 금지, 좋아요 수·숨김 처리가 즉시 반영)
  await connection();
  const { id } = await params;

  let row: PeperoRow | null = null;
  let failed = false;
  try {
    row = await getPepero(id);
  } catch (e) {
    console.error('[p/[id]] getPepero 실패', e);
    failed = true;
  }
  if (!failed && !row) notFound();

  return (
    <PageShell nav={{ href: '/gallery', label: '갤러리' }}>
      {row ? (
        <>
          <div className={styles.stage}>
            <PeperoViewerLoader recipe={row.recipe} />
          </div>
          <section className={styles.info}>
            <h2 className={styles.nickname}>{row.nickname}의 빼빼로</h2>
            <div className={styles.actions}>
              <LikeButton id={row.id} initialCount={row.likeCount} />
              <Link href="/" className={styles.cta}>
                나도 만들기
              </Link>
            </div>
          </section>
        </>
      ) : (
        <RetryLater />
      )}
    </PageShell>
  );
}
