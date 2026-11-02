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
    relief?: { heightmapUrl: string; strength: number }; // 앞면 각인 (없으면 매끈한 면)
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
      .object({ heightmapUrl: z.string(), strength: z.number() })
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
  toppings: z.array(z.never()),
}) as unknown as z.ZodType<PeperoRecipe>;

export function parseRecipe(json: unknown): PeperoRecipe {
  return recipeSchema.parse(json);
}
export { createRecipe } from './defaults';
