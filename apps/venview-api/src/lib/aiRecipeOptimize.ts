import Anthropic from '@anthropic-ai/sdk';
import logger from './logger.js';

// AI-assisted recipe optimization. Given a company's recipes (plus inventory
// items and modifier mappings for confident linking), Claude classifies each
// recipe as a genuinely DISTINCT recipe or a 1-off VARIANT of a shared base
// (e.g. "Limeade – Strawberry" = a Limeade base + a Strawberry add-on) and
// proposes restructuring each variant into `base recipe + add-on`.
//
// These are RECOMMENDATIONS only — the user reviews a before/after and accepts
// all or per-line before anything is applied.

export interface OptimizeRecipeLite { id: string; name: string; ingredients: OptimizeLine[] }
export interface OptimizeInventoryLite { id: string; name: string; unitCost: number }
export interface OptimizeModifierLite { id: string; name: string; cost: number }
export interface OptimizeLine { name: string; quantity: number; unitCost: number; unit: string | null }

export interface RecipeOptimization {
  recipeId: string;
  kind: 'variant' | 'distinct';
  baseFamilyKey: string | null;
  baseExistingRecipeId: string | null;   // an existing recipe that is the base
  baseNewName: string | null;            // when the base must be created
  baseNewIngredients: OptimizeLine[];    // ingredients for the base to create
  addonKeepIngredients: OptimizeLine[];  // differing ingredients kept as free-text (when not linked)
  addonModifierId: string | null;        // confident modifier link for the add-on
  addonInventoryId: string | null;       // confident inventory link for the add-on
  addonQuantity: number;
  confidence: number;                    // 0..1
  reason: string;
}

const MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 3;

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    return s === 408 || s === 409 || s === 429 || (typeof s === 'number' && s >= 500);
  }
  return false;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

const SYSTEM = `You optimize a food/drink vendor's recipe list by finding "1-off variants" — recipes that are really a shared base plus a single add-on — so they can be restructured into a base recipe + an add-on, instead of many near-duplicate recipes.

You are given "recipes" (each with id, name, ingredients), "inventory" items, and "modifiers" (each with id, name, cost).

Group recipes into FAMILIES that share a common base (e.g. "Limeade – Strawberry", "Limeade – Peach" share a "Limeade" base). For each family:
- Choose the base. If one of the provided recipes is plainly the base itself (e.g. a plain "Limeade"), set its id as existingRecipeId. Otherwise propose a new base: a short name and the ingredients common to the whole family.
- For each VARIANT recipe in the family, identify the differing add-on ingredient(s) — the ones NOT in the base. If an inventory item or modifier clearly matches that add-on by name, reference its id (addonInventoryId or addonModifierId) so its cost stays live; otherwise leave those null and put the differing ingredient(s) in addonKeepIngredients.

Recipes that are genuinely standalone (not part of any base+add-on family) are "distinct" — return them with kind:"distinct" and nothing else.

Rules:
- NEVER invent ids. Only use recipe/inventory/modifier ids present in the input. Use null when unsure.
- Only mark a recipe "variant" when you are reasonably confident it is base+add-on; otherwise "distinct".
- A base recipe (existingRecipeId) must be a DIFFERENT recipe than the variant.
- Prefer linking the add-on (addonInventoryId/addonModifierId) only when the name match is confident; else keep it as a free-text ingredient in addonKeepIngredients.

Return ONLY raw JSON, no markdown, no prose:
{
  "bases": [{ "familyKey": "limeade", "existingRecipeId": "..."|null, "name": "Limeade"|null, "ingredients": [{"name":"...","quantity":1,"unitCost":0,"unit":"oz"}] }],
  "recommendations": [
    { "recipeId": "...", "kind": "variant", "familyKey": "limeade",
      "addonKeepIngredients": [{"name":"Strawberry syrup","quantity":1,"unitCost":0.05,"unit":"oz"}],
      "addonModifierId": "..."|null, "addonInventoryId": "..."|null, "addonQuantity": 1,
      "confidence": 0.0, "reason": "..." },
    { "recipeId": "...", "kind": "distinct", "confidence": 0.9, "reason": "..." }
  ]
}`;

function sanitizeLines(raw: unknown): OptimizeLine[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter(l => typeof l['name'] === 'string' && (l['name'] as string).trim())
    .map(l => ({
      name: (l['name'] as string).trim().slice(0, 200),
      quantity: Number.isFinite(Number(l['quantity'])) ? Number(l['quantity']) : 1,
      unitCost: Number.isFinite(Number(l['unitCost'])) ? Number(l['unitCost']) : 0,
      unit: typeof l['unit'] === 'string' ? (l['unit'] as string).slice(0, 40) : null,
    }));
}

