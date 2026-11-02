import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './share.module.css';

/** 보기/갤러리 공통 틀: 제목(→ 홈) + 우측 링크 */
export function PageShell({
  children,
  nav,
}: {
  children: ReactNode;
  nav: { href: string; label: string };
}) {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.title}>
          빼빼로 시뮬레이터
        </Link>
        <Link href={nav.href} className={styles.navLink}>
          {nav.label}
        </Link>
      </header>
      {children}
    </main>
  );
}

export function RetryLater() {
  return (
    <div className={styles.errorBox} role="alert">
      <p>잠시 후 다시 시도해 주세요.</p>
      <Link href="/" className={styles.cta}>
        나도 만들기
      </Link>
    </div>
  );
}
