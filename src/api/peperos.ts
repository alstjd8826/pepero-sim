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
  thumbnail_url: string;
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

function toRow(r: DbRow): PeperoRow | null {
  try {
    return {
      id: r.id,
      nickname: r.nickname,
      recipe: parseRecipe(r.recipe),
      thumbnailUrl: r.thumbnail_url,
      likeCount: r.like_count,
      createdAt: r.created_at,
    };
  } catch (e) {
    console.warn(`[peperos] recipe 파싱 실패, 건너뜀: ${r.id}`, e);
    return null;
  }
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
    if (up.error) throw new Error(up.error.message);
    const thumbnailUrl = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const { error } = await client.from('peperos').insert({
      id,
      nickname: nick.value,
      recipe,
      thumbnail_url: thumbnailUrl,
      is_public: input.isPublic,
    });
    if (!error) return { id };
    // 업로드가 upsert:false 라 id 충돌은 보통 업로드 단계에서 먼저 걸리지만, insert 단계 충돌도 재시도한다.
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
  const { data, error } = await client
    .from('peperos')
    .select('*')
    .eq('id', id)
    .eq('hidden', false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return toRow(data as DbRow);
}

type Cursor = { c: string; i: string; l?: number };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(s: string, sort: 'latest' | 'popular'): Cursor {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
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
  const items = page.map(toRow).filter((r): r is PeperoRow => r !== null);
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
