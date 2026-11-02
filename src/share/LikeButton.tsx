'use client';

import { useState, useSyncExternalStore } from 'react';
import { likePepero } from '@/src/api/peperos';
import { hasLiked, markLiked } from './likedStore';
import styles from './share.module.css';

const noopSubscribe = () => () => {};

/** 낙관적 +1. 한 번 누르면 이 브라우저에서는 비활성. 실패하면 되돌리고 짧은 안내를 띄운다. */
export function LikeButton({ id, initialCount }: { id: string; initialCount: number }) {
  const likedBefore = useSyncExternalStore(noopSubscribe, () => hasLiked(id), () => false);
  const [likedNow, setLikedNow] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState(false);
  const liked = likedBefore || likedNow;

  const onClick = async () => {
    if (liked) return;
    setError(false);
    setLikedNow(true);
    setCount((c) => c + 1);
    try {
      const serverCount = await likePepero(id);
      setCount(serverCount);
      markLiked(id);
    } catch {
      setLikedNow(false);
      setCount(initialCount);
      setError(true);
    }
  };

  return (
    <div className={styles.likeWrap}>
      <button
        type="button"
        className={styles.like}
        onClick={onClick}
        disabled={liked}
        aria-pressed={liked}
      >
        <span aria-hidden="true">{liked ? '♥' : '♡'}</span> 좋아요 {count}
      </button>
      <p className={styles.status} role="status" aria-live="polite">
        {error ? '좋아요를 남기지 못했어요. 잠시 후 다시 시도해 주세요.' : ''}
      </p>
    </div>
  );
}
