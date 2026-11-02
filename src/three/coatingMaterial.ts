import * as THREE from 'three';
import type { CoatingType, PeperoRecipe } from '@/src/recipe/types';
import { coatingRegistry } from './registry';

/** 셰이더 uniform 배열의 고정 길이. 레시피는 최대 50개까지 허용하므로 초과분은 최신 16개만 그린다. */
export const MAX_COATING_LAYERS = 16;

type Coatings = PeperoRecipe['coatings'];
type Vec3 = [number, number, number];

/* ───────────────────────── 경계 모양 (물결 + 흘러내림) ─────────────────────────
 *
 * edgeOffset(x, z, seed) = 경계 높이 보정. 코팅 = y <= depth + edgeOffset.
 *   - 물결: 진폭 WAVE_AMP(0.06) 의 주기 함수 → [-0.06, 0.06]
 *   - 흘러내림 줄기 4~7개(주기당): 줄기마다 도달 길이 reach ∈ [0.2, 0.35] (≤ DRIP_MAX).
 *     경계는 줄기 자리에서 reach 의 40% 만큼 아래(-y, 담근 끝 = 중력 쪽)로 끌려 내려가고(sag, 이 함수의 음수 부분),
 *     나머지 60% 는 그 아래로 초코 표면 위를 흘러내린 볼록한 줄기 + 끝 방울로 그린다(셸 셰이더의 범프, 판정엔 영향 없음).
 *     줄기는 경계를 내리기만 한다(위로 타고 오르지 않음).
 *   이 함수의 범위 [-0.2, 0.06] ⊂ [-0.35, 0.06]. 줄기 끝까지의 총 길이는 ≤ 0.35.
 *
 * 둘레 좌표 u (주기 P 함수라 이음매가 없다):
 *   - radial(막대 구간): u = atan2(z, x) · P/2π. 둘레 한 바퀴 = 정확히 P → 4~7 줄기가 고르게 돈다.
 *   - 평면(쿠키 구간):   u = x + 8z. 앞/뒷면이 서로 다른 u 를 받고 각도 왜곡이 없다.
 *   어느 쪽인지는 레이어 깊이로 정한다 (막대 ON 이고 depth < 실루엣 시작 높이 → radial).
 *
 * seed(uint32) 는 float32 uniform 에 그대로 못 들어가므로 JS 에서 seedUnit() 으로 16비트 [0,1) 값으로 줄여
 * 넘긴다 (float32 로 정확히 표현됨). 해시는 sin 을 안 쓰는 Hoskins hash12 를 쓰고, JS 쪽은 Math.fround 로
 * 매 연산을 float32 로 맞춰 GPU 와 같은 값이 나오게 한다 → 저장된 빼빼로가 어디서나 같은 모양.
 *
 * ⚠️ JS(edgeOffset) 와 GLSL(COATING_PARS 의 coatEdgeOffset) 은 반드시 같아야 한다 — 한쪽을 고치면 다른 쪽도.
 */

export const WAVE_AMP = 0.06;
export const DRIP_MAX = 0.35;
const EDGE_PERIOD = 4.0;
const FLAT_Z_SHEAR = 8.0;
/** 줄기 도달 길이 reach = DRIP_REACH_MIN + DRIP_REACH_RANGE·hash ≤ DRIP_MAX */
const DRIP_REACH_MIN = 0.2;
const DRIP_REACH_RANGE = DRIP_MAX - DRIP_REACH_MIN;
/** reach 중 경계 자체가 끌려 내려가는 비율 (나머지는 흘러내린 줄기) */
const SAG_FRACTION = 0.4;
const MAX_DRIPS = 7;
/** 처짐 반폭(u 단위) 기본값: radial 1u ≈ 둘레 0.28cm, 평면 1u ≈ 1cm */
const DRIP_HALF_WIDTH_RADIAL = 0.35;
const DRIP_HALF_WIDTH_FLAT = 0.13;
/** 흘러내린 줄기 반폭 = 처짐 반폭 × 이 비율, 줄기 볼록 높이 */
const STREAK_WIDTH = 0.3;
const STREAK_HEIGHT = 0.02;

const f32 = Math.fround;
const fract32 = (v: number) => f32(v - Math.floor(v));

