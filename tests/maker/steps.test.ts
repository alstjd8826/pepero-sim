import { describe, expect, it } from 'vitest';
import {
  MAX_THUMBNAIL_BYTES,
  containRect,
  makerSteps,
  nextStep,
  prevStep,
  thumbnailSizes,
} from '@/src/maker/steps';

describe('makerSteps', () => {
  it('upload → shape → dip → decorate → finish 순서', () => {
    expect(makerSteps).toEqual(['upload', 'shape', 'dip', 'decorate', 'finish']);
  });

  it('nextStep: 마지막 다음은 null', () => {
    expect(nextStep('upload')).toBe('shape');
    expect(nextStep('shape')).toBe('dip');
    expect(nextStep('dip')).toBe('decorate');
    expect(nextStep('decorate')).toBe('finish');
    expect(nextStep('finish')).toBeNull();
  });

  it('prevStep: 처음 이전은 null', () => {
    expect(prevStep('upload')).toBeNull();
    expect(prevStep('shape')).toBe('upload');
    expect(prevStep('dip')).toBe('shape');
    expect(prevStep('decorate')).toBe('dip');
    expect(prevStep('finish')).toBe('decorate');
  });
});

describe('thumbnail helpers', () => {
  it('300KB 상한', () => {
    expect(MAX_THUMBNAIL_BYTES).toBe(300 * 1024);
  });

  it('300KB 초과 시 384 → 256 순서로 줄여 다시 시도', () => {
    expect(thumbnailSizes(512)).toEqual([512, 384, 256]);
    expect(thumbnailSizes(384)).toEqual([384, 256]);
    expect(thumbnailSizes(256)).toEqual([256]);
  });

  it('containRect: 정사각형 안에 비율 유지·가운데 정렬', () => {
    expect(containRect(1000, 500, 512)).toEqual({ x: 0, y: 128, w: 512, h: 256 });
    expect(containRect(300, 600, 512)).toEqual({ x: 128, y: 0, w: 256, h: 512 });
    expect(containRect(512, 512, 512)).toEqual({ x: 0, y: 0, w: 512, h: 512 });
  });
});
