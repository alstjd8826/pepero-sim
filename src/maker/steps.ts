import type { WebGLRenderer } from 'three';

export type StepId = 'upload' | 'shape' | 'dip' | 'finish';

export const makerSteps: StepId[] = ['upload', 'shape', 'dip', 'finish'];

export function nextStep(id: StepId): StepId | null {
  const i = makerSteps.indexOf(id);
  return makerSteps[i + 1] ?? null;
}

export function prevStep(id: StepId): StepId | null {
  const i = makerSteps.indexOf(id);
  return i > 0 ? makerSteps[i - 1] : null;
}

export const MAX_THUMBNAIL_BYTES = 300 * 1024;
const FALLBACK_SIZE = 384;

/** 썸네일을 시도할 크기 순서. 첫 크기가 300KB 를 넘으면 384 로 한 번 더. */
export function thumbnailSizes(size: number): number[] {
  return size > FALLBACK_SIZE ? [size, FALLBACK_SIZE] : [size];
}

/** sw×sh 를 size×size 정사각형 안에 비율 유지(contain)·가운데 정렬로 넣을 사각형. */
export function containRect(sw: number, sh: number, size: number) {
  const scale = Math.min(size / sw, size / sh);
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), w, h };
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('썸네일 PNG 변환 실패'))), 'image/png');
  });
}

/**
 * 현재 그려진 WebGL 캔버스를 size×size PNG 로 캡처한다.
 * 호출 직전에 gl.render 를 했거나 `preserveDrawingBuffer: true` 여야 내용이 남아 있다.
 */
export async function captureThumbnail(gl: WebGLRenderer, size = 512): Promise<Blob> {
  const src = gl.domElement;
  // 비동기 toBlob 사이에 다음 프레임이 그려지지 않도록 먼저 전부 동기적으로 복사해 둔다.
  const copies = thumbnailSizes(size).map((s) => {
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    const r = containRect(src.width, src.height, s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
    return canvas;
  });
  let blob: Blob | null = null;
  for (const canvas of copies) {
    blob = await toPngBlob(canvas);
    if (blob.size <= MAX_THUMBNAIL_BYTES) return blob;
  }
  return blob!;
}
