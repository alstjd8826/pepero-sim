'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './ShareButtons.module.css';

const noopSubscribe = () => () => {};
const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** 링크 복사 + (지원하면) 기기 공유 시트. 서버 렌더에서는 공유 버튼을 숨긴다. */
export function ShareButtons({ url }: { url: string }) {
  const shareable = useSyncExternalStore(noopSubscribe, canNativeShare, () => false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없으면 직접 복사할 수 있게 선택해 둔다
      setCopyFailed(true);
      inputRef.current?.select();
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: '빼빼로 시뮬레이터', text: '내가 만든 빼빼로 보러 와!', url });
    } catch {
      // 사용자가 공유 시트를 닫은 경우 등 — 무시
    }
  };

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        className={styles.url}
        value={url}
        readOnly
        aria-label="공유 링크"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={copy}>
          {copied ? '복사됐어요' : '링크 복사'}
        </button>
        {shareable && (
          <button type="button" className={styles.button} onClick={share}>
            공유하기
          </button>
        )}
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {copied ? '링크가 복사됐어요' : copyFailed ? '자동 복사가 안 돼요. 위 링크를 길게 눌러 복사해 주세요.' : ''}
      </p>
    </div>
  );
}