/** uint32 시드 → [0,1) 16비트 값 (float32 로 정확히 표현된다) */
export function seedUnit(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 16) / 65536;
}

/** Hoskins hash12(vec2(k, s*997)) — float32 연산을 그대로 흉내 낸다 */
function coatHash(k: number, s: number): number {
  const px = f32(k);
  const py = f32(f32(s) * 997);
  const c = f32(0.1031);
  let a = fract32(f32(px * c));
  let b = fract32(f32(py * c));
  let d = a;
  const k3 = f32(33.33);
  const dot = f32(
    f32(f32(a * f32(b + k3)) + f32(b * f32(d + k3))) + f32(d * f32(a + k3)),
  );
  a = f32(a + dot);
  b = f32(b + dot);
  d = f32(d + dot);
  return fract32(f32(f32(a + b) * d));
}

/** 이 시드의 흘러내림 줄기 개수 (주기 P 당 4~7) */
export function dripCount(seed: number): number {
  return 4 + Math.floor(coatHash(1, seedUnit(seed)) * 4);
}

const TAU = Math.PI * 2;
const glslMod = (a: number, b: number) => a - b * Math.floor(a / b);

export type EdgeOptions = {
  /** 흘러내림 진행도 0~1. 저장된 레시피·확정 코팅은 1 (기본) */
  drip?: number;
  /** 막대(원기둥) 구간이면 true → 둘레 각도 좌표 */
  radial?: boolean;
};

/**
 * 경계 높이 보정 (모델 로컬 x, z). 범위 [-DRIP_MAX, WAVE_AMP] = [-0.35, 0.06].
 */
export function edgeOffset(x: number, z: number, seed: number, opts: EdgeOptions = {}): number {
  const drip = opts.drip ?? 1;
  const radial = opts.radial ?? false;
  const s = seedUnit(seed);
  const u = radial ? Math.atan2(z, x) * (EDGE_PERIOD / TAU) : x + FLAT_Z_SHEAR * z;
  const w = (TAU / EDGE_PERIOD) * u;
  const wave =
    WAVE_AMP *
    (0.55 * Math.sin(2 * w + TAU * coatHash(20, s)) +
      0.3 * Math.sin(5 * w + TAU * coatHash(21, s)) +
      0.15 * Math.sin(9 * w + TAU * coatHash(22, s)));
  const n = 4 + Math.floor(coatHash(1, s) * 4);
  const hwBase = radial ? DRIP_HALF_WIDTH_RADIAL : DRIP_HALF_WIDTH_FLAT;
  let sag = 0;
  for (let k = 0; k < MAX_DRIPS; k++) {
    if (k >= n) break;
    const c = (EDGE_PERIOD * (k + 0.15 + 0.7 * coatHash(2 + k, s))) / n;
    const hw = hwBase * (1 + 0.6 * coatHash(10 + k, s));
    const reach = DRIP_REACH_MIN + DRIP_REACH_RANGE * coatHash(30 + k, s);
    const d = glslMod(u - c + 0.5 * EDGE_PERIOD, EDGE_PERIOD) - 0.5 * EDGE_PERIOD;
    const q = d / hw;
    // 줄기 자리로 경계가 끌려 내려간 완만한 처짐
    sag = Math.max(sag, SAG_FRACTION * reach * Math.exp(-q * q));
  }
  return wave - sag * drip;
}

/*
 * 코팅 판정 규칙 (JS 와 GLSL 이 반드시 같아야 한다 — 한쪽을 고치면 다른 쪽도 고칠 것)
 *
 *   p = 모델 로컬 좌표, 평면 = (n, offset), e = edgeOffset(p.x, p.z, edgeSeed, { drip, radial })
 *   radial = 막대 구간 레이어 (depth = -offset < stickTop). stickTop = 막대 ON 이면 실루엣 시작 높이, OFF 면 0.
 *   dot(n, p) >= offset - e 이면 그 레이어가 p 를 덮는다.  (n=[0,-1,0] → y <= depth + e)
 *   drip 은 가장 최근 레이어만 uDripProgress, 나머지는 1. JS 는 항상 1(저장된 모습)로 판정한다.
 *   여러 레이어가 덮으면 뒤(나중) 레이어가 이긴다.
 *
 * JS:   isCoated() — 뒤에서부터 찾아 첫 매치 반환
 * GLSL: COATING_FRAGMENT — 앞에서부터 돌며 매치마다 덮어씀 (결과 동일)
 */
