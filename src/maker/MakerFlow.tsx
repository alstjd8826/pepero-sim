'use client';

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { imageToSilhouette } from '@/src/silhouette/pipeline';
import type { Mask } from '@/src/silhouette/raster';
import { createRecipe } from '@/src/recipe/defaults';
import type { Coating, Silhouette } from '@/src/recipe/types';
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
const PeperoPreview = dynamic(() => import('./PeperoPreview'), {
  ssr: false,
  loading: () => <p className={styles.canvasLoading}>3D 준비 중…</p>,
});

const STEP_LABEL: Record<StepId, string> = {
  upload: '이미지',
  shape: '모양',
  dip: '담그기',
  finish: '완성',
};

const NICKNAME_ERROR: Record<Extract<NicknameResult, { ok: false }>['reason'], string> = {
  empty: '닉네임을 입력해 주세요.',
  'too-long': `닉네임은 ${NICKNAME_MAX}자까지 쓸 수 있어요.`,
  banned: '사용할 수 없는 단어가 들어 있어요.',
};

const SAVE_ERROR = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';

export function MakerFlow() {
  const [step, setStep] = useState<StepId>('upload');

  // 업로드
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadToken = useRef(0);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  /** 각인(이후 태스크)용 원본 파생물. 화면 상태에만 두고 절대 업로드하지 않는다. */
  const sourceRef = useRef<{ mask: Mask; image: ImageData } | null>(null);

  // 모양·담그기
  const [hasStick, setHasStick] = useState(true);
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [resetKey, setResetKey] = useState(0);

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
  const recipe = useMemo(
    () => (baseRecipe ? { ...baseRecipe, coatings } : null),
    [baseRecipe, coatings],
  );

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
    setSilhouette(result.silhouette);
    resetDip();
    setSavedId(null);
    setSaveError(null);
    setStep('shape');
  };

  const toggleStick = () => {
    setHasStick((v) => !v);
    resetDip();
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
      const { id } = await savePepero({ nickname: nick.value, recipe, thumbnail, isPublic });
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
    <main className={`${styles.root} ${step === 'dip' ? styles.rootDip : ''}`}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h1 className={styles.title}>빼빼로 시뮬레이터</h1>
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

      {step === 'shape' && silhouette && recipe && (
        <section className={styles.panel}>
          <div className={styles.shapeRow}>
            <figure className={styles.figure}>
              <SilhouetteSvg silhouette={silhouette} />
              <figcaption>찾은 모양</figcaption>
            </figure>
            <figure className={styles.figure}>
              <div className={styles.preview3d}>
                <PeperoPreview recipe={recipe} />
              </div>
              <figcaption>3D 쿠키</figcaption>
            </figure>
          </div>
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

      {step === 'dip' && recipe && (
        <section className={styles.dipPanel}>
          <p className={styles.dipHint}>쿠키를 잡고 아래 초코 통에 담갔다 빼 보세요. 여러 번 해도 돼요.</p>
          <div className={styles.dipStage}>
            <DipScene recipe={recipe} onChange={setCoatings} resetKey={resetKey} />
          </div>
          <div className={styles.dipBar}>
            <button type="button" className={styles.secondary} onClick={() => back && goTo(back)}>
              이전
            </button>
            <button type="button" className={styles.secondary} onClick={resetDip}>
              다시 담그기 초기화
            </button>
            <button type="button" className={styles.primary} onClick={() => goTo('finish')}>
              완성
            </button>
          </div>
        </section>
      )}

      {step === 'finish' && recipe && (
        <section className={styles.panel}>
          <div className={styles.finishPreview}>
            <PeperoPreview recipe={recipe} mode="pose" onCaptureReady={onCaptureReady} />
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
                  더 담그기
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

function SilhouetteSvg({ silhouette }: { silhouette: Silhouette }) {
  const toPath = (pts: [number, number][]) =>
    `M${pts.map(([x, y]) => `${x.toFixed(4)},${(-y).toFixed(4)}`).join('L')}Z`;
  const d = [silhouette.outer, ...(silhouette.holes ?? [])].map(toPath).join('');
  return (
    <svg className={styles.silhouette} viewBox="-0.6 -0.6 1.2 1.2" role="img" aria-label="찾은 실루엣">
      <path d={d} fillRule="evenodd" fill="#d9a066" stroke="#8a5a32" strokeWidth={0.012} />
    </svg>
  );
}
