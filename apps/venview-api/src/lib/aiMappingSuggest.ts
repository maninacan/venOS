import Anthropic from '@anthropic-ai/sdk';
import logger from './logger.js';

// AI-assisted POS→cost mapping suggestions. Given the POS catalog plus the
// company's recipes and inventory items, Claude proposes the best recipe and/or
// inventory match per POS item. These are SUGGESTIONS only — the user reviews
// and accepts/rejects them in the mapping modal before anything is saved.

export interface CatalogItemLite { posItemId: string; posItemName: string; variationName?: string | null }
export interface RecipeLite { id: string; name: string; totalCost: number }
export interface InventoryLite { id: string; name: string; unitCost: number }

export interface MappingSuggestion {
  posItemId: string;
  recipeId: string | null;
  inventoryId: string | null;
  confidence: number;   // 0..1
  reason: string;
}

const MODEL = 'claude-opus-4-8';
const MAX_ATTEMPTS = 3;

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    return s === 408 || s === 409 || s === 429 || (typeof s === 'number' && s >= 500);
  }
  return false;
}

// Strip markdown fences / prose and return the first JSON object in the text.
function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

const SYSTEM = `You match point-of-sale (POS) menu items to the vendor's recipes and inventory items so their cost of goods (COGS) can be calculated.

For EACH pos item, choose:
- recipeId: the id of the recipe that best represents how that item is made (a "Lemonade (Regular)" POS item → a "Lemonade" recipe). Prefer a recipe when a reasonable match exists — the recipe's ingredient cost is the most accurate COGS.
- inventoryId: the id of the single inventory item that best matches, as a fallback cost source when no recipe fits (e.g. resale items).
- confidence: 0.0–1.0, how sure you are of the match.
- reason: one short phrase explaining the match.

Match on meaning, not just exact text: ignore variation suffixes like "(Regular)"/"(SF)", singular/plural, and word order. If nothing is a reasonable match, use null for that field. It is better to return null than to force a wrong match. Never invent ids — only use ids present in the provided lists.

Return ONLY raw JSON, no markdown, no prose:
{"suggestions":[{"posItemId":"...","recipeId":"..."|null,"inventoryId":"..."|null,"confidence":0.0,"reason":"..."}]}`;

export async function suggestMappings(
  catalog: CatalogItemLite[],
  recipes: RecipeLite[],
  inventory: InventoryLite[]
): Promise<MappingSuggestion[]> {
  if (catalog.length === 0) return [];

  const payload = {
    posItems: catalog.map(c => ({
      posItemId: c.posItemId,
      name: c.variationName && c.variationName.toLowerCase() !== 'regular'
        ? `${c.posItemName} (${c.variationName})` : c.posItemName,
    })),
    recipes: recipes.map(r => ({ id: r.id, name: r.name, cost: Number(r.totalCost).toFixed(2) })),
    inventory: inventory.map(i => ({ id: i.id, name: i.name, unitCost: Number(i.unitCost).toFixed(2) })),
  };

  const anthropic = new Anthropic();
  let text = '';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      });
      text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
      break;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isTransient(err)) {
        logger.error('suggestMappings: Anthropic call failed', { error: err });
        throw err;
      }
    }
  }

  // Validate ids against the provided lists — never trust the model to not hallucinate.
  const recipeIds = new Set(recipes.map(r => r.id));
  const inventoryIds = new Set(inventory.map(i => i.id));
  const catalogIds = new Set(catalog.map(c => c.posItemId));

  const parsed = parseJsonObject(text);
  const rows = Array.isArray(parsed['suggestions']) ? parsed['suggestions'] as Array<Record<string, unknown>> : [];
  return rows
    .filter(r => catalogIds.has(String(r['posItemId'])))
    .map(r => {
      const recipeId = r['recipeId'] != null && recipeIds.has(String(r['recipeId'])) ? String(r['recipeId']) : null;
      const inventoryId = r['inventoryId'] != null && inventoryIds.has(String(r['inventoryId'])) ? String(r['inventoryId']) : null;
      const confRaw = Number(r['confidence'] ?? 0);
      return {
        posItemId: String(r['posItemId']),
        recipeId,
        inventoryId,
        confidence: Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0,
        reason: typeof r['reason'] === 'string' ? (r['reason'] as string).slice(0, 200) : '',
      };
    })
    .filter(s => s.recipeId || s.inventoryId);
}