/** 이 레이어의 경계가 막대 구간에 있는가 (depth = -offset) */
export function isRadialLayer(offset: number, stickTop: number): boolean {
  return -offset < stickTop;
}

export function isCoated(p: Vec3, coatings: Coatings, stickTop = 0): CoatingType | null {
  for (let i = coatings.length - 1; i >= 0; i--) {
    const { normal: n, offset } = coatings[i].plane;
    const radial = isRadialLayer(offset, stickTop);
    const e = edgeOffset(p[0], p[2], coatings[i].edgeSeed, { radial });
    if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] >= offset - e) return coatings[i].type;
  }
  return null;
}

const glslFloat = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/** 프래그먼트 공용 선언: uniform + 해시 + 경계 함수 (edgeOffset 의 GLSL 판) */
const COATING_PARS = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
uniform vec4 uPlanes[${MAX_COATING_LAYERS}];
uniform vec3 uColors[${MAX_COATING_LAYERS}];
uniform float uRoughness[${MAX_COATING_LAYERS}];
uniform vec2 uEdge[${MAX_COATING_LAYERS}]; // (seedUnit, radial 0/1)
uniform int uCount;
uniform float uDripProgress;
float coatHash(float k, float s) {
  vec3 p3 = fract(vec3(k, s * 997.0, k) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float coatEdgeOffset(vec2 xz, float s, float radial, float drip) {
  const float P = ${glslFloat(EDGE_PERIOD)};
  const float TAU = 6.283185307179586;
  float u = radial > 0.5 ? atan(xz.y, xz.x) * (P / TAU) : xz.x + ${glslFloat(FLAT_Z_SHEAR)} * xz.y;
  float w = (TAU / P) * u;
  float wave = ${glslFloat(WAVE_AMP)} * (
    0.55 * sin(2.0 * w + TAU * coatHash(20.0, s)) +
    0.3 * sin(5.0 * w + TAU * coatHash(21.0, s)) +
    0.15 * sin(9.0 * w + TAU * coatHash(22.0, s)));
  float n = 4.0 + floor(coatHash(1.0, s) * 4.0);
  float hwBase = radial > 0.5 ? ${glslFloat(DRIP_HALF_WIDTH_RADIAL)} : ${glslFloat(DRIP_HALF_WIDTH_FLAT)};
  float sag = 0.0;
  for (int k = 0; k < ${MAX_DRIPS}; k++) {
    float fk = float(k);
    if (fk >= n) break;
    float c = P * (fk + 0.15 + 0.7 * coatHash(2.0 + fk, s)) / n;
    float hw = hwBase * (1.0 + 0.6 * coatHash(10.0 + fk, s));
    float reach = ${glslFloat(DRIP_REACH_MIN)} + ${DRIP_REACH_RANGE.toFixed(6)} * coatHash(30.0 + fk, s);
    float d = mod(u - c + 0.5 * P, P) - 0.5 * P;
    float q = d / hw;
    sag = max(sag, ${glslFloat(SAG_FRACTION)} * reach * exp(-q * q));
  }
  return wave - sag * drip;
}
// 흘러내린 줄기 + 끝 방울의 볼록 높이 (셸 범프용, 판정과 무관 → JS 짝 없음).
// below = 이 레이어 경계에서 아래로 떨어진 거리. 줄기 파라미터는 coatEdgeOffset 과 같은 해시.
float coatDripBump(vec2 xz, float s, float radial, float drip, float below) {
  const float P = ${glslFloat(EDGE_PERIOD)};
  const float TAU = 6.283185307179586;
  if (drip <= 0.0) return 0.0;
  float u = radial > 0.5 ? atan(xz.y, xz.x) * (P / TAU) : xz.x + ${glslFloat(FLAT_Z_SHEAR)} * xz.y;
  float n = 4.0 + floor(coatHash(1.0, s) * 4.0);
  float hwBase = radial > 0.5 ? ${glslFloat(DRIP_HALF_WIDTH_RADIAL)} : ${glslFloat(DRIP_HALF_WIDTH_FLAT)};
  float h = 0.0;
  for (int k = 0; k < ${MAX_DRIPS}; k++) {
    float fk = float(k);
    if (fk >= n) break;
    float c = P * (fk + 0.15 + 0.7 * coatHash(2.0 + fk, s)) / n;
    float hw = hwBase * (1.0 + 0.6 * coatHash(10.0 + fk, s));
    float reach = ${glslFloat(DRIP_REACH_MIN)} + ${DRIP_REACH_RANGE.toFixed(6)} * coatHash(30.0 + fk, s);
    float d = mod(u - c + 0.5 * P, P) - 0.5 * P;
    float ws = hw * ${glslFloat(STREAK_WIDTH)};
    float run = max(reach * ${glslFloat(1 - SAG_FRACTION)} * drip, 0.001);
    float across = sqrt(max(1.0 - (d * d) / (ws * ws), 0.0));
    float along = 1.0 - smoothstep(run * 0.7, run, below);
    float bq = (below - run * 0.85) / 0.045;
    float bead = sqrt(max(1.0 - (d * d) / (1.69 * ws * ws) - bq * bq, 0.0));
    h = max(h, max(across * along, 1.15 * bead));
  }
  return h * ${glslFloat(STREAK_HEIGHT)} * smoothstep(0.0, 0.15, drip);
}
`;

/**
 * coatIndex: 이긴 레이어 (-1 = 코팅 없음)
 * coatInside: 덮는 레이어들 중 경계 안쪽으로 가장 깊이 들어간 거리 (작을수록 보이는 경계에 가깝다)
 * coatNear: coatInside 를 준 레이어 (보이는 경계의 주인)
 * coatGap: 덮지 않는 레이어들 중 경계까지 가장 가까운 거리 (코팅 바깥에서 경계에 얼마나 가까운지)
 */
const COATING_FRAGMENT = /* glsl */ `
  int coatIndex = -1;
  int coatNear = -1;
  float coatInside = -1.0;
  float coatGap = 1000.0;
  for (int i = 0; i < ${MAX_COATING_LAYERS}; i++) {
    if (i >= uCount) break;
    float drip = (i == uCount - 1) ? uDripProgress : 1.0;
    float e = coatEdgeOffset(vLocalPos.xz, uEdge[i].x, uEdge[i].y, drip);
    float m = dot(uPlanes[i].xyz, vLocalPos) - (uPlanes[i].w - e);
    if (m >= 0.0) {
      coatIndex = i;
      if (m > coatInside) {
        coatInside = m;
        coatNear = i;
      }
    } else {
      coatGap = min(coatGap, -m);
    }
  }
`;

export type CoatingUniformArrays = {
  planes: THREE.Vector4[];
  colors: THREE.Color[];
  roughness: number[];
  /** (seedUnit, radial 0/1) */
  edges: THREE.Vector2[];
  count: number;
};

/** 코팅 목록을 고정 길이 uniform 배열로 채운다. `into` 를 주면 그 배열/객체를 제자리 갱신한다. */
export function packCoatingUniforms(
  coatings: Coatings,
  into?: CoatingUniformArrays,
  stickTop = 0,
): CoatingUniformArrays {
  const out: CoatingUniformArrays = into ?? {
    planes: Array.from({ length: MAX_COATING_LAYERS }, () => new THREE.Vector4()),
    colors: Array.from({ length: MAX_COATING_LAYERS }, () => new THREE.Color()),
    roughness: new Array<number>(MAX_COATING_LAYERS).fill(1),
    edges: Array.from({ length: MAX_COATING_LAYERS }, () => new THREE.Vector2()),
    count: 0,
  };
  const recent = coatings.slice(-MAX_COATING_LAYERS);
  recent.forEach((c, i) => {
    const [x, y, z] = c.plane.normal;
    out.planes[i].set(x, y, z, c.plane.offset);
    const look = coatingRegistry[c.type];
    out.colors[i].set(look.color);
    out.roughness[i] = look.roughness;
    out.edges[i].set(seedUnit(c.edgeSeed), isRadialLayer(c.plane.offset, stickTop) ? 1 : 0);
  });
  out.count = recent.length;
  return out;
}

export type CookieMaterialUniforms = {
  uPlanes: { value: THREE.Vector4[] };
  uColors: { value: THREE.Color[] };
  uRoughness: { value: number[] };
  uEdge: { value: THREE.Vector2[] };
  uCount: { value: number };
  /** 가장 최근 레이어의 흘러내림 진행도 (0~1). 나머지 레이어는 항상 1. */
  uDripProgress: { value: number };
};

const COOKIE_BASE = '#d9a066';
const COOKIE_EDGE = '#a8662e';

const LOCAL_VARYINGS_VERTEX = (shader: THREE.WebGLProgramParametersWithUniforms, extra = '') => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vLocalPos;
varying vec3 vLocalNormal;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vLocalPos = position;
vLocalNormal = normal;
${extra}`,
    );
};

