import { beforeEach, describe, expect, it, vi } from 'vitest';

const { removeBackground, fileToImageData, blobToImageData, imageDataToBlob } = vi.hoisted(() => ({
  removeBackground: vi.fn(),
  fileToImageData: vi.fn(),
  blobToImageData: vi.fn(),
  imageDataToBlob: vi.fn(),
}));
vi.mock('@imgly/background-removal', () => ({ removeBackground }));
vi.mock('@/src/silhouette/decode', () => ({ fileToImageData, blobToImageData, imageDataToBlob }));

import { computeScaledSize, imageToSilhouette } from '@/src/silhouette/pipeline';

function rgba(w: number, h: number, alpha: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 200;
      data[i + 3] = alpha(x, y);
    }
  return { width: w, height: h, data } as unknown as ImageData;
}
const disc = (x: number, y: number) => ((x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2 ? 255 : 0);
const file = new Blob(['x']) as File;

beforeEach(() => {
  vi.clearAllMocks();
  imageDataToBlob.mockResolvedValue(new Blob(['png']));
});

describe('imageToSilhouette', () => {
  it('(a) 알파가 있으면 배경제거를 호출하지 않는다', async () => {
    fileToImageData.mockResolvedValue(rgba(64, 64, disc));
    const r = await imageToSilhouette(file);
    expect(removeBackground).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('(b) 알파가 없으면 배경제거를 1회 호출하고 그 결과를 쓴다', async () => {
    fileToImageData.mockResolvedValue(rgba(64, 64, () => 255));
    removeBackground.mockResolvedValue(new Blob(['out']));
    blobToImageData.mockResolvedValue(rgba(64, 64, disc));
    const progress = vi.fn();
    const r = await imageToSilhouette(file, progress);
    expect(removeBackground).toHaveBeenCalledTimes(1);
    expect(blobToImageData).toHaveBeenCalledWith(expect.anything(), 64, 64);
    expect(r.ok).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('(c) 완전 투명 결과면 not-found', async () => {
    fileToImageData.mockResolvedValue(rgba(64, 64, () => 255));
    removeBackground.mockResolvedValue(new Blob(['out']));
    blobToImageData.mockResolvedValue(rgba(64, 64, () => 0));
    expect(await imageToSilhouette(file)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('(e) 흰 단색 배경 일러스트는 배경제거 모델 없이 가장자리 채우기로 찾는다', async () => {
    // 흰 배경 + 크림색 원 (알파 없음)
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const inside = (x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2;
        data.set(inside ? [255, 242, 217, 255] : [255, 255, 255, 255], i);
      }
    fileToImageData.mockResolvedValue({ width: 64, height: 64, data } as unknown as ImageData);
    const r = await imageToSilhouette(file);
    expect(removeBackground).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('디코드 실패는 load-failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fileToImageData.mockRejectedValue(new Error('bad'));
    expect(await imageToSilhouette(file)).toEqual({ ok: false, reason: 'load-failed' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('배경제거 실패는 load-failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fileToImageData.mockResolvedValue(rgba(64, 64, () => 255));
    removeBackground.mockRejectedValue(new Error('net'));
    expect(await imageToSilhouette(file)).toEqual({ ok: false, reason: 'load-failed' });
    warn.mockRestore();
  });
});

describe('computeScaledSize', () => {
  it('(d) 6000x4000 → 1024x683', () => {
    expect(computeScaledSize(6000, 4000, 1024)).toEqual({ width: 1024, height: 683 });
  });
  it('세로가 길면 세로 기준', () => {
    expect(computeScaledSize(4000, 6000, 1024)).toEqual({ width: 683, height: 1024 });
  });
  it('작은 이미지는 긴 변 1024 까지 키운다', () => {
    expect(computeScaledSize(300, 200, 1024)).toEqual({ width: 1024, height: 683 });
    expect(computeScaledSize(256, 256, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(computeScaledSize(1024, 500, 1024)).toEqual({ width: 1024, height: 500 });
  });
});
