import Link from 'next/link';
import { PageShell } from '@/src/share/PageShell';
import styles from '@/src/share/share.module.css';

export default function NotFound() {
  return (
    <PageShell nav={{ href: '/gallery', label: '갤러리' }}>
      <div className={styles.errorBox}>
        <p>빼빼로를 찾을 수 없어요. 링크가 잘못됐거나 숨겨진 작품이에요.</p>
        <Link href="/" className={styles.cta}>
          나도 만들기
        </Link>
      </div>
    </PageShell>
  );
}