/**
 * 쿠키 + 평면 코팅 머티리얼 (베이스). uniform 객체는 userData.coatingUniforms 에 고정되어 있어
 * `.value` 만 바꾸면 재컴파일 없이 반영된다 (setCoatings / setDripProgress 사용).
 * 코팅 영역은 초코 색으로 칠해 둔다 → 위에 덮이는 셸(createChocoShellMaterial) 가장자리가 비쳐도 단단해 보인다.
 */
export function createCookieMaterial(maxLayers = MAX_COATING_LAYERS): THREE.MeshStandardMaterial {
  if (maxLayers !== MAX_COATING_LAYERS) {
    throw new Error(`maxLayers 는 현재 ${MAX_COATING_LAYERS} 만 지원합니다`);
  }
  const material = new THREE.MeshStandardMaterial({ color: COOKIE_BASE, roughness: 0.85 });
  const packed = packCoatingUniforms([]);
  const uniforms: CookieMaterialUniforms = {
    uPlanes: { value: packed.planes },
    uColors: { value: packed.colors },
    uRoughness: { value: packed.roughness },
    uEdge: { value: packed.edges },
    uCount: { value: 0 },
    uDripProgress: { value: 1 },
  };
  material.userData.coatingUniforms = uniforms;
  material.userData.packed = packed;
  const edgeColor = new THREE.Color(COOKIE_EDGE);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uCookieEdge: { value: edgeColor } });
    LOCAL_VARYINGS_VERTEX(shader);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COATING_PARS}
