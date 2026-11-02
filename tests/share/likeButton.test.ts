import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLiked, markLiked } from '@/src/share/likedStore';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('likedStore', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('markLiked 후 hasLiked 는 true, 다른 id 는 false', () => {
    expect(hasLiked('abc12345')).toBe(false);
    markLiked('abc12345');
    expect(hasLiked('abc12345')).toBe(true);
    expect(hasLiked('zzz99999')).toBe(false);
  });

  it('키는 pepero:liked:{id}', () => {
    const ls = memoryStorage();
    vi.stubGlobal('window', { localStorage: ls });
    markLiked('abc12345');
    expect(ls.getItem('pepero:liked:abc12345')).toBe('1');
  });

  it('localStorage 접근이 throw 해도 hasLiked 는 false, markLiked 는 throw 안 함', () => {
    const boom = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('window', {
      get localStorage() {
        return boom();
      },
    });
    expect(hasLiked('abc12345')).toBe(false);
    expect(() => markLiked('abc12345')).not.toThrow();
  });

  it('getItem/setItem 이 throw 해도 안전', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } });
    expect(hasLiked('a')).toBe(false);
    expect(() => markLiked('a')).not.toThrow();
  });
});
