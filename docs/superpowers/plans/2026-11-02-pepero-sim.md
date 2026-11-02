# 빼빼로 시뮬레이터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미지 → 실루엣 3D 쿠키 → 직접 잡고 담그는 초코 딥핑 → 저장·공유 링크·갤러리까지 되는 웹사이트를 11/10에 공개한다.

**Architecture:** 모든 빼빼로는 `PeperoRecipe` JSON 하나로 표현되고, 만들기·보기·갤러리·썸네일이 전부 같은 `<PeperoModel recipe>` 렌더 경로를 쓴다. 이미지 처리(배경제거·윤곽·각인)는 전부 브라우저에서 순수 함수 파이프라인으로 돌고, 서버(Supabase)는 레시피·썸네일·좋아요만 저장한다. 쿠키 베이스/코팅/토핑 종류는 레지스트리로 꽂는다.

**Tech Stack:** Next.js 16 (App Router, TS) · React 19 · three 0.187 · @react-three/fiber 9 · @react-three/drei 10 · @imgly/background-removal 1.7 · @supabase/supabase-js 2 · zod 4 · vitest 5 · Vercel

**Spec:** `docs/superpowers/specs/2026-11-02-pepero-sim-design.md`

## Global Constraints

- 레포 public, LICENSE = AGPL-3.0 (imgly 라이선스 때문).
- 커밋 author = alstjd8826 (another-repo includeIf로 자동). push 전 `gh auth switch --user alstjd8826`, 끝나면 `Darby22`로 복귀. **push/PR은 사용자 확인 후.**
- 원본 이미지는 어디에도 업로드·저장 금지. 저장 대상 = 폴리곤, 각인 높이맵, 썸네일만.
- 배경제거 모델은 업로드 시점에 동적 `import()` — 첫 화면 번들에 포함 금지.
- 캔버스는 `touch-action: none`. 모바일에서 드래그 중 페이지 스크롤/줌 금지.
- 쿠키는 기울이지 않는다. 담그는 축 = 모델 로컬 +Y의 반대(아래).
- 닉네임 1~20자. 폴리곤 outer 점 ≤ 400개. 썸네일 512×512 PNG, ≤ 300KB.
- 렌더러는 `schemaVersion`으로 분기, 저장된 구버전 레시피는 항상 열려야 함.
- UI 문구는 한국어.

### 좌표·치수 규약 (모든 3D 태스크 공통)
- 장면 단위 1 = 1cm 감각. 모델 로컬 원점 = **담그는 끝(가장 아래 점)**, 모델은 +Y로 뻗음.
- 막대 ON: 막대 반지름 0.18, 길이 4.0 (y 0~4.0). 실루엣 최대 치수 2.0, 실루엣 아래 가장자리 중앙이 y=3.8에 오도록(막대가 0.2 박힘).
- 막대 OFF: 실루엣 최대 치수 3.6, 실루엣 최저점이 y=0.
- 쿠키 두께 0.3, 베벨 0.06. 정규화 실루엣 좌표는 최대 치수 1, 중심 (0,0), y 위쪽.
- 코팅 평면: `normal=[0,-1,0]`, `offset=-depth` → `dot(n,p) >= offset` 즉 `p.y <= depth`인 곳이 코팅.

## Review Focus

1. 휴대폰 원본 사진(6000×4000, 10MB) 업로드 → 먼저 긴 변 1024px로 줄여 처리, 탭이 멈추지 않음. (Task 3)
2. 배경제거 결과가 비었거나 아주 작은 조각뿐인 이미지 → "캐릭터를 찾지 못했어요" 안내, 크래시 없음. (Task 3)
3. 캐릭터 + 떨어진 글자/효과가 섞인 이미지 → 가장 큰 덩어리만 쿠키가 되고 폴리곤은 자기교차 없이 유효. (Task 2)
4. 쿠키를 아주 빠르게 휙 담갔다 빼기(이벤트 사이에 표면 통과) → 포인터가 도달한 최저점까지 코팅됨. (Task 6)
5. 없는 id·숨김 처리된 id로 `/p/[id]` 접속 → 404 화면, 갤러리에도 안 보임. (Task 9)

