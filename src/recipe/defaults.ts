import type { PeperoRecipe, Silhouette } from './types';

export function createRecipe(silhouette: Silhouette, hasStick: boolean): PeperoRecipe {
  return {
    schemaVersion: 1,
    shape: { silhouette, thickness: 0.3 },
    base: { kind: hasStick ? 'stick' : 'none', cookieFlavor: 'plain' },
    coatings: [],
    toppings: [],
  };
}
