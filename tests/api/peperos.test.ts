import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRecipe } from '@/src/recipe/defaults';
import {
  generateId,
  getPepero,
  likePepero,
  listGallery,
  savePepero,
} from '@/src/api/peperos';

type Call = { op: string; args: unknown[] };

/** 체인 가능한 thenable 쿼리 빌더 가짜. */
function fakeClient(opts: {
  insertResults?: Array<{ error: { code?: string; message: string } | null }>;
  uploadError?: { message: string } | null;
  selectRows?: unknown[];
  single?: unknown;
  rpc?: { data: unknown; error: unknown };
} = {}) {
  const calls: Call[] = [];
  const log = (op: string, ...args: unknown[]) => calls.push({ op, args });
  const inserts = [...(opts.insertResults ?? [])];
  const builder = (kind: 'select' | 'insert') => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'or']) {
      b[m] = (...a: unknown[]) => {
        log(m, ...a);
        return b;
      };
    }
    b.maybeSingle = async () => ({ data: opts.single ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(
        kind === 'insert'
          ? inserts.shift() ?? { error: null }
          : { data: opts.selectRows ?? [], error: null },
      ).then(res);
    return b;
  };
  const client = {
    from: (t: string) => {
      log('from', t);
      return {
        insert: (row: unknown) => {
          log('insert', row);
          return builder('insert');
        },
        select: (...a: unknown[]) => {
          log('select', ...a);
          return builder('select');
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, blob: unknown, o: unknown) => {
          log('upload', bucket, path, blob, o);
          return { error: opts.uploadError ?? null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/${bucket}/${path}` },
        }),
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      log('rpc', fn, args);
      return opts.rpc ?? { data: 1, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const recipe = createRecipe({ outer: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]] }, true);
const row = (i: number, extra = {}) => ({
  id: `id${String(i).padStart(6, '0')}`,
  nickname: 'n',
  recipe,
  thumbnail_url: 'u',
  like_count: 10 - i,
  created_at: `2026-11-02T00:00:0${i}+00:00`,
  ...extra,
});
const blob = new Blob(['x'], { type: 'image/png' });

describe('generateId', () => {
  it('8자 base62', () => {
    for (let i = 0; i < 200; i++) expect(generateId()).toMatch(/^[A-Za-z0-9]{8}$/);
  });
});

describe('savePepero', () => {
  it('upload 후 insert 순서, upsert:false', async () => {
    const { client, calls } = fakeClient();
    const { id } = await savePepero(
      { nickname: ' 꾸그 ', recipe, thumbnail: blob, isPublic: true },
      client,
    );
    const ops = calls.map((c) => c.op).filter((o) => o === 'upload' || o === 'insert');
    expect(ops).toEqual(['upload', 'insert']);
    const up = calls.find((c) => c.op === 'upload')!;
    expect(up.args[0]).toBe('thumbnails');
    expect(up.args[1]).toBe(`${id}.png`);
    expect(up.args[3]).toMatchObject({ upsert: false, contentType: 'image/png' });
    const ins = calls.find((c) => c.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(ins).toMatchObject({
      id,
      nickname: '꾸그',
      is_public: true,
      thumbnail_url: `https://x.supabase.co/thumbnails/${id}.png`,
    });
  });

  it('잘못된 닉네임이면 throw, 업로드 안 함', async () => {
    const { client, calls } = fakeClient();
    await expect(
      savePepero({ nickname: ' ', recipe, thumbnail: blob, isPublic: true }, client),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('잘못된 recipe면 throw, 업로드 안 함', async () => {
    const { client, calls } = fakeClient();
    await expect(
      savePepero(
        { nickname: 'a', recipe: { bad: 1 } as never, thumbnail: blob, isPublic: true },
        client,
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('23505면 새 id로 재시도 (최대 3회)', async () => {
    const dup = { error: { code: '23505', message: 'dup' } };
    const { client, calls } = fakeClient({ insertResults: [dup, dup, { error: null }] });
    await savePepero({ nickname: 'a', recipe, thumbnail: blob, isPublic: false }, client);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(3);
    const ids = calls.filter((c) => c.op === 'insert').map((c) => (c.args[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(3);
  });

  it('23505가 3회 연속이면 에러', async () => {
    const dup = { error: { code: '23505', message: 'dup' } };
    const { client, calls } = fakeClient({ insertResults: [dup, dup, dup, dup] });
    await expect(
      savePepero({ nickname: 'a', recipe, thumbnail: blob, isPublic: false }, client),
    ).rejects.toThrow();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(3);
  });

  it('다른 insert 에러는 즉시 throw', async () => {
    const { client, calls } = fakeClient({ insertResults: [{ error: { message: 'boom' } }] });
    await expect(
      savePepero({ nickname: 'a', recipe, thumbnail: blob, isPublic: false }, client),
    ).rejects.toThrow('boom');
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('업로드 실패면 insert 안 함', async () => {
    const { client, calls } = fakeClient({ uploadError: { message: 'up' } });
    await expect(
      savePepero({ nickname: 'a', recipe, thumbnail: blob, isPublic: false }, client),
    ).rejects.toThrow('up');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('getPepero', () => {
  it('camelCase 매핑', async () => {
    const { client } = fakeClient({ single: row(1) });
    const r = await getPepero('id000001', client);
    expect(r).toEqual({
      id: 'id000001',
      nickname: 'n',
      recipe,
      thumbnailUrl: 'u',
      likeCount: 9,
      createdAt: '2026-11-02T00:00:01+00:00',
    });
  });
  it('없으면 null', async () => {
    const { client } = fakeClient();
    expect(await getPepero('nope', client)).toBeNull();
  });
  it('깨진 recipe면 null + warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeClient({ single: row(1, { recipe: { schemaVersion: 99 } }) });
    expect(await getPepero('id000001', client)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('listGallery', () => {
  it('기본 limit 24(+1 조회), is_public/hidden 필터, latest 정렬', async () => {
    const { client, calls } = fakeClient({ selectRows: [row(1)] });
    const r = await listGallery({ sort: 'latest' }, client);
    expect(r.nextCursor).toBeUndefined();
    expect(calls).toContainEqual({ op: 'eq', args: ['is_public', true] });
    expect(calls).toContainEqual({ op: 'eq', args: ['hidden', false] });
    expect(calls.filter((c) => c.op === 'order').map((c) => c.args[0])).toEqual(['created_at', 'id']);
    expect(calls.find((c) => c.op === 'limit')!.args[0]).toBe(25);
  });

  it('limit 최대 48', async () => {
    const { client, calls } = fakeClient();
    await listGallery({ sort: 'latest', limit: 999 }, client);
    expect(calls.find((c) => c.op === 'limit')!.args[0]).toBe(49);
  });

  it('popular 정렬 컬럼', async () => {
    const { client, calls } = fakeClient();
    await listGallery({ sort: 'popular' }, client);
    expect(calls.filter((c) => c.op === 'order').map((c) => c.args[0])).toEqual([
      'like_count',
      'created_at',
      'id',
    ]);
  });

  it('limit+1개 오면 nextCursor, 라운드트립으로 or 필터 생성', async () => {
    const rows = [row(1), row(2), row(3)];
    const a = fakeClient({ selectRows: rows });
    const r1 = await listGallery({ sort: 'latest', limit: 2 }, a.client);
    expect(r1.items).toHaveLength(2);
    expect(r1.nextCursor).toBeTruthy();
    expect(r1.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    const b = fakeClient({ selectRows: [] });
    await listGallery({ sort: 'latest', cursor: r1.nextCursor }, b.client);
    const or = b.calls.find((c) => c.op === 'or')!.args[0] as string;
    expect(or).toContain('2026-11-02T00:00:02+00:00');
    expect(or).toContain('id000002');
  });

  it('popular 커서는 like_count 포함', async () => {
    const a = fakeClient({ selectRows: [row(1), row(2)] });
    const r1 = await listGallery({ sort: 'popular', limit: 1 }, a.client);
    const b = fakeClient();
    await listGallery({ sort: 'popular', cursor: r1.nextCursor }, b.client);
    const or = b.calls.find((c) => c.op === 'or')!.args[0] as string;
    expect(or).toContain('like_count.lt.9');
  });

  it('깨진 커서는 에러', async () => {
    const { client } = fakeClient();
    await expect(listGallery({ sort: 'latest', cursor: '!!!' }, client)).rejects.toThrow();
  });

  it('깨진 recipe 행은 건너뜀', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeClient({ selectRows: [row(1, { recipe: {} }), row(2)] });
    const r = await listGallery({ sort: 'latest' }, client);
    expect(r.items.map((i) => i.id)).toEqual(['id000002']);
    warn.mockRestore();
  });
});

describe('likePepero', () => {
  it('rpc 호출 후 새 카운트 반환', async () => {
    const { client, calls } = fakeClient({ rpc: { data: 5, error: null } });
    expect(await likePepero('abc', client)).toBe(5);
    expect(calls.find((c) => c.op === 'rpc')!.args).toEqual(['like_pepero', { p_id: 'abc' }]);
  });
  it('없으면(null) 에러', async () => {
    const { client } = fakeClient({ rpc: { data: null, error: null } });
    await expect(likePepero('abc', client)).rejects.toThrow();
  });
});