---

## 파일 구조

```
app/layout.tsx, app/globals.css
app/page.tsx                    만들기 (MakerFlow)
app/p/[id]/page.tsx             보기 + generateMetadata(OG)
app/p/[id]/not-found.tsx
app/gallery/page.tsx            갤러리
src/recipe/types.ts             PeperoRecipe 타입 + zod 스키마 + 상수
src/recipe/defaults.ts          createRecipe(silhouette, hasStick)
src/silhouette/raster.ts        downscale, alpha 감지, 이진화, 모폴로지, 최대 덩어리
src/silhouette/contour.ts       marching squares → 폴리곤
src/silhouette/simplify.ts      DP 단순화, Chaikin, normalize
src/silhouette/pipeline.ts      imageToSilhouette(file) (imgly 동적 import)
src/silhouette/relief.ts        (P1) extractRelief
src/three/registry.ts           base / coating 레지스트리
src/three/cookieGeometry.ts     buildCookieGeometry
src/three/coatingMaterial.ts    코팅 셰이더 머티리얼
src/three/PeperoModel.tsx       <PeperoModel recipe />
src/dip/dipState.ts             순수 딥핑 상태 로직
src/dip/DipScene.tsx            초코 통 + 드래그
src/maker/steps.ts              단계 배열
src/maker/MakerFlow.tsx         업로드→모양→딥핑→완성
src/api/supabase.ts             클라이언트 생성
src/api/peperos.ts              save/get/list/like
src/lib/nickname.ts             닉네임 검증·금칙어
src/share/ShareButtons.tsx
supabase/migrations/0001_init.sql
tests/**                        vitest (src와 같은 구조)
```

---

## P0 (11/7 목표)

### Task 1: 프로젝트 골격 + 레시피 타입

**Files:**
- Create: Next.js 앱 골격(`create-next-app` TS·App Router·src 디렉터리 없음 옵션, `src/`는 수동), `LICENSE`(AGPL-3.0), `vitest.config.ts`, `.gitignore`(`.env*`, `.superpowers/`)
- Create: `src/recipe/types.ts`, `src/recipe/defaults.ts`
- Test: `tests/recipe/types.test.ts`

**Interfaces:**
- Produces:
  - `type Vec2 = [number, number]`
  - `type Silhouette = { outer: Vec2[]; holes?: Vec2[][] }`
  - `type PeperoRecipe` (스펙 6.1 그대로, `shape.relief?: { heightmapUrl: string; strength: number }` 포함)
  - `type BaseKind = 'stick' | 'none'`, `type CoatingType = 'milk-choco'`, `type Coating = PeperoRecipe['coatings'][number]`
  - `const recipeSchema: z.ZodType<PeperoRecipe>` (outer 3~400점, coatings ≤ 50)
  - `parseRecipe(json: unknown): PeperoRecipe` — 실패 시 throw
  - `createRecipe(silhouette: Silhouette, hasStick: boolean): PeperoRecipe` — `schemaVersion:1, thickness:0.3, cookieFlavor:'plain', coatings:[], toppings:[]`

- [ ] **Step 1:** `npx create-next-app@16 pepero-sim-tmp --ts --app --eslint --no-tailwind --import-alias "@/*"` 결과를 현재 레포 루트로 옮기고 deps 설치: `three @react-three/fiber @react-three/drei @imgly/background-removal @supabase/supabase-js zod`, dev: `vitest @types/three jsdom`. `package.json`에 `"test": "vitest run"`.
- [ ] **Step 2: 실패 테스트** — `parseRecipe`가 (a) `createRecipe(삼각형, true)` 결과를 그대로 통과, (b) outer 2점이면 throw, (c) outer 401점이면 throw, (d) `schemaVersion: 2`면 throw.
- [ ] **Step 3:** `npm test` → FAIL 확인.
- [ ] **Step 4:** 구현.
- [ ] **Step 5:** `npm test` PASS, `npm run build` 성공.
- [ ] **Step 6:** Commit `chore: Next.js 골격과 레시피 스키마`

### Task 2: 실루엣 순수 파이프라인 (래스터 → 폴리곤)

