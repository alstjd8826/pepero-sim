-- 빼빼로 시뮬레이터 초기 스키마. Supabase SQL Editor에서 실행.

create table public.peperos (
  id text primary key,
  nickname text not null check (char_length(nickname) between 1 and 20),
  recipe jsonb not null,
  thumbnail_url text,
  like_count int not null default 0,
  is_public boolean not null default true,
  hidden boolean not null default false,
  owner_id uuid null,
  created_at timestamptz not null default now()
);

create index peperos_latest_idx on public.peperos (created_at desc, id desc)
  where is_public and not hidden;
create index peperos_popular_idx on public.peperos (like_count desc, created_at desc, id desc)
  where is_public and not hidden;

alter table public.peperos enable row level security;

create policy "anon can read visible peperos"
  on public.peperos for select
  to anon
  using (hidden = false);

create policy "anon can insert fresh peperos"
  on public.peperos for insert
  to anon
  with check (like_count = 0 and hidden = false and owner_id is null);

-- update/delete 정책 없음 = anon 불가

create or replace function public.like_pepero(p_id text)
returns int
language sql
security definer
set search_path = public
as $$
  update public.peperos
     set like_count = like_count + 1
   where id = p_id and hidden = false
  returning like_count;
$$;

revoke all on function public.like_pepero(text) from public;
grant execute on function public.like_pepero(text) to anon;

-- 썸네일 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbnails', 'thumbnails', true, 307200, array['image/png'])
on conflict (id) do nothing;

create policy "anon can upload thumbnails"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'thumbnails' and name ~ '^[A-Za-z0-9]{8}\.png$');
-- public 버킷이라 읽기는 정책 불필요. update/delete 정책 없음.