uniform vec3 uCookieEdge;
float cookieHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${COATING_FRAGMENT}
{
  // 구운 색: 앞/뒷면은 밝고, 옆면·베벨(법선 z 가 작을수록)은 진하게 + 잔 노이즈
  float face = abs(normalize(vLocalNormal).z);
  float edge = 1.0 - smoothstep(0.35, 0.95, face);
  vec3 baked = mix(diffuseColor.rgb, uCookieEdge, edge * 0.85);
  float grain = cookieHash(floor(vLocalPos * 40.0)) - 0.5;
  baked *= 1.0 + grain * 0.12;
  diffuseColor.rgb = baked;
}
if (coatIndex >= 0) diffuseColor.rgb = uColors[coatIndex];
// 셸 가장자리 바로 위 쿠키에 얇은 접촉 그림자 → 초코가 얹혀 있는 두께감
else diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 0.035, coatGap));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (coatIndex >= 0) roughnessFactor = uRoughness[coatIndex];`,
      );
  };
  material.customProgramCacheKey = () => `pepero-cookie-${MAX_COATING_LAYERS}`;
  return material;
}

/** 초코 셸 두께 (법선 방향으로 부풀리는 양) */
export const SHELL_THICKNESS = 0.02;
/** 담근 끝(y≈0)에 맺히는 방울의 추가 두께 */
const TIP_BEAD = 0.018;
/** 경계 가장자리 둥근 립(두께감 하이라이트) 폭 */
const RIM_WIDTH = 0.07;

/**
 * 초코 셸: 베이스와 같은 지오메트리를 법선 방향으로 SHELL_THICKNESS 만큼 부풀리고, 코팅이 아닌 곳은 discard.
 * 판정은 부풀리기 전 좌표(vLocalPos = position)로 해서 베이스와 경계가 정확히 겹친다.
 * uniform 은 베이스와 같은 객체를 공유한다 → setCoatings / setDripProgress 한 번이면 둘 다 반영.
 */
export function createChocoShellMaterial(base: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const uniforms = base.userData.coatingUniforms as CookieMaterialUniforms;
  // 초코 roughness 0.35 + 얇은 클리어코트 → 조명이 하나뿐인 장면에서도 윤기 하이라이트가 또렷하다
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });
  material.userData.coatingUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    LOCAL_VARYINGS_VERTEX(
      shader,
      `{
  // 끝으로 흘러내린 초코가 방울로 맺힘: 담근 끝 근처만 조금 더 두껍게 (흘러내림 진행에 맞춰 자람)
  float bead = ${glslFloat(TIP_BEAD)} * (1.0 - smoothstep(0.0, 0.18, position.y)) * (0.35 + 0.65 * uDripProgress);
  transformed += normal * (${glslFloat(SHELL_THICKNESS)} + (uCount > 0 ? bead : 0.0));
  vUpView = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform int uCount;
uniform float uDripProgress;
varying vec3 vUpView;`,
    );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${COATING_PARS}
varying vec3 vUpView;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${COATING_FRAGMENT}
if (coatIndex < 0) discard;
// 0 = 경계 바로 아래(립), 1 = 충분히 안쪽
float coatRim = 1.0 - smoothstep(0.0, ${glslFloat(RIM_WIDTH)}, coatInside);
diffuseColor.rgb = uColors[coatIndex] * (1.0 + 0.3 * coatRim);
float coatNearDrip = (coatNear == uCount - 1) ? uDripProgress : 1.0;
float coatBump = coatDripBump(vLocalPos.xz, uEdge[coatNear].x, uEdge[coatNear].y, coatNearDrip, coatInside);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = uRoughness[coatIndex] * (1.0 - 0.25 * coatRim);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
// 경계 가장자리는 둥글게 말린 립: 법선을 모델 위(+y) 쪽으로 기울여 두께가 하이라이트로 보이게
normal = normalize(normal + vUpView * coatRim * 1.4);
{
  // 흘러내린 줄기·방울: 높이장 coatBump 의 화면 미분으로 법선을 기울인다 (three 의 perturbNormalArb 와 같은 방식)
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(coatBump);
  float dhy = dFdy(coatBump);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}`,
      );
  };
  material.customProgramCacheKey = () => `pepero-choco-shell-${MAX_COATING_LAYERS}`;
  return material;
}