**Files:**
- Create: `src/silhouette/raster.ts`, `src/silhouette/contour.ts`, `src/silhouette/simplify.ts`
- Test: `tests/silhouette/raster.test.ts`, `contour.test.ts`, `simplify.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `Silhouette`
- Produces:
  - `type Mask = { width: number; height: number; data: Uint8Array }` (0/1)
  - `hasMeaningfulAlpha(img: ImageData): boolean` — 알파<250 픽셀이 5% 이상
  - `alphaToMask(img: ImageData, threshold = 128): Mask`
  - `morphClose(mask: Mask, r: number): Mask`, `morphOpen(mask: Mask, r: number): Mask`
  - `largestComponent(mask: Mask): Mask` (4-연결)
  - `traceOuterContour(mask: Mask): Vec2[]` (marching squares, 시계 반대방향)
  - `simplifyDP(pts: Vec2[], epsilon: number): Vec2[]`
  - `chaikin(pts: Vec2[], iterations: number): Vec2[]` (닫힌 다각형)
  - `normalizeSilhouette(pts: Vec2[]): Vec2[]` — bbox 중심 (0,0), 최대 치수 1, 이미지 y↓를 y↑로 뒤집음
  - `maskToSilhouette(mask: Mask): Silhouette | null` — open(r=2)→close(r=3)→largest→trace→DP(ε=1.5px)→chaikin(2)→normalize; 덩어리 면적이 전체의 1% 미만이면 `null`. 최종 점 > 400이면 ε를 올려 재시도.

- [ ] **Step 1: 실패 테스트**
  - `largestComponent`: 30×30 사각형 + 떨어진 3×3 점 → 결과 픽셀 수 900.
  - `traceOuterContour` 20×10 사각형 → bbox 폭:높이 = 2:1 (±1px).
  - `simplifyDP` 직선 위 100점 → 2점.
  - `normalizeSilhouette` → bbox max dimension = 1 (±1e-6), 중심 (0,0), 이미지 상단 점이 y 양수.
  - `maskToSilhouette`: 원(반지름 40) + 1px 실오라기 → 결과 bbox 종횡비 1±0.05 (실오라기 제거됨), 점 ≤ 400, 자기교차 없음(간단한 선분 교차 검사 헬퍼를 테스트에 둠).
  - `maskToSilhouette`: 2×2 점 하나뿐인 100×100 마스크 → `null`.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS 확인.
- [ ] **Step 5:** Commit `feat: 마스크→실루엣 폴리곤 파이프라인`

### Task 3: 이미지 → 실루엣 (브라우저, 배경제거 포함)

**Files:**
- Create: `src/silhouette/pipeline.ts`
- Test: `tests/silhouette/pipeline.test.ts` (imgly는 `vi.mock`)

**Interfaces:**
- Consumes: Task 2 전부
- Produces:
  - `type SilhouetteResult = { ok: true; silhouette: Silhouette; mask: Mask; image: ImageData } | { ok: false; reason: 'not-found' | 'load-failed' }`
  - `imageToSilhouette(file: File, onProgress?: (p: number) => void): Promise<SilhouetteResult>`
  - `downscaleToMax(bitmap: ImageBitmap, maxSide = 1024): ImageData`
  - (`mask`·`image`는 P1 각인에서 재사용, 저장 금지)

흐름: 디코드 → `downscaleToMax` → `hasMeaningfulAlpha`면 알파 사용, 아니면 `await import('@imgly/background-removal')`의 `removeBackground`로 투명 PNG 얻어 알파 사용 → `maskToSilhouette` → null이면 `not-found`.

- [ ] **Step 1: 실패 테스트** — (a) 알파 있는 ImageData 입력 시 imgly mock 호출 0회, (b) 알파 없는 입력 시 1회, (c) mock이 완전 투명 결과를 주면 `{ok:false, reason:'not-found'}`, (d) `downscaleToMax`에 6000×4000 → 1024×683. (캔버스 API는 `jsdom` + `canvas` 없이 돌도록 `downscaleToMax` 내부 계산을 `computeScaledSize(w,h,max)`로 분리해 그걸 테스트)
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** Commit `feat: 이미지 업로드→실루엣 (배경제거 지연로딩)`

### Task 4: 쿠키 지오메트리 + 레지스트리

**Files:**
- Create: `src/three/registry.ts`, `src/three/cookieGeometry.ts`
- Test: `tests/three/cookieGeometry.test.ts`

**Interfaces:**
- Consumes: `PeperoRecipe`, `Silhouette`
- Produces:
  - `buildCookieGeometry(shape: PeperoRecipe['shape'], kind: PeperoRecipe['base']['kind']): THREE.BufferGeometry` — 위 좌표 규약대로 배치(막대 포함 시 쿠키+막대 병합). `ExtrudeGeometry`(bevel 0.06), z 중심 정렬.
  - `baseRegistry: Record<BaseKind, { silhouetteSize: number; silhouetteBottomY: number; buildExtras(): THREE.BufferGeometry | null }>` — `stick`: 2.0 / 3.8 / 캡슐(r 0.18, y 0~4.0), `none`: 3.6 / 0 / null
  - `coatingRegistry: Record<CoatingType, { color: string; roughness: number }>` — `milk-choco`: `#4a2716`, 0.35

