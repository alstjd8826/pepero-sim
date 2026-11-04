'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { imageToSilhouette } from '@/src/silhouette/pipeline';
import type { Mask } from '@/src/silhouette/raster';
import { createRecipe } from '@/src/recipe/defaults';
import {
  COATING_TYPES,
  MAX_TOPPINGS,
  PEN_COLORS,
  PEN_WIDTHS,
  TOPPING_TYPES,
  type Coating,
  type CoatingType,
  type PenColor,
  type PenWidth,
  type PeperoRecipe,
  type Silhouette,
  type ToppingType,
} from '@/src/recipe/types';
import { coatingRegistry, penRegistry, penWidthRegistry, toppingRegistry } from '@/src/three/registry';
import {
  canStartStroke,
  flattenActions,
  remainingStrokePoints,
  type DecoAction,
} from '@/src/decorate/decorations';
import type { DecoTool } from '@/src/decorate/DecorateScene';
import { RELIEF_STRENGTH } from '@/src/recipe/relief';
import { LogoMark } from '@/src/share/Logo';
import { extractRelief, isReliefEmpty, reliefToPngBlob } from '@/src/silhouette/relief';
import { savePepero } from '@/src/api/peperos';
import { NICKNAME_MAX, validateNickname, type NicknameResult } from '@/src/lib/nickname';
import { ShareButtons } from '@/src/share/ShareButtons';
import { makerSteps, nextStep, prevStep, type StepId } from './steps';
import type { CaptureFn } from './PeperoPreview';
import styles from './maker.module.css';

// 3D 는 클라이언트 전용·지연 로딩 (첫 화면 번들에서 제외)
const DipScene = dynamic(() => import('@/src/dip/DipScene').then((m) => m.DipScene), {
  ssr: false,
  loading: () => <p className={styles.canvasLoading}>초코 통 준비 중…</p>,
});
const DecorateScene = dynamic(() => import('@/src/decorate/DecorateScene').then((m) => m.DecorateScene), {
  ssr: false,
  loading: () => <p className={styles.canvasLoading}>꾸미기 준비 중…</p>,
});
const PeperoPreview = dynamic(() => import('./PeperoPreview'), {
  ssr: false,
  loading: () => <p className={styles.canvasLoading}>3D 준비 중…</p>,
});

const STEP_LABEL: Record<StepId, string> = {
  upload: '이미지',
  shape: '모양',
  dip: '담그기',
  decorate: '꾸미기',
  finish: '완성',
};

const NICKNAME_ERROR: Record<Extract<NicknameResult, { ok: false }>['reason'], string> = {
  empty: '닉네임을 입력해 주세요.',
  'too-long': `닉네임은 ${NICKNAME_MAX}자까지 쓸 수 있어요.`,
  banned: '사용할 수 없는 단어가 들어 있어요.',
};

const SAVE_ERROR = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';

/** 각인 높이맵 한 변. 512 면 선이 또렷하고 PNG 는 보통 수십 KB (버킷 한도 128KB) */
const RELIEF_SIZE = 512;
/** 연속 업로드 시 각인 계산을 몰아서 한 번만 (업로드 직후 화면 전환을 막지 않게 뒤로 미룬다) */
const RELIEF_DEBOUNCE_MS = 120;

/** 저장 전 로컬 각인: PNG 는 저장 때 올리고, url 은 미리보기용 object URL (교체 시 revoke) */
type LocalRelief = { png: Blob; url: string };
type ReliefStatus = 'idle' | 'working' | 'ready' | 'empty' | 'failed';

