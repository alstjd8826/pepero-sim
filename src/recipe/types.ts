import { z } from 'zod';

export type Vec2 = [number, number];
export type Silhouette = { outer: Vec2[]; holes?: Vec2[][] };

export type BaseKind = 'stick' | 'none';
export type CoatingType = 'milk-choco';

export type PeperoRecipe = {
  schemaVersion: 1;
  shape: {
    silhouette: Silhouette; // 정규화 좌표
    thickness: number;
    /**
     * 앞면 각인 (없으면 매끈한 면). heightmapUrl 은 외부 URL 이 아니라 이 프로젝트 Storage 키
     * `reliefs/<id>.png` 다 — 렌더 시 resolveReliefUrl 로 공개 URL 을 만든다. strength 0~1.
     */
    relief?: { heightmapUrl: string; strength: number };
  };
  base: {
    kind: BaseKind; // 이후 'double-stick' 등 확장
    cookieFlavor: 'plain'; // 이후 'cocoa' 등
  };
  coatings: Array<{
    type: CoatingType; // 이후 'white', 'strawberry' 등
    plane: { normal: [number, number, number]; offset: number };
    edgeSeed: number;
  }>;
  toppings: never[]; // v1 비어 있음. 이후 { type, position, normal, ... }
};

export type Coating = PeperoRecipe['coatings'][number];

export const MAX_OUTER_POINTS = 400;
export const MAX_COATINGS = 50;
/** 저장되는 각인 높이맵 키. 렌더러가 이 주소를 가져오므로 임의 URL 은 받지 않는다 (DB CHECK 와 같은 규칙). */
export const RELIEF_KEY_RE = /^reliefs\/[A-Za-z0-9]{8}\.png$/;

const vec2 = z.tuple([z.number().finite(), z.number().finite()]);

export const recipeSchema = z.object({
  schemaVersion: z.literal(1),
  shape: z.object({
    silhouette: z.object({
      outer: z.array(vec2).min(3).max(MAX_OUTER_POINTS),
      holes: z.array(z.array(vec2).min(3).max(MAX_OUTER_POINTS)).optional(),
    }),
    thickness: z.number().positive(),
    relief: z
      .object({
        heightmapUrl: z.string().regex(RELIEF_KEY_RE),
        strength: z.number().min(0).max(1),
      })
      .optional(),
  }),
  base: z.object({
    kind: z.enum(['stick', 'none']),
    cookieFlavor: z.literal('plain'),
  }),
  coatings: z
    .array(
      z.object({
        type: z.literal('milk-choco'),
        plane: z.object({
          normal: z.tuple([z.number(), z.number(), z.number()]),
          offset: z.number(),
        }),
        edgeSeed: z.number(),
      }),
    )
    .max(MAX_COATINGS),
  toppings: z.array(z.never()) as z.ZodType<never[]>,
});

// 스키마와 타입이 어긋나면 tsc 가 실패한다 (양방향 대입 검사).
type Inferred = z.infer<typeof recipeSchema>;
const _schemaToType = (v: Inferred): PeperoRecipe => v;
const _typeToSchema = (v: PeperoRecipe): Inferred => v;
void _schemaToType;
void _typeToSchema;

export function parseRecipe(json: unknown): PeperoRecipe {
  return recipeSchema.parse(json);
}
export { createRecipe } from './defaults';