- [ ] **Step 1: 실패 테스트** — 정사각형 실루엣으로
  - `stick`: bbox.min.y ≈ 0 (±0.01), bbox.max.y ≈ 3.8+2.0+0.06 (±0.1), 폭 ≈ 2.0+0.12.
  - `none`: bbox.min.y ≈ 0 (±0.07, 베벨 고려), 높이 ≈ 3.6 (±0.15).
  - 같은 입력 두 번 → position 배열 완전 동일(결정성).
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** Commit `feat: 레시피 기반 쿠키 지오메트리와 레지스트리`

### Task 5: 코팅 셰이더 + `<PeperoModel>`

**Files:**
- Create: `src/three/coatingMaterial.ts`, `src/three/PeperoModel.tsx`
- Test: `tests/three/coating.test.ts`

**Interfaces:**
- Consumes: Task 4
- Produces:
  - `isCoated(p: [number,number,number], coatings: PeperoRecipe['coatings']): CoatingType | null` — 셰이더와 같은 규칙의 JS 버전(테스트·디버그용). 뒤 레이어 우선.
  - `createCookieMaterial(maxLayers = 16): THREE.MeshStandardMaterial` — `onBeforeCompile`로 uniform `uPlanes[16]`(vec4: normal, offset), `uColors[16]`, `uCount` 주입. 로컬 좌표 기준 판정. 쿠키 질감: 구운 색 그라데이션(가장자리 진하게) + 노이즈.
  - `<PeperoModel recipe: PeperoRecipe; liveCoatings?: Coating[] />` — `buildCookieGeometry`를 `useMemo`, uniforms는 `recipe.coatings` + `liveCoatings`에서 갱신. `schemaVersion` 분기 switch(현재 1만).
- [ ] **Step 1: 실패 테스트** — `isCoated`: 평면 depth 1.0 하나일 때 y=0.5 → `'milk-choco'`, y=1.5 → null; 레이어 0개 → null.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: 눈으로 확인** — 임시로 `app/page.tsx`에 사각형 레시피 + depth 2.0 코팅 하나 렌더 → `npm run dev`, agent-browser 스크린샷: 막대 아래쪽 절반이 갈색.
- [ ] **Step 6:** Commit `feat: 평면 기반 코팅 셰이더와 PeperoModel`

### Task 6: 딥핑 (상태 로직 + 장면)

**Files:**
- Create: `src/dip/dipState.ts`, `src/dip/DipScene.tsx`
- Test: `tests/dip/dipState.test.ts`

