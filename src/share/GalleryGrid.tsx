'use client';

import { useState } from 'react';
import Link from 'next/link';
import { listGallery, type PeperoRow } from '@/src/api/peperos';
import styles from './share.module.css';

type Props = { initialItems: PeperoRow[]; initialCursor?: string; sort?: 'latest' | 'popular' };

export function GalleryGrid({ initialItems, initialCursor, sort = 'latest' }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const more = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(false);
    try {
      const page = await listGallery({ sort, cursor });
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return <p className={styles.empty}>아직 공개된 빼빼로가 없어요. 첫 번째 주인공이 되어 보세요!</p>;
  }

  return (
    <>
      <ul className={styles.grid}>
        {items.map((it) => (
          <li key={it.id}>
            <Link href={`/p/${it.id}`} className={styles.card}>
              {/* 외부 스토리지 썸네일이라 next/image 최적화 대상이 아니다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.thumbnailUrl}
                alt={`${it.nickname}의 빼빼로`}
                loading="lazy"
                width={512}
                height={512}
                className={styles.thumb}
              />
              <span className={styles.cardMeta}>
                <span className={styles.nick}>{it.nickname}</span>
                <span className={styles.likes}>♥ {it.likeCount}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.status} role="status">
          불러오지 못했어요. 다시 시도해 주세요.
        </p>
      )}
      {cursor && (
        <button type="button" className={styles.more} onClick={more} disabled={loading}>
          {loading ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </>
  );
}
