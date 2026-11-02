import { describe, expect, it } from 'vitest';
import { validateNickname } from '@/src/lib/nickname';

describe('validateNickname', () => {
  it('빈 문자열/공백은 empty', () => {
    expect(validateNickname('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateNickname('')).toEqual({ ok: false, reason: 'empty' });
  });
  it('21자는 too-long, 20자는 ok', () => {
    expect(validateNickname('가'.repeat(21))).toEqual({ ok: false, reason: 'too-long' });
    expect(validateNickname('가'.repeat(20)).ok).toBe(true);
  });
  it('금칙어는 banned (소문자화·공백 제거 후 비교)', () => {
    expect(validateNickname('씨발')).toEqual({ ok: false, reason: 'banned' });
    expect(validateNickname('F u C k')).toEqual({ ok: false, reason: 'banned' });
  });
  it('trim 후 ok', () => {
    expect(validateNickname(' 꾸그 ')).toEqual({ ok: true, value: '꾸그' });
  });
});