**Interfaces:**
- Consumes: `<PeperoModel>`, `PeperoRecipe['coatings']`
- Produces:
  - `type DipState = { inChoco: boolean; currentDepth: number; committed: Coating[] }`
  - `initialDip(existing: Coating[]): DipState`
  - `stepDip(s: DipState, modelBottomY: number, surfaceY: number, seed: () => number): DipState` — `depth = surfaceY - modelBottomY`. 들어가 있으면 `currentDepth = max(currentDepth, depth)`. 빠져나오는 순간(`depth <= 0` 전환) `currentDepth`가 직전 최대 코팅 깊이보다 크면 새 코팅 `{type:'milk-choco', plane:{normal:[0,-1,0], offset:-currentDepth}, edgeSeed: seed()}` 추가, 아니면 추가 안 함.
  - `liveCoating(s: DipState): Coating | null` — 담그는 중 미리보기용
  - `<DipScene recipe onChange(coatings) />` — 초코 통(원통, 상단면 y=surfaceY=-1.0 월드), 모델은 기본 월드 y=1.0 위치. 포인터 다운한 지점 기준으로 모델이 포인터를 따라 이동(y: 통 바닥까지 제한, x: ±1.5 제한). `stepDip`는 매 포인터 이벤트마다 호출(프레임이 아니라 이벤트 → 빠른 휙 처리 OK). 좌우 흔들림은 x 속도 기반 z축 스프링 회전 ±6°(시각용, 코팅 판정은 회전 무시). 캔버스 `touch-action:none`, `OrbitControls` 사용 안 함.
- [ ] **Step 1: 실패 테스트**
  - 한 번 담금(바닥 y: 1→-0.5→1, surface 0) → coatings 1개, offset -0.5.
  - 같은 깊이로 다시 담금 → 여전히 1개.
  - 더 깊게(-1.2) → 2개, 마지막 offset -1.2.
  - 이벤트 2개로 휙(1 → -2 → 1) → offset -2 (Review Focus 4).
  - 표면에 닿기만(depth 0) → 0개.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: 눈으로 확인** — 데스크톱 드래그, agent-browser 모바일 뷰포트(390×844) 터치 드래그 시 페이지 스크롤 없음.
- [ ] **Step 6:** Commit `feat: 직접 잡고 담그는 딥핑`

### Task 7: Supabase 스키마 + API

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `src/api/supabase.ts`, `src/api/peperos.ts`, `src/lib/nickname.ts`, `.env.example`
- Test: `tests/lib/nickname.test.ts`, `tests/api/peperos.test.ts` (supabase client mock)

**Interfaces:**
- Produces:
  - 테이블 `peperos(id text pk, nickname text check(char_length between 1 and 20), recipe jsonb not null, thumbnail_url text, like_count int default 0, is_public bool default true, hidden bool default false, owner_id uuid null, created_at timestamptz default now())`
  - RLS: anon `select` where `hidden=false`; anon `insert` (like_count=0, hidden=false 강제 with check); update/delete 없음.
  - RPC `like_pepero(p_id text) returns int` (security definer, +1 후 값 반환).
  - Storage 버킷 `thumbnails`(public read, anon insert, `image/png`, 300KB 제한).
  - `validateNickname(s: string): { ok: true; value: string } | { ok: false; reason: 'empty' | 'too-long' | 'banned' }` — trim 후 판정, 금칙어 목록은 `src/lib/bannedWords.ts`(짧은 기본 목록).
  - `savePepero(input: { nickname: string; recipe: PeperoRecipe; thumbnail: Blob; isPublic: boolean }): Promise<{ id: string }>` — id = 8자 base62 랜덤, 썸네일 `thumbnails/{id}.png` 업로드 후 insert.
  - `type PeperoRow = { id: string; nickname: string; recipe: PeperoRecipe; thumbnailUrl: string; likeCount: number; createdAt: string }`
  - `getPepero(id: string): Promise<PeperoRow | null>` (`parseRecipe` 통과 못 하면 null)
  - `listGallery(opts: { sort: 'latest' | 'popular'; cursor?: string; limit?: number }): Promise<{ items: PeperoRow[]; nextCursor?: string }>` — `is_public=true`만
  - `likePepero(id: string): Promise<number>`
  - env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] **Step 0 (사용자 작업):** Supabase 프로젝트 생성 후 URL·anon key를 `.env.local`에 넣고, SQL Editor에서 `0001_init.sql` 실행. 막히면 여기서 멈추고 사용자에게 요청.
