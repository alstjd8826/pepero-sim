'use client';

import dynamic from 'next/dynamic';
import type { PeperoRecipe } from '@/src/recipe/types';
import styles from './share.module.css';

const PeperoViewer = dynamic(() => import('./PeperoViewer'), {
  ssr: false,
  loading: () => <p className={styles.loading}>3D 불러오는 중…</p>,
});

export function PeperoViewerLoader({ recipe }: { recipe: PeperoRecipe }) {
  return <PeperoViewer recipe={recipe} />;
}
