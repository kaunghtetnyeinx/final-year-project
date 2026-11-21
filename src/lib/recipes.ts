import { RecipeLine } from "./types"

/** The base unit already used for an ingredient in any recipe (ERD: one consistent unit per ingredient). */
export const baseUnitOf = (ingredientId: number, recipes: RecipeLine[], exceptRecipeId?: number) =>
  recipes.find((r) => r.ingredientId === ingredientId && r.recipeId !== exceptRecipeId)?.unit