export async function optimizeRecipes(
  recipes: OptimizeRecipeLite[],
  inventory: OptimizeInventoryLite[],
  modifiers: OptimizeModifierLite[],
): Promise<RecipeOptimization[]> {
  if (recipes.length === 0) return [];

  const payload = {
    recipes: recipes.map(r => ({
      id: r.id,
      name: r.name,
      ingredients: r.ingredients.map(i => ({ name: i.name, quantity: Number(i.quantity), unitCost: Number(Number(i.unitCost).toFixed(4)), unit: i.unit ?? undefined })),
    })),
    inventory: inventory.map(i => ({ id: i.id, name: i.name, unitCost: Number(i.unitCost).toFixed(4) })),
    modifiers: modifiers.map(m => ({ id: m.id, name: m.name, cost: Number(m.cost).toFixed(4) })),
  };

  const anthropic = new Anthropic();
  let text = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await anthropic.messages
        .stream({ model: MODEL, max_tokens: 32000, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(payload) }] })
        .finalMessage();
      if (res.stop_reason === 'max_tokens') {
        logger.warn('optimizeRecipes: hit max_tokens; some recommendations may be dropped', { recipes: recipes.length });
      }
      text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
      break;
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (attempt >= MAX_ATTEMPTS - 1 || !isTransient(err)) {
        logger.error('optimizeRecipes: Anthropic call failed', { attempt, detail, error: err });
        throw err;
      }
      logger.warn('optimizeRecipes: transient Anthropic error, retrying', { attempt, detail });
    }
  }

  const parsed = parseJsonObject(text);
  const basesRaw = Array.isArray(parsed['bases']) ? parsed['bases'] as Array<Record<string, unknown>> : [];
  const recsRaw = Array.isArray(parsed['recommendations']) ? parsed['recommendations'] as Array<Record<string, unknown>> : [];

  const recipeIds = new Set(recipes.map(r => r.id));
  const inventoryIds = new Set(inventory.map(i => i.id));
  const modifierIds = new Set(modifiers.map(m => m.id));

  // Build family base lookup, validating existing-recipe references.
  const baseByFamily = new Map<string, { existingRecipeId: string | null; name: string | null; ingredients: OptimizeLine[] }>();
  for (const b of basesRaw) {
    const key = typeof b['familyKey'] === 'string' ? b['familyKey'] as string : null;
    if (!key) continue;
    const existing = b['existingRecipeId'] != null && recipeIds.has(String(b['existingRecipeId'])) ? String(b['existingRecipeId']) : null;
    baseByFamily.set(key, {
      existingRecipeId: existing,
      name: typeof b['name'] === 'string' ? (b['name'] as string).trim().slice(0, 120) : null,
      ingredients: sanitizeLines(b['ingredients']),
    });
  }

  const seen = new Set<string>();
  const out: RecipeOptimization[] = [];
  for (const r of recsRaw) {
    const recipeId = String(r['recipeId'] ?? '');
    if (!recipeIds.has(recipeId) || seen.has(recipeId)) continue;
    seen.add(recipeId);

    const confRaw = Number(r['confidence'] ?? 0);
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0;
    const reason = typeof r['reason'] === 'string' ? (r['reason'] as string).slice(0, 200) : '';
    const familyKey = typeof r['familyKey'] === 'string' ? r['familyKey'] as string : null;
    const base = familyKey ? baseByFamily.get(familyKey) : undefined;

    // A variant needs a resolvable base that isn't itself; otherwise it's distinct.
    const existingBase = base?.existingRecipeId && base.existingRecipeId !== recipeId ? base.existingRecipeId : null;
    const canCreateBase = !!base?.name && base.ingredients.length > 0;
    const isVariant = r['kind'] === 'variant' && (existingBase || canCreateBase);

    if (!isVariant) {
      out.push({
        recipeId, kind: 'distinct', baseFamilyKey: null, baseExistingRecipeId: null,
        baseNewName: null, baseNewIngredients: [], addonKeepIngredients: [],
        addonModifierId: null, addonInventoryId: null, addonQuantity: 1, confidence, reason,
      });
      continue;
    }

    const addonModifierId = r['addonModifierId'] != null && modifierIds.has(String(r['addonModifierId'])) ? String(r['addonModifierId']) : null;
    // Only one add-on link is applied; a modifier link wins over inventory.
    const addonInventoryId = !addonModifierId && r['addonInventoryId'] != null && inventoryIds.has(String(r['addonInventoryId'])) ? String(r['addonInventoryId']) : null;
    const aqRaw = Number(r['addonQuantity'] ?? 1);

    out.push({
      recipeId,
      kind: 'variant',
      baseFamilyKey: familyKey,
      baseExistingRecipeId: existingBase,
      baseNewName: existingBase ? null : base!.name,
      baseNewIngredients: existingBase ? [] : base!.ingredients,
      addonKeepIngredients: sanitizeLines(r['addonKeepIngredients']),
      addonModifierId,
      addonInventoryId,
      addonQuantity: Number.isFinite(aqRaw) ? aqRaw : 1,
      confidence,
      reason,
    });
  }

  return out;
}
