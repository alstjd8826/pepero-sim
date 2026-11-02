-- 빼빼로 시뮬레이터 초기 스키마. Supabase SQL Editor에서 실행.

create table public.peperos (
  id text primary key check (id ~ '^[A-Za-z0-9]{8}$'),
  nickname text not null check (char_length(btrim(nickname)) between 1 and 20),
  recipe jsonb not null,
  like_count int not null default 0,
  is_public boolean not null default true,
  hidden boolean not null default false,
  owner_id uuid null,
  created_at timestamptz not null default now(),
  -- 레시피 크기 상한 (spec 6.2): 전체 64KB, outer 3..400점, holes 최대 16개
  constraint peperos_recipe_size check (pg_column_size(recipe) <= 65536),
  constraint peperos_recipe_outer check (
    jsonb_typeof(recipe #> '{shape,silhouette,outer}') = 'array'
    and jsonb_array_length(recipe #> '{shape,silhouette,outer}') between 3 and 400
  ),
  constraint peperos_recipe_holes check (
    recipe #> '{shape,silhouette,holes}' is null
    or (
      jsonb_typeof(recipe #> '{shape,silhouette,holes}') = 'array'
      and jsonb_array_length(recipe #> '{shape,silhouette,holes}') <= 16
    )
  )
);

create index peperos_latest_idx on public.peperos (created_at desc, id desc)
  where is_public and not hidden;
create index peperos_popular_idx on public.peperos (like_count desc, created_at desc, id desc)
  where is_public and not hidden;

alter table public.peperos enable row level security;

-- 비공개 작품은 목록/필터로 열거 불가. id를 아는 경우만 get_pepero RPC로 열람.
create policy "anon can read public visible peperos"
  on public.peperos for select
  to anon
  using (is_public and not hidden);

create policy "anon can insert fresh peperos"
  on public.peperos for insert
  to anon
  with check (like_count = 0 and hidden = false and owner_id is null);

-- update/delete 정책 없음 = anon 불가
-- insert는 컬럼 단위로만 허용 (created_at, like_count 등 임의 지정 차단)
revoke insert on public.peperos from anon;
grant insert (id, nickname, recipe, is_public) on public.peperos to anon;

create or replace function public.get_pepero(p_id text)
returns setof public.peperos
language sql
stable
security definer
set search_path = public
as $$
  select * from public.peperos where id = p_id and not hidden;
$$;

revoke all on function public.get_pepero(text) from public;
grant execute on function public.get_pepero(text) to anon;

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
