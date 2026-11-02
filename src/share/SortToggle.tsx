import Link from 'next/link';
import type { GallerySort } from './meta';
import styles from './share.module.css';

const OPTIONS: { value: GallerySort; label: string; href: string }[] = [
  { value: 'latest', label: '최신순', href: '/gallery' },
  { value: 'popular', label: '인기순', href: '/gallery?sort=popular' },
];

/** 갤러리 정렬 토글. 주소(?sort=)로 상태를 들고 있어서 공유·뒤로가기에도 유지된다. */
export function SortToggle({ sort }: { sort: GallerySort }) {
  return (
    <nav className={styles.sortToggle} aria-label="정렬">
      {OPTIONS.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          className={styles.sortOption}
          aria-current={o.value === sort ? 'page' : undefined}
          scroll={false}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
