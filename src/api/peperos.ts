import type { SupabaseClient } from '@supabase/supabase-js';
import { parseRecipe, type PeperoRecipe } from '@/src/recipe/types';
import { validateNickname } from '@/src/lib/nickname';
import { RELIEF_BUCKET, reliefKeyFor } from '@/src/recipe/relief';
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

/** reliefs 버킷 업로드 실패 경고는 세션당 한 번만 (0002 마이그레이션 미적용 등) */
let reliefWarned = false;

/**
 * 저장 순서: 썸네일 `thumbnails/{id}.png` → (각인이 있으면) `reliefs/{id}.png` → insert. 같은 id 를 쓴다.
 * - 각인은 `relief` 로만 받는다. 입력 레시피에 섞여 온 shape.relief 는 버리고 이번 업로드 결과로 채운다
 *   (DB CHECK 가 키 = `reliefs/{id}.png` 를 요구).
 * - 각인 업로드가 409 가 아닌 이유로 실패하면(버킷 없음 등) 경고만 하고 각인 없이 저장한다.
 *   썸네일 업로드 실패는 이전처럼 저장 실패.
 */
export async function savePepero(
  input: {
    nickname: string;
    recipe: PeperoRecipe;
    thumbnail: Blob;
    isPublic: boolean;
    /** 앞면 각인 높이맵 PNG. strength 0 이면 무시 */
    relief?: { png: Blob; strength: number };
  },
  client: SupabaseClient = getSupabase(),
): Promise<{ id: string }> {
  const nick = validateNickname(input.nickname);
  if (!nick.ok) throw new Error(`닉네임이 올바르지 않습니다: ${nick.reason}`);
  const parsed = parseRecipe(input.recipe);
  const { relief: _ignored, ...plainShape } = parsed.shape;
  void _ignored;
  const strength = input.relief ? Math.min(1, Math.max(0, input.relief.strength)) : 0;
  const reliefPng = strength > 0 ? input.relief?.png : undefined;

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

    let shape: PeperoRecipe['shape'] = plainShape;
    if (reliefPng) {
      const rel = await client.storage
        .from(RELIEF_BUCKET)
        .upload(path, reliefPng, { contentType: 'image/png', upsert: false });
      if (!rel.error) {
        shape = { ...plainShape, relief: { heightmapUrl: reliefKeyFor(id), strength } };
      } else if (isStorageConflict(rel.error)) {
        lastError = rel.error;
        continue;
      } else if (!reliefWarned) {
        reliefWarned = true;
        console.warn('[peperos] 각인 업로드 실패, 각인 없이 저장합니다', rel.error);
      }
    }

    const { error } = await client.from('peperos').insert({
      id,
      nickname: nick.value,
      recipe: { ...parsed, shape },
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
