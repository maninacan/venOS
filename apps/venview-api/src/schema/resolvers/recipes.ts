import type { AppContext } from '../../context/index.js';
import { requireAuth, requireCompanyMember } from '../../context/index.js';
import { supabase } from '../../lib/supabase.js';

export const recipeResolvers = {
  Query: {
    recipes: async (_: unknown, { companyId }: { companyId: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { data, error } = await supabase
        .from('RecipeCards')
        .select('*, RecipeIngredients(*)')
        .eq('companyId', companyId)
        .order('name');

      if (error) throw new Error(error.message);

      return (data ?? []).map((r: Record<string, unknown>) => {
        const ingredients = (r['RecipeIngredients'] as Array<Record<string, unknown>> ?? []);
        const totalCost = ingredients.reduce((sum, i) => sum + Number(i['quantity'] ?? 0) * Number(i['unitCost'] ?? 0), 0);
        return { ...r, id: r['id'], totalCost, ingredients };
      });
    },
  },

  Mutation: {
    createRecipe: async (
      _: unknown,
      { companyId, input }: { companyId: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);
      await requireCompanyMember(companyId, ctx.user!.id);

      const { ingredients, ...recipeFields } = input;

      const { data: recipe, error } = await supabase
        .from('RecipeCards')
        .insert({ ...recipeFields, companyId, userId: ctx.user!.id })
        .select()
        .single();

      if (error || !recipe) throw new Error(error?.message ?? 'Failed to create recipe');

      const recipeId = (recipe as Record<string, unknown>)['id'] as string;

      if (Array.isArray(ingredients) && ingredients.length > 0) {
        await supabase.from('RecipeIngredients').insert(
          (ingredients as Array<Record<string, unknown>>).map(ing => ({ ...ing, recipeId }))
        );
      }

      const { data: full } = await supabase
        .from('RecipeCards')
        .select('*, RecipeIngredients(*)')
        .eq('id', recipeId)
        .single();

      const row = full as Record<string, unknown>;
      const ings = (row['RecipeIngredients'] as Array<Record<string, unknown>> ?? []);
      return { ...row, id: row['id'], totalCost: ings.reduce((s, i) => s + Number(i['quantity'] ?? 0) * Number(i['unitCost'] ?? 0), 0), ingredients: ings };
    },

    updateRecipe: async (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: AppContext
    ) => {
      requireAuth(ctx);

      const { ingredients, ...recipeFields } = input;

      const { error } = await supabase.from('RecipeCards').update(recipeFields).eq('id', id);
      if (error) throw new Error(error.message);

      if (Array.isArray(ingredients)) {
        await supabase.from('RecipeIngredients').delete().eq('recipeId', id);
        if (ingredients.length > 0) {
          await supabase.from('RecipeIngredients').insert(
            (ingredients as Array<Record<string, unknown>>).map(ing => ({ ...ing, recipeId: id }))
          );
        }
      }

      const { data: full } = await supabase
        .from('RecipeCards')
        .select('*, RecipeIngredients(*)')
        .eq('id', id)
        .single();

      const row = full as Record<string, unknown>;
      const ings = (row['RecipeIngredients'] as Array<Record<string, unknown>> ?? []);
      return { ...row, id: row['id'], totalCost: ings.reduce((s, i) => s + Number(i['quantity'] ?? 0) * Number(i['unitCost'] ?? 0), 0), ingredients: ings };
    },

    deleteRecipe: async (_: unknown, { id }: { id: string }, ctx: AppContext) => {
      requireAuth(ctx);
      await supabase.from('RecipeCards').delete().eq('id', id);
      return true;
    },
  },
};
