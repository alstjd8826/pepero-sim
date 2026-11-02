// 브라우저 전용 디코딩. 노드 테스트에서는 이 모듈을 vi.mock 한다.
import { computeScaledSize } from './scale';

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function draw(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const ctx = makeCanvas(width, height).getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** 파일을 디코드하고 긴 변 maxSide 이하로 줄여 ImageData로 돌려준다. */
export async function fileToImageData(file: Blob, maxSide = 1024): Promise<ImageData> {
  // 일부 브라우저 기본값이 'none'이라 세로 사진이 눕는 걸 막기 위해 명시한다.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = computeScaledSize(bitmap.width, bitmap.height, maxSide);
    return draw(bitmap, width, height);
  } finally {
    bitmap.close();
  }
}

/** 배경제거 입력용 PNG Blob. */
export async function imageDataToBlob(img: ImageData): Promise<Blob> {
  const canvas = makeCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2d context unavailable');
  ctx.putImageData(img, 0, 0);
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

/** imgly 출력(PNG)을 지정 크기 ImageData로 되읽는다. */
export async function blobToImageData(blob: Blob, width: number, height: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  try {
    return draw(bitmap, width, height);
  } finally {
    bitmap.close();
  }
}