export function MakerFlow() {
  const [step, setStep] = useState<StepId>('upload');

  // 업로드
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadToken = useRef(0);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  /** 각인(이후 태스크)용 원본 파생물. 화면 상태에만 두고 절대 업로드하지 않는다. */
  const sourceRef = useRef<{ mask: Mask; image: ImageData } | null>(null);

  // 각인
  const [relief, setRelief] = useState<LocalRelief | null>(null);
  const [reliefStatus, setReliefStatus] = useState<ReliefStatus>('idle');
  const reliefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reliefUrlRef = useRef<string | null>(null);

  const replaceRelief = useCallback((next: LocalRelief | null) => {
    if (reliefUrlRef.current) URL.revokeObjectURL(reliefUrlRef.current);
    reliefUrlRef.current = next?.url ?? null;
    setRelief(next);
  }, []);

  useEffect(
    () => () => {
      if (reliefTimer.current) clearTimeout(reliefTimer.current);
      if (reliefUrlRef.current) URL.revokeObjectURL(reliefUrlRef.current);
    },
    [],
  );

  // 모양·담그기
  const [hasStick, setHasStick] = useState(true);
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [chocoType, setChocoType] = useState<CoatingType>('milk-choco');

  // 꾸미기
  const [decoActions, setDecoActions] = useState<DecoAction[]>([]);
  const [decoMode, setDecoMode] = useState<'pen' | 'topping'>('pen');
  const [penColor, setPenColor] = useState<PenColor>('white');
  const [penWidth, setPenWidth] = useState<PenWidth>('thin');
  const [toppingType, setToppingType] = useState<ToppingType>('sprinkle');
  const [decoLimit, setDecoLimit] = useState(false);

  // 완성
  const [nickname, setNickname] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const captureRef = useRef<CaptureFn | null>(null);
  const [captureReady, setCaptureReady] = useState(false);

  const baseRecipe = useMemo(
    () => (silhouette ? createRecipe(silhouette, hasStick) : null),
    [silhouette, hasStick],
  );
  // 확정 코팅을 다시 넣어도 DipScene 은 리셋되지 않는다(resetKey 로만 리셋)
  const decorations = useMemo(() => flattenActions(decoActions), [decoActions]);
  const recipe = useMemo<PeperoRecipe | null>(() => {
    if (!baseRecipe) return null;
    const { strokes, toppings } = decorations;
    return { ...baseRecipe, coatings, toppings, ...(strokes.length ? { strokes } : {}) };
  }, [baseRecipe, coatings, decorations]);
  const decoTool = useMemo<DecoTool>(
    () => (decoMode === 'pen' ? { kind: 'pen', color: penColor, width: penWidth } : { kind: 'topping', type: toppingType }),
    [decoMode, penColor, penWidth, toppingType],
  );
  const toppingsLeft = MAX_TOPPINGS - decorations.toppings.length;
  const addDeco = useCallback((a: DecoAction) => {
    setDecoActions((list) => [...list, a]);
    setDecoLimit(false);
  }, []);
  const onLimit = useCallback(() => setDecoLimit(true), []);
  const resetDecor = useCallback(() => {
    setDecoActions([]);
    setDecoLimit(false);
  }, []);
  // 화면용 레시피: 저장 전 각인은 로컬 object URL 로 미리 본다. 저장할 땐 recipe(각인 없음) + relief PNG 를 따로 넘긴다.
  const activeStrength = relief ? RELIEF_STRENGTH : 0;
  const viewRecipe = useMemo<PeperoRecipe | null>(() => {
    if (!recipe || !relief || activeStrength <= 0) return recipe;
    return {
      ...recipe,
      shape: { ...recipe.shape, relief: { heightmapUrl: relief.url, strength: activeStrength } },
    };
  }, [recipe, relief, activeStrength]);

  const resetDip = useCallback(() => {
    setCoatings([]);
    setResetKey((k) => k + 1);
  }, []);

  const goTo = (s: StepId) => {
    if (s === 'finish') {
      setCaptureReady(false);
      captureRef.current = null;
    }
    setStep(s);
  };

  /** 업로드 결과로 각인 높이맵을 만든다. 디바운스 + 토큰으로 마지막 업로드만 반영. */
  const scheduleRelief = (token: number) => {
    if (reliefTimer.current) clearTimeout(reliefTimer.current);
    replaceRelief(null);
    setReliefStatus('working');
    reliefTimer.current = setTimeout(async () => {
      reliefTimer.current = null;
      const src = sourceRef.current;
      if (!src || token !== uploadToken.current) return;
      try {
        const data = extractRelief(src.image, src.mask, RELIEF_SIZE);
        if (isReliefEmpty(data)) {
          if (token === uploadToken.current) setReliefStatus('empty');
          return;
        }
        const png = await reliefToPngBlob(data, RELIEF_SIZE);
        if (token !== uploadToken.current) return;
        replaceRelief({ png, url: URL.createObjectURL(png) });
        setReliefStatus('ready');
      } catch (err) {
        console.warn('[maker] 각인 만들기 실패', err);
        if (token === uploadToken.current) setReliefStatus('failed');
      }
    }, RELIEF_DEBOUNCE_MS);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // 같은 파일을 다시 골라도 change 가 나도록
    if (!file) return;
    const token = ++uploadToken.current;
    setUploadError(null);
    setProgress(0);
    const result = await imageToSilhouette(file, (p) => {
      if (token === uploadToken.current) setProgress(p);
    });
    if (token !== uploadToken.current) return;
    setProgress(null);
    if (!result.ok) {
      setUploadError(
        result.reason === 'not-found'
          ? '캐릭터를 찾지 못했어요. 배경이 단순한 이미지를 써 보세요'
          : '이미지를 불러오지 못했어요. 다른 이미지로 다시 시도해 보세요',
      );
      return;
    }
    sourceRef.current = { mask: result.mask, image: result.image };
    scheduleRelief(token);
    setSilhouette(result.silhouette);
    resetDip();
    resetDecor();
    setSavedId(null);
    setSaveError(null);
    setStep('shape');
  };

  const toggleStick = () => {
    setHasStick((v) => !v);
    resetDip();
    resetDecor();
  };

  const onCaptureReady = useCallback((capture: CaptureFn) => {
    captureRef.current = capture;
    setCaptureReady(true);
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !recipe) return;
    const nick = validateNickname(nickname);
    if (!nick.ok) {
      setNicknameError(NICKNAME_ERROR[nick.reason]);
      return;
    }
    setNicknameError(null);
    setSaveError(null);
    const capture = captureRef.current;
    if (!capture) return;
    setSaving(true);
    try {
      const thumbnail = await capture();
      const { id } = await savePepero({
        nickname: nick.value,
        recipe,
        thumbnail,
        isPublic,
        relief: relief && activeStrength > 0 ? { png: relief.png, strength: activeStrength } : undefined,
      });
      setSavedId(id);
    } catch (err) {
      console.warn('[maker] 저장 실패', err);
      setSaveError(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  const back = prevStep(step);
  const shareUrl = savedId && typeof window !== 'undefined' ? `${window.location.origin}/p/${savedId}` : null;

  return (
    <main className={`${styles.root} ${step === 'dip' || step === 'decorate' ? styles.rootDip : ''}`}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h1 className={styles.title}>
            <LogoMark className={styles.logo} />
            빼빼로 시뮬레이터
          </h1>
          <Link href="/gallery" className={styles.headerLink}>
            갤러리
          </Link>
        </div>
        <ol className={styles.steps} aria-label="만들기 단계">
          {makerSteps.map((s, i) => (
            <li
              key={s}
              className={s === step ? styles.stepCurrent : styles.step}
              aria-current={s === step ? 'step' : undefined}
            >
              {i + 1}. {STEP_LABEL[s]}
            </li>
          ))}
        </ol>
      </header>

      {step === 'upload' && (
        <section className={styles.panel}>
          <p className={styles.lead}>
            캐릭터 이미지를 올리면 그 모양 그대로 쿠키를 구워 드려요. 배경이 투명하거나 단순할수록 잘 나와요.
          </p>
          <label className={`${styles.primary} ${progress !== null ? styles.disabled : ''}`}>
            {progress !== null ? '모양 찾는 중…' : '이미지 고르기'}
            <input
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={onFile}
              disabled={progress !== null}
              data-testid="file-input"
            />
          </label>
          {progress !== null && (
            <div className={styles.progressWrap}>
              <progress className={styles.progress} value={progress} max={1} />
              <span className={styles.progressText}>{Math.round(progress * 100)}%</span>
              <p className={styles.hint}>처음 한 번은 배경 지우는 AI를 받느라 조금 걸릴 수 있어요.</p>
            </div>
          )}
          {uploadError && (
            <p className={styles.error} role="alert">
              {uploadError}
            </p>
          )}
          <p className={styles.hint}>올린 이미지는 서버로 보내지 않고 이 기기 안에서만 처리돼요.</p>
          {silhouette && progress === null && (
            <button type="button" className={styles.secondary} onClick={() => setStep('shape')}>
              방금 만든 모양으로 돌아가기
            </button>
          )}
        </section>
      )}

      {step === 'shape' && silhouette && viewRecipe && (
        <section className={styles.panel}>
          <div className={styles.shapeRow}>
            <figure className={styles.figure}>
              <SilhouetteSvg silhouette={silhouette} reliefUrl={relief?.url ?? null} />
              <figcaption>{relief ? '찾은 모양과 각인' : '찾은 모양'}</figcaption>
            </figure>
            <figure className={styles.figure}>
              <div className={styles.preview3d}>
                <PeperoPreview recipe={viewRecipe} />
              </div>
              <figcaption>3D 쿠키</figcaption>
            </figure>
          </div>
          <p className={styles.hint} aria-live="polite">
            {reliefStatus === 'working' && '색과 선을 찾아 쿠키 앞면에 새기는 중…'}
            {reliefStatus === 'ready' && '캐릭터의 선과 색 경계를 쿠키 앞면에 꾹 눌러 찍었어요.'}
            {reliefStatus === 'empty' && '새길 선을 찾지 못해서 매끈하게 구워요.'}
            {reliefStatus === 'failed' && '각인을 만들지 못해서 매끈하게 구워요.'}
          </p>
          <label className={styles.toggle}>
            <input type="checkbox" checked={hasStick} onChange={toggleStick} data-testid="stick-toggle" />
            <span>막대 꽂기 {hasStick ? '(막대 끝부터 담가요)' : '(쿠키만, 더 크게)'}</span>
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setStep('upload')}>
              다시 올리기
            </button>
            <button type="button" className={styles.primary} onClick={() => goTo(nextStep('shape')!)}>
              초코 담그러 가기
            </button>
          </div>
        </section>
      )}

      {step === 'dip' && viewRecipe && (
        <section className={styles.dipPanel}>
          <p className={styles.dipHint}>쿠키를 잡고 아래 초코 통에 담갔다 빼 보세요. 색을 바꿔 여러 번 담가도 돼요.</p>
          <div className={styles.swatches} role="radiogroup" aria-label="초코 색">
            {COATING_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={chocoType === t}
                className={styles.swatch}
                onClick={() => setChocoType(t)}
                data-testid={`choco-${t}`}
              >
                <span className={styles.swatchDot} style={{ background: coatingRegistry[t].color }} />
                {coatingRegistry[t].label}
              </button>
            ))}
          </div>
          <div className={styles.dipStage}>
            <DipScene recipe={viewRecipe} onChange={setCoatings} resetKey={resetKey} chocoType={chocoType} />
          </div>
          <div className={styles.dipBar}>
            <button type="button" className={styles.secondary} onClick={() => back && goTo(back)}>
              이전
            </button>
            <button type="button" className={styles.secondary} onClick={resetDip}>
              다시 담그기 초기화
            </button>
            <button type="button" className={styles.primary} onClick={() => goTo('decorate')}>
              꾸미러 가기
            </button>
          </div>
        </section>
      )}

      {step === 'decorate' && viewRecipe && (
        <section className={styles.dipPanel}>
          <div className={styles.tabs} role="tablist" aria-label="꾸미기 도구">
            <button
              type="button"
              role="tab"
              aria-selected={decoMode === 'pen'}
              className={styles.tab}
              onClick={() => setDecoMode('pen')}
            >
              초코펜
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={decoMode === 'topping'}
              className={styles.tab}
              onClick={() => setDecoMode('topping')}
              data-testid="tab-topping"
            >
              토핑
            </button>
          </div>
          {decoMode === 'pen' ? (
            <div className={styles.swatches} role="radiogroup" aria-label="펜 색">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={penColor === c}
                  className={styles.swatch}
                  onClick={() => setPenColor(c)}
                  data-testid={`pen-${c}`}
                >
                  <span className={styles.swatchDot} style={{ background: penRegistry[c].color }} />
                  {penRegistry[c].label}
                </button>
              ))}
              {PEN_WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={penWidth === w}
                  className={styles.swatch}
                  onClick={() => setPenWidth(w)}
                  data-testid={`width-${w}`}
                >
                  <span
                    className={styles.widthDot}
                    style={{ width: penWidthRegistry[w].radius * 300, height: penWidthRegistry[w].radius * 300 }}
                  />
                  {penWidthRegistry[w].label}
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.swatches} role="radiogroup" aria-label="토핑">
              {TOPPING_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={toppingType === t}
                  className={styles.swatch}
                  onClick={() => setToppingType(t)}
                  data-testid={`topping-${t}`}
                >
                  <ToppingIcon type={t} />
                  {toppingRegistry[t].label}
                </button>
              ))}
            </div>
          )}
          <p className={styles.dipHint} aria-live="polite">
            {decoLimit
              ? '더는 못 올려요. 되돌리기로 지우고 다시 해 보세요.'
              : decoMode === 'pen'
                ? '쿠키 위를 그으면 초코펜으로 그려져요. 빈 곳을 끌면 돌아가요.'
                : '쿠키를 누르면 토핑이 올라가요. 끌면 뿌려져요.'}
          </p>
          <div className={styles.dipStage}>
            <DecorateScene
              recipe={viewRecipe}
              tool={decoTool}
              strokePointsLeft={remainingStrokePoints(decoActions)}
              canStartStroke={canStartStroke(decoActions)}
              toppingsLeft={toppingsLeft}
              onStroke={(stroke) => addDeco({ kind: 'stroke', stroke })}
              onToppings={(items) => addDeco({ kind: 'toppings', items })}
              onLimit={onLimit}
            />
          </div>
          <div className={styles.dipBar}>
            <button type="button" className={styles.secondary} onClick={() => goTo('dip')}>
              이전
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setDecoActions((list) => list.slice(0, -1));
                setDecoLimit(false);
              }}
              disabled={!decoActions.length}
            >
              되돌리기
            </button>
            <button type="button" className={styles.secondary} onClick={resetDecor} disabled={!decoActions.length}>
              모두 지우기
            </button>
            <button type="button" className={styles.primary} onClick={() => goTo('finish')}>
              완성
            </button>
          </div>
        </section>
      )}

      {step === 'finish' && viewRecipe && (
        <section className={styles.panel}>
          <div className={styles.finishPreview}>
            <PeperoPreview recipe={viewRecipe} mode="pose" onCaptureReady={onCaptureReady} />
          </div>
          {savedId ? (
            <div className={styles.saved}>
              <p className={styles.lead}>저장했어요! 링크로 친구에게 보여 주세요.</p>
              {shareUrl && <ShareButtons url={shareUrl} />}
              <div className={styles.actions}>
                <Link href="/gallery" className={styles.secondary}>
                  갤러리 보기
                </Link>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setSavedId(null);
                    setStep('upload');
                  }}
                >
                  새로 만들기
                </button>
              </div>
            </div>
          ) : (
            <form className={styles.form} onSubmit={onSave} noValidate>
              <label className={styles.field}>
                <span>닉네임</span>
                <input
                  className={styles.input}
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNicknameError(null);
                  }}
                  placeholder={`1~${NICKNAME_MAX}자`}
                  autoComplete="nickname"
                  aria-invalid={nicknameError ? true : undefined}
                  aria-describedby={nicknameError ? 'nickname-error' : undefined}
                  data-testid="nickname"
                />
              </label>
              {nicknameError && (
                <p id="nickname-error" className={styles.error} role="alert">
                  {nicknameError}
                </p>
              )}
              <label className={styles.toggle}>
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                <span>갤러리에 공개</span>
              </label>
              {!isPublic && <p className={styles.hint}>공개하지 않으면 링크를 아는 사람만 볼 수 있어요.</p>}
              {saveError && (
                <p className={styles.error} role="alert">
                  {saveError}
                </p>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => back && goTo(back)}
                  disabled={saving}
                >
                  더 꾸미기
                </button>
                <button type="submit" className={styles.primary} disabled={saving || !captureReady}>
                  {saving ? '저장 중…' : '저장하기'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}

/** 실루엣 + (있으면) 각인 미리보기. 각인 PNG 는 정규화 bbox 정사각형 [-0.5, 0.5]² 에 정확히 겹친다. */
function SilhouetteSvg({ silhouette, reliefUrl }: { silhouette: Silhouette; reliefUrl: string | null }) {
  const toPath = (pts: [number, number][]) =>
    `M${pts.map(([x, y]) => `${x.toFixed(4)},${(-y).toFixed(4)}`).join('L')}Z`;
  const d = [silhouette.outer, ...(silhouette.holes ?? [])].map(toPath).join('');
  return (
    <svg className={styles.silhouette} viewBox="-0.6 -0.6 1.2 1.2" role="img" aria-label="찾은 실루엣">
      <path d={d} fillRule="evenodd" fill="#d9a066" stroke="#8a5a32" strokeWidth={0.012} />
      {reliefUrl && (
        <image
          href={reliefUrl}
          x={-0.5}
          y={-0.5}
          width={1}
          height={1}
          preserveAspectRatio="none"
          className={styles.reliefOverlay}
          data-testid="relief-preview"
        />
      )}
    </svg>
  );
}

/** 토핑 버튼 아이콘 (작은 SVG) */
function ToppingIcon({ type }: { type: ToppingType }) {
  const c = toppingRegistry[type].color;
  const common = { width: 18, height: 18, viewBox: '-10 -10 20 20', 'aria-hidden': true } as const;
  switch (type) {
    case 'almond':
      return (
        <svg {...common}>
          <ellipse rx="8" ry="5" fill={c} stroke="#b08550" strokeWidth="1" />
        </svg>
      );
    case 'crunch':
      return (
        <svg {...common}>
          <polygon points="-6,-2 -2,-6 3,-5 6,0 2,5 -4,4" fill={c} />
          <polygon points="4,-8 7,-6 6,-3 3,-4" fill={c} />
        </svg>
      );
    case 'sprinkle':
      return (
        <svg {...common}>
          <rect x="-7" y="-6" width="7" height="2.6" rx="1.3" fill="#f26d7d" transform="rotate(-30)" />
          <rect x="0" y="-1" width="7" height="2.6" rx="1.3" fill="#6cb4ee" transform="rotate(20)" />
          <rect x="-5" y="3" width="7" height="2.6" rx="1.3" fill="#f7c548" transform="rotate(-10)" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <polygon points="0,-9 2.6,-3 9,-3 4,1.5 5.8,8 0,4.2 -5.8,8 -4,1.5 -9,-3 -2.6,-3" fill={c} />
        </svg>
      );
    case 'pearl':
      return (
        <svg {...common}>
          <circle cx="-3" cy="2" r="4" fill="#d9d6d0" />
          <circle cx="4" cy="-3" r="3.2" fill="#e9e6e1" />
          <circle cx="-4.6" cy="0.4" r="1.2" fill="#fff" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...common}>
          <path d="M0 8 C-2 6 -9 1 -8 -3.5 C-7 -8 -2 -8 0 -4 C2 -8 7 -8 8 -3.5 C9 1 2 6 0 8Z" fill={c} />
        </svg>
      );
  }
}
