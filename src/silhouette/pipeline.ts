import type { Silhouette } from '@/src/recipe/types';
import { cleanMask, cleanedMaskToSilhouette } from './contour';
import { blobToImageData, fileToImageData, imageDataToBlob } from './decode';
import { alphaToMask, hasMeaningfulAlpha, type Mask } from './raster';

export { computeScaledSize } from './scale';

export type SilhouetteResult =
  | { ok: true; silhouette: Silhouette; mask: Mask; image: ImageData }
  | { ok: false; reason: 'not-found' | 'load-failed' };

const MAX_SIDE = 1024;

/** 업로드 파일 → 실루엣. mask(정리된 마스크)·image는 각인에서 재사용하되 저장하지 않는다. */
export async function imageToSilhouette(
  file: File,
  onProgress?: (p: number) => void,
): Promise<SilhouetteResult> {
  let last = 0;
  const report = (p: number) => {
    last = Math.max(last, Math.min(1, p));
    onProgress?.(last);
  };
  try {
    const image = await fileToImageData(file, MAX_SIDE);
    report(0.05);
    let alphaSource = image;
    if (!hasMeaningfulAlpha(image)) {
      // 모델은 배경제거가 필요할 때만 지연 로딩한다(첫 화면 번들 제외).
      const { removeBackground } = await import('@imgly/background-removal');
      const input = await imageDataToBlob(image);
      const out = await removeBackground(input, {
        progress: (key: string, current: number, total: number) => {
          const f = total > 0 ? current / total : 0;
          report(key.startsWith('fetch') ? 0.05 + 0.75 * f : 0.8 + 0.15 * f);
        },
      });
      alphaSource = await blobToImageData(out, image.width, image.height);
    }
    // 각인(extractRelief)도 실루엣과 같은 정리된 마스크를 써야 bbox 가 정확히 맞는다.
    const mask = cleanMask(alphaToMask(alphaSource));
    const silhouette = cleanedMaskToSilhouette(mask);
    report(1);
    if (!silhouette) return { ok: false, reason: 'not-found' };
    return { ok: true, silhouette, mask, image };
  } catch (e) {
    console.warn('imageToSilhouette failed', e);
    return { ok: false, reason: 'load-failed' };
  }
}
