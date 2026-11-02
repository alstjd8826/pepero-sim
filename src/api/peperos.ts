import type { SupabaseClient } from '@supabase/supabase-js';
import { parseRecipe, type PeperoRecipe } from '@/src/recipe/types';
import { validateNickname } from '@/src/lib/nickname';
import { getSupabase } from './supabase';

export type PeperoRow = {
  id: string;
  nickname: string;
  recipe: PeperoRecipe;
  thumbnailUrl: string;
  likeCount: number;
  createdAt: string;
};

type DbRow = {
  id: string;
  nickname: string;
  recipe: unknown;
  like_count: number;
  created_at: string;
};

const BUCKET = 'thumbnails';
const ID_LENGTH = 8;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_INSERT_ATTEMPTS = 3;
export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 48;

/** 8자 base62. 62*4=248 미만 바이트만 사용(rejection sampling)해 모듈로 편향을 피한다. */
export function generateId(): string {
  let out = '';
  while (out.length < ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2));
    for (const b of bytes) {
      if (b < 248 && out.length < ID_LENGTH) out += BASE62[b % 62];
    }
  }
  return out;
}

function thumbnailUrlOf(client: SupabaseClient, id: string): string {
  return client.storage.from(BUCKET).getPublicUrl(`${id}.png`).data.publicUrl;
}

function toRow(r: DbRow, client: SupabaseClient): PeperoRow | null {
  try {
    return {
      id: r.id,
      nickname: r.nickname,
      recipe: parseRecipe(r.recipe),
      thumbnailUrl: thumbnailUrlOf(client, r.id),
      likeCount: r.like_count,
      createdAt: r.created_at,
    };
  } catch (e) {
    console.warn(`[peperos] recipe 파싱 실패, 건너뜀: ${r.id}`, e);
    return null;
  }
}

function isStorageConflict(e: { message?: string; statusCode?: string | number }): boolean {
  return String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message ?? '');
}

export async function savePepero(
  input: { nickname: string; recipe: PeperoRecipe; thumbnail: Blob; isPublic: boolean },
  client: SupabaseClient = getSupabase(),
): Promise<{ id: string }> {
  const nick = validateNickname(input.nickname);
  if (!nick.ok) throw new Error(`닉네임이 올바르지 않습니다: ${nick.reason}`);
  const recipe = parseRecipe(input.recipe);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const id = generateId();
    const path = `${id}.png`;
    const up = await client.storage
      .from(BUCKET)
      .upload(path, input.thumbnail, { contentType: 'image/png', upsert: false });
    if (up.error) {
      // id 충돌은 보통 여기(스토리지 409 Duplicate)에서 먼저 드러난다.
      if (isStorageConflict(up.error)) {
        lastError = up.error;
        continue;
      }
      throw new Error(up.error.message);
    }

    const { error } = await client.from('peperos').insert({
      id,
      nickname: nick.value,
      recipe,
      is_public: input.isPublic,
    });
    if (!error) return { id };
    // 업로드는 통과했지만 insert 단계에서 id가 충돌한 경우(드묾)도 새 id로 재시도.
    if (error.code !== '23505') throw new Error(error.message);
    lastError = error;
  }
  throw new Error(
    `id 충돌로 저장하지 못했습니다: ${(lastError as { message?: string })?.message ?? ''}`,
  );
}

export async function getPepero(
  id: string,
  client: SupabaseClient = getSupabase(),
): Promise<PeperoRow | null> {
  const { data, error } = await client.rpc('get_pepero', { p_id: id });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as DbRow | null | undefined;
  if (!row) return null;
  return toRow(row, client);
}

type Cursor = { c: string; i: string; l?: number };

function encodeCursor(c: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(s: string, sort: 'latest' | 'popular'): Cursor {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const c = JSON.parse(new TextDecoder().decode(bytes)) as Cursor;
    const ok =
      typeof c.c === 'string' &&
      typeof c.i === 'string' &&
      (sort === 'latest' || Number.isInteger(c.l));
    if (!ok) throw new Error('shape');
    return c;
  } catch {
    throw new Error('잘못된 커서입니다.');
  }
}

const q = (v: string) => `"${v.replace(/["\\]/g, '')}"`;

export async function listGallery(
  opts: { sort: 'latest' | 'popular'; cursor?: string; limit?: number },
  client: SupabaseClient = getSupabase(),
): Promise<{ items: PeperoRow[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  let query = client
    .from('peperos')
    .select('*')
    .eq('is_public', true)
    .eq('hidden', false);

  if (opts.sort === 'popular') {
    query = query
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
  }

  if (opts.cursor) {
    const cur = decodeCursor(opts.cursor, opts.sort);
    const c = q(cur.c);
    const i = q(cur.i);
    query =
      opts.sort === 'popular'
        ? query.or(
            `like_count.lt.${cur.l},and(like_count.eq.${cur.l},created_at.lt.${c}),` +
              `and(like_count.eq.${cur.l},created_at.eq.${c},id.lt.${i})`,
          )
        : query.or(`created_at.lt.${c},and(created_at.eq.${c},id.lt.${i})`);
  }

  const { data, error } = await query.limit(limit + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbRow[];
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const items = page.map((r) => toRow(r, client)).filter((r): r is PeperoRow => r !== null);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ c: last.created_at, i: last.id, l: last.like_count })
        : undefined,
  };
}

export async function likePepero(
  id: string,
  client: SupabaseClient = getSupabase(),
): Promise<number> {
  const { data, error } = await client.rpc('like_pepero', { p_id: id });
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('빼빼로를 찾을 수 없습니다.');
  return data;
}
