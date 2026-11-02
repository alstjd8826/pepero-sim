import * as THREE from 'three';
import type { CoatingType, PeperoRecipe } from '@/src/recipe/types';
import { coatingRegistry } from './registry';

/** 셰이더 uniform 배열의 고정 길이. 레시피는 최대 50개까지 허용하므로 초과분은 최신 16개만 그린다. */
export const MAX_COATING_LAYERS = 16;

type Coatings = PeperoRecipe['coatings'];
type Vec3 = [number, number, number];

/*
 * 코팅 판정 규칙 (JS 와 GLSL 이 반드시 같아야 한다 — 한쪽을 고치면 다른 쪽도 고칠 것)
 *
 *   p = 모델 로컬 좌표, 평면 = (n, offset)
 *   dot(n, p) >= offset 이면 그 레이어가 p 를 덮는다.
 *   여러 레이어가 덮으면 뒤(나중) 레이어가 이긴다.
 *
 * JS:   isCoated() — 뒤에서부터 찾아 첫 매치 반환
 * GLSL: COATING_FRAGMENT — 앞에서부터 돌며 매치마다 덮어씀 (결과 동일)
 */
export function isCoated(p: Vec3, coatings: Coatings): CoatingType | null {
  for (let i = coatings.length - 1; i >= 0; i--) {
    const { normal: n, offset } = coatings[i].plane;
    if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] >= offset) return coatings[i].type;
  }
  return null;
}

const COATING_FRAGMENT = /* glsl */ `
  int coatIndex = -1;
  for (int i = 0; i < ${MAX_COATING_LAYERS}; i++) {
    if (i >= uCount) break;
    if (dot(uPlanes[i].xyz, vLocalPos) >= uPlanes[i].w) coatIndex = i;
  }
`;

export type CoatingUniformArrays = {
  planes: THREE.Vector4[];
  colors: THREE.Color[];
  roughness: number[];
  count: number;
};

/** 코팅 목록을 고정 길이 uniform 배열로 채운다. `into` 를 주면 그 배열/객체를 제자리 갱신한다. */
export function packCoatingUniforms(
  coatings: Coatings,
  into?: CoatingUniformArrays,
): CoatingUniformArrays {
  const out: CoatingUniformArrays = into ?? {
    planes: Array.from({ length: MAX_COATING_LAYERS }, () => new THREE.Vector4()),
    colors: Array.from({ length: MAX_COATING_LAYERS }, () => new THREE.Color()),
    roughness: new Array<number>(MAX_COATING_LAYERS).fill(1),
    count: 0,
  };
  const recent = coatings.slice(-MAX_COATING_LAYERS);
  recent.forEach((c, i) => {
    const [x, y, z] = c.plane.normal;
    out.planes[i].set(x, y, z, c.plane.offset);
    const look = coatingRegistry[c.type];
    out.colors[i].set(look.color);
    out.roughness[i] = look.roughness;
  });
  out.count = recent.length;
  return out;
}

export type CookieMaterialUniforms = {
  uPlanes: { value: THREE.Vector4[] };
  uColors: { value: THREE.Color[] };
  uRoughness: { value: number[] };
  uCount: { value: number };
};

const COOKIE_BASE = '#d9a066';
const COOKIE_EDGE = '#a8662e';

/**
 * 쿠키 + 평면 코팅 머티리얼. uniform 객체는 userData.coatingUniforms 에 고정되어 있어
 * `.value` 만 바꾸면 재컴파일 없이 반영된다 (setCoatings 사용).
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
    uCount: { value: 0 },
  };
  material.userData.coatingUniforms = uniforms;
  material.userData.packed = packed;
  const edgeColor = new THREE.Color(COOKIE_EDGE);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uCookieEdge: { value: edgeColor } });

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
vLocalNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
uniform vec4 uPlanes[${MAX_COATING_LAYERS}];
uniform vec3 uColors[${MAX_COATING_LAYERS}];
uniform float uRoughness[${MAX_COATING_LAYERS}];
uniform int uCount;
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
if (coatIndex >= 0) diffuseColor.rgb = uColors[coatIndex];`,
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

/** 머티리얼의 코팅 uniform 을 제자리 갱신 (재컴파일 없음). */
export function setCoatings(material: THREE.MeshStandardMaterial, coatings: Coatings): void {
  const uniforms = material.userData.coatingUniforms as CookieMaterialUniforms;
  const packed = packCoatingUniforms(coatings, material.userData.packed as CoatingUniformArrays);
  uniforms.uCount.value = packed.count;
}

/** 처음부터 코팅이 들어간 머티리얼. 첫 프레임부터 코팅이 보이도록 uniform 을 생성 시점에 채운다. */
export function createCoatedMaterial(coatings: Coatings): THREE.MeshStandardMaterial {
  const material = createCookieMaterial();
  setCoatings(material, coatings);
  return material;
}
