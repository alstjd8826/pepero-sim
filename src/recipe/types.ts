import { z } from 'zod';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Silhouette = { outer: Vec2[]; holes?: Vec2[][] };

export type BaseKind = 'stick' | 'none';

export const COATING_TYPES = ['milk-choco', 'dark-choco', 'white-choco', 'strawberry', 'matcha', 'blueberry'] as const;
export type CoatingType = (typeof COATING_TYPES)[number];

export const PEN_COLORS = ['white', 'dark', 'pink', 'yellow', 'mint', 'sky'] as const;
export type PenColor = (typeof PEN_COLORS)[number];
export const PEN_WIDTHS = ['thin', 'thick'] as const;
export type PenWidth = (typeof PEN_WIDTHS)[number];

export const TOPPING_TYPES = ['almond', 'crunch', 'sprinkle', 'star', 'pearl', 'heart'] as const;
export type ToppingType = (typeof TOPPING_TYPES)[number];

/** 초코펜 한 획. points 는 모델 로컬 좌표의 튜브 중심선(표면에서 이미 띄운 점). */
export type Stroke = { color: PenColor; width: PenWidth; points: Vec3[] };
/** 토핑 하나. position 은 모델 로컬 표면 점(오프셋 전), normal 은 표면 법선, spin 은 법선 둘레 회전(라디안). */
export type Topping = { type: ToppingType; position: Vec3; normal: Vec3; spin: number };

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
    type: CoatingType;
    plane: { normal: [number, number, number]; offset: number };
    edgeSeed: number;
  }>;
  toppings: Topping[];
  /** 초코펜 그림. 꾸미기 기능 이전 레시피에는 없다. */
  strokes?: Stroke[];
};

export type Coating = PeperoRecipe['coatings'][number];

export const MAX_OUTER_POINTS = 400;
export const MAX_COATINGS = 50;
export const MAX_TOPPINGS = 200;
export const MAX_STROKES = 80;
export const MAX_STROKE_POINTS = 300;
/** 레시피 전체 64KB 상한(DB CHECK) 안에 들어가도록 선 점 개수를 합쳐서 제한한다 */
export const MAX_TOTAL_STROKE_POINTS = 1500;
/** 저장되는 각인 높이맵 키. 렌더러가 이 주소를 가져오므로 임의 URL 은 받지 않는다 (DB CHECK 와 같은 규칙). */
export const RELIEF_KEY_RE = /^reliefs\/[A-Za-z0-9]{8}\.png$/;

const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

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
        type: z.enum(COATING_TYPES),
        plane: z.object({
          normal: z.tuple([z.number(), z.number(), z.number()]),
          offset: z.number(),
        }),
        edgeSeed: z.number(),
      }),
    )
    .max(MAX_COATINGS),
  toppings: z
    .array(
      z.object({
        type: z.enum(TOPPING_TYPES),
        position: vec3,
        normal: vec3,
        spin: z.number().finite(),
      }),
    )
    .max(MAX_TOPPINGS),
  strokes: z
    .array(
      z.object({
        color: z.enum(PEN_COLORS),
        width: z.enum(PEN_WIDTHS),
        points: z.array(vec3).min(2).max(MAX_STROKE_POINTS),
      }),
    )
    .max(MAX_STROKES)
    .refine((ss) => ss.reduce((n, s) => n + s.points.length, 0) <= MAX_TOTAL_STROKE_POINTS, {
      message: `선의 점은 합쳐서 ${MAX_TOTAL_STROKE_POINTS}개까지`,
    })
    .optional(),
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
