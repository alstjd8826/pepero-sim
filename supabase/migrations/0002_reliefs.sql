-- 앞면 각인 높이맵 (spec 4.2.1). Supabase SQL Editor에서 0001 다음에 실행.
-- 이 마이그레이션이 적용되기 전에도 앱은 저장된다(각인 업로드 실패 → 각인 없이 저장).

-- 각인 높이맵 버킷: 256×256 그레이 PNG (보통 수 KB). 공개 읽기, 덮어쓰기/삭제 불가.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reliefs', 'reliefs', true, 131072, array['image/png'])
on conflict (id) do nothing;

create policy "anon can upload reliefs"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'reliefs' and name ~ '^[A-Za-z0-9]{8}\.png$');
-- public 버킷이라 읽기는 정책 불필요. update/delete 정책 없음.

-- 레시피의 각인은 이 프로젝트 reliefs 버킷의, 같은 id 의 키만 허용한다(렌더러가 이 주소를 불러오므로 외부 URL 금지).
-- heightmapUrl = 'reliefs/<id>.png', strength 는 0~1 숫자. 렌더 시 공개 URL 로 바꾼다.
alter table public.peperos add constraint peperos_recipe_relief check (
  recipe #> '{shape,relief}' is null
  or (
    jsonb_typeof(recipe #> '{shape,relief}') = 'object'
    -- coalesce: 키가 없을 때 NULL 이 되어 CHECK 를 통과해 버리지 않게
    and coalesce(recipe #>> '{shape,relief,heightmapUrl}', '') = 'reliefs/' || id || '.png'
    and case
      when jsonb_typeof(recipe #> '{shape,relief,strength}') = 'number'
        then (recipe #>> '{shape,relief,strength}')::numeric between 0 and 1
      else false
    end
  )
);
