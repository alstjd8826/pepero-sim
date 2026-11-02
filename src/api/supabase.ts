import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** 환경변수에서 싱글턴 클라이언트를 지연 생성. env 누락은 호출 시점에 에러(import 시점 X). */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase 환경변수가 없습니다: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 를 .env.local 에 설정하세요.',
    );
  }
  client = createClient(url, key);
  return client;
}