/**
 * 머티리얼의 코팅 uniform 을 제자리 갱신 (재컴파일 없음). 셸은 같은 uniform 을 공유하므로 자동 반영.
 * stickTop: 막대 구간 윗끝 (stickTopFor(kind)). 생략하면 마지막으로 받은 값.
 */
export function setCoatings(
  material: THREE.MeshStandardMaterial,
  coatings: Coatings,
  stickTop: number = material.userData.stickTop ?? 0,
): void {
  material.userData.stickTop = stickTop;
  const uniforms = material.userData.coatingUniforms as CookieMaterialUniforms;
  const packed = packCoatingUniforms(coatings, material.userData.packed as CoatingUniformArrays, stickTop);
  uniforms.uCount.value = packed.count;
}

/** 가장 최근 코팅의 흘러내림 진행도 (0~1) */
export function setDripProgress(material: THREE.MeshStandardMaterial, progress: number): void {
  const uniforms = material.userData.coatingUniforms as CookieMaterialUniforms;
  uniforms.uDripProgress.value = Math.min(1, Math.max(0, progress));
}

/** 처음부터 코팅이 들어간 머티리얼. 첫 프레임부터 코팅이 보이도록 uniform 을 생성 시점에 채운다. */
export function createCoatedMaterial(
  coatings: Coatings,
  { dripProgress = 1, stickTop = 0 }: { dripProgress?: number; stickTop?: number } = {},
): THREE.MeshStandardMaterial {
  const material = createCookieMaterial();
  setCoatings(material, coatings, stickTop);
  setDripProgress(material, dripProgress);
  return material;
}
