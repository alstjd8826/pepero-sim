import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import { getPepero, type PeperoRow } from '@/src/api/peperos';
import { LikeButton } from '@/src/share/LikeButton';
import { PageShell, RetryLater } from '@/src/share/PageShell';
import { PeperoViewerLoader } from '@/src/share/PeperoViewerLoader';
import { peperoMetadata } from '@/src/share/meta';
import styles from '@/src/share/share.module.css';

/** 메타데이터와 본문이 같은 요청에서 RPC 를 두 번 부르지 않게 요청 단위로 묶는다 */
const loadPepero = cache((id: string) => getPepero(id));

export async function generateMetadata({ params }: PageProps<'/p/[id]'>): Promise<Metadata> {
  await connection();
  const { id } = await params;
  try {
    return peperoMetadata(await loadPepero(id));
  } catch (e) {
    console.error('[p/[id]] 메타데이터 조회 실패', e);
    return { title: '빼빼로 보기' };
  }
}

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
    row = await loadPepero(id);
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