- [ ] **Step 1: 실패 테스트** — nickname: `"  "`→empty, 21자→too-long, 금칙어→banned, `" 꾸그 "`→ok `"꾸그"`. peperos: `savePepero`가 upload 후 insert 순서로 호출, `getPepero`가 깨진 recipe면 null.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5:** Commit `feat: Supabase 스키마와 빼빼로 저장 API`

### Task 8: 만들기 흐름 (`/`)

**Files:**
- Create: `src/maker/steps.ts`, `src/maker/MakerFlow.tsx`, `src/share/ShareButtons.tsx`; Modify: `app/page.tsx`
- Test: `tests/maker/steps.test.ts`

**Interfaces:**
- Consumes: `imageToSilhouette`, `createRecipe`, `<DipScene>`, `savePepero`, `validateNickname`
- Produces:
  - `type StepId = 'upload' | 'shape' | 'dip' | 'finish'` ; `const makerSteps: StepId[]`
  - `nextStep(id: StepId): StepId | null`, `prevStep(id: StepId): StepId | null`
  - `captureThumbnail(gl: THREE.WebGLRenderer, size = 512): Promise<Blob>` (`preserveDrawingBuffer` 또는 렌더타깃)
  - `<ShareButtons url: string />` — 링크 복사 + `navigator.share` 있으면 공유 버튼
- 화면: upload(파일 선택 + 진행률, 실패 문구 "캐릭터를 찾지 못했어요. 배경이 단순한 이미지를 써 보세요") → shape(2D 실루엣 미리보기 + 막대 토글 + 3D 미리보기, "다시 올리기") → dip("다시 담그기 초기화" 버튼) → finish(닉네임 + 갤러리 공개 체크박스(기본 ON) → 저장 → 링크 + ShareButtons + "갤러리 보기").
- [ ] **Step 1: 실패 테스트** — `makerSteps` 순서, `nextStep('finish') === null`, `prevStep('upload') === null`.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: E2E 확인** — dev 서버에서 투명 PNG 캐릭터 1장, 배경 있는 사진 1장으로 전체 흐름 완주, 저장 후 링크가 열리는지(Task 9 후 재확인).
- [ ] **Step 6:** Commit `feat: 만들기 흐름 UI`

### Task 9: 보기 페이지 + 갤러리 + 좋아요

**Files:**
- Create: `app/p/[id]/page.tsx`, `app/p/[id]/not-found.tsx`, `app/gallery/page.tsx`, `src/share/LikeButton.tsx`
- Test: `tests/share/likeButton.test.ts`

**Interfaces:**
- Consumes: `getPepero`, `listGallery`, `likePepero`, `<PeperoModel>`
- Produces:
  - `/p/[id]`: 서버에서 `getPepero` → null이면 `notFound()`. 클라 캔버스에서 자동 회전(0.4 rad/s) + 드래그 회전(drei `OrbitControls`, 줌 off). 닉네임, LikeButton, "나도 만들기"(→`/`).
  - `/gallery`: 썸네일 그리드(모바일 2열, 데스크톱 4열), 최신순 + "더 보기" 커서 페이지네이션. 카드 클릭 → `/p/[id]`.
  - `hasLiked(id): boolean`, `markLiked(id): void` — localStorage 키 `pepero:liked:{id}`, 접근 실패 시 try/catch로 false.
- [ ] **Step 1: 실패 테스트** — `markLiked` 후 `hasLiked` true; localStorage가 throw하는 환경에서도 `hasLiked` false 반환하고 throw 안 함.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: 확인** — 없는 id → 404, Supabase에서 `hidden=true` 처리한 id → 404 + 갤러리에서 사라짐 (Review Focus 5). `is_public=false` 작품은 링크로는 열리고 갤러리엔 없음.
- [ ] **Step 6:** Commit `feat: 공유 보기 페이지와 갤러리`

### Task 10: 배포 (P0 공개 가능 상태)

- [ ] **Step 1:** 사용자 확인 후 GitHub `alstjd8826/pepero-sim` public 레포 생성·push (`gh auth switch --user alstjd8826` → push → `gh auth switch --user Darby22`).
- [ ] **Step 2:** Vercel 프로젝트 연결, env 2개 등록 (사용자 확인 후). 배포 URL에서 데스크톱·모바일 각 1회 전체 흐름 완주.
- [ ] **Step 3:** `npm run build` 경고 중 번들 분석: 첫 페이지 JS에 `@imgly` 미포함 확인(`.next` 빌드 출력 또는 `next build --debug` 청크 목록).

---

## P1 (11/9 목표)

### Task 11: 코팅 두께감 · 물결 경계 · 흘러내림

**Files:** Modify `src/three/coatingMaterial.ts`, `src/three/PeperoModel.tsx`; Test `tests/three/coatingEdge.test.ts`

**Interfaces:**
- Produces: `edgeOffset(x: number, z: number, seed: number): number` — 경계 물결(진폭 0.06) + 흘러내림 줄기(진폭 ≤ 0.35, 줄기 4~7개, seed로 결정). 셰이더도 같은 해시 사용. `uDripProgress`(0→1, 1.5초)로 줄기 길이 애니메이션, 저장된 레시피 렌더 시 1.
- 두께: 코팅 영역은 셰이더에서 노멀을 법선 방향으로 0.02 부풀린 별도 셸 메시(같은 지오메트리, 코팅 아닌 곳 discard)로 표현. 초코 roughness 0.35, 하이라이트 있음.
- [ ] 테스트: 같은 seed → 같은 값, 다른 seed → 다른 값, 값 범위 [-0.06, 0.35].
- [ ] FAIL → 구현 → PASS → 스크린샷 확인 → Commit `feat: 초코 두께감과 흘러내림`

### Task 12: 앞면 각인

**Files:** Create `src/silhouette/relief.ts`; Modify `src/maker/MakerFlow.tsx`, `src/three/cookieGeometry.ts`, `src/three/coatingMaterial.ts`, `src/api/peperos.ts`; Test `tests/silhouette/relief.test.ts`

**Interfaces:**
- Produces:
  - `extractRelief(image: ImageData, mask: Mask, size = 256): Uint8Array` — 실루엣 bbox로 크롭 → size×size 그레이 → 가우시안 블러 → Sobel 크기 → 임계 + 작은 잡선 제거 → 마스크 밖 0 → 2px 팽창. 255 = 깊게 눌림.
  - `reliefToPngBlob(data: Uint8Array, size: number): Promise<Blob>`
  - 저장: Storage `reliefs/{id}.png`, `recipe.shape.relief = { heightmapUrl, strength }` (strength 0~1, 기본 0.6, 0이면 relief 필드 생략).
  - 렌더: 앞면(+z) UV를 정규화 실루엣 bbox로 매핑, 높이맵을 bumpMap/normalMap으로. 깊이 = strength × 0.05.
- shape 단계에 각인 미리보기 + 강도 슬라이더.
- [ ] 테스트: 단색 이미지 → 전부 0; 가운데 검은 선 있는 흰 원 → 선 위치 픽셀 > 128, 마스크 밖 0.
- [ ] FAIL → 구현 → PASS → 실제 캐릭터 이미지 2장으로 눈 확인 → Commit `feat: 쿠키 앞면 각인`

### Task 13: OG 미리보기 · 인기순

**Files:** Modify `app/p/[id]/page.tsx`, `app/gallery/page.tsx`
- [ ] `generateMetadata`: title `"{닉네임}의 빼빼로"`, `openGraph.images = [thumbnail_url]`, description "나도 만들어 보기".
- [ ] 갤러리 정렬 토글 최신순/인기순 (`listGallery({sort})`).
- [ ] 확인: 배포 URL을 카카오톡 공유 디버거 또는 `curl -s url | grep og:image`로 메타태그 확인 → Commit `feat: 링크 미리보기와 인기순 정렬`

## P2 (여유 시)
- 스프링 흔들림·포인터 추종 손맛 튜닝, 조명·배경·초코 통 비주얼, 배경제거 모델 로딩 연출. 각각 독립 커밋.

---

## 공개 체크리스트 (11/10)
- [ ] P0 전부 + 끝난 P1까지 배포 URL에서 데스크톱/모바일 완주
- [ ] `npm test` 전체 PASS, `npm run build` 성공
- [ ] 첫 화면 번들에 imgly 미포함
