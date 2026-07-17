import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase.js';
import { createContext } from '../context/index.js';

// pdf-parse ships CJS-only; require() works fine since this project builds as CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const RECIPE_EXTRACT_PROMPT = `You are a recipe data extraction assistant. Extract every recipe and all its ingredients from the provided content.

The content may arrive in any format — CSV, spreadsheet text, PDF, plain text, menu, recipe card, or an image/photo. Adapt your reading strategy to whatever you receive.

STEP 1 — Understand the layout.
- CSV / spreadsheet text: mentally reconstruct the 2-D grid (each line = a row, each comma-separated value = a cell). Recipes may be stacked vertically one after another, or arranged side-by-side in columns across the grid. Trailing empty cells are padding — ignore them.
- PDF / plain text / menu: identify recipe sections by name headings and ingredient lists beneath them.
- Image / photo: identify every recipe and ingredient list visible in the image.

STEP 2 — Find ALL recipe blocks.
A recipe block = a name + a list of ingredients. Scan the entire content — do not stop after the first recipe. Common signals for a recipe name: a standalone label before ingredient rows, a bold or larger heading, a cell with only a drink/dish name.

STEP 3 — For each recipe, extract ALL ingredient rows.
Skip these rows entirely — they are NOT ingredients:
  • Column-header rows: "Ingredient Name", "Quantity", "Unit", "Cost", "Unit Cost", or similar labels
  • Summary/total rows: any row starting with "Cost Per Drink", "Cost Per Item", "Total", "Subtotal", "Cost Per Serving", or similar
  • Blank rows

STEP 4 — Output.
Return ONLY a raw JSON object — no markdown fences, no explanation, no surrounding text:
{
  "recipes": [
    {
      "name": "Recipe Name",
      "ingredients": [
        { "name": "ingredient name", "quantity": 1.0, "unit": "oz", "unitCost": 0.25 }
      ]
    }
  ]
}

Rules:
- Strip currency symbols from costs ("$0.25" → 0.25). If cost is missing or unclear, use 0.
- If quantity is missing, use 1. If unit is missing, use "".
- Recipe names should be clean and properly capitalized.
- Return an empty recipes array if no recipes are found.`;

const INVENTORY_EXTRACT_PROMPT = `You are an inventory/product-catalog data extraction assistant. Extract every product/item from the provided content.

The content may arrive in any format — CSV, spreadsheet text, PDF, plain text, vendor invoice, order guide, price list, or an image/photo of a shelf, invoice, or spreadsheet. Adapt your reading strategy to whatever you receive.

STEP 1 — Understand the layout.
- CSV / spreadsheet text: mentally reconstruct the 2-D grid (each line = a row, each comma-separated value = a cell). Trailing empty cells are padding — ignore them.
- PDF / plain text / invoice / price list: identify each line item and its associated cost/quantity.
- Image / photo: identify every distinct product visible.

STEP 2 — Find ALL items.
An item = a product name plus whatever attributes are available (category, unit cost, quantity on hand, reorder threshold, SKU). Scan the entire content — do not stop after the first item.

STEP 3 — Skip these rows entirely — they are NOT items:
  • Column-header rows: "Item Name", "Name", "Category", "Cost", "Unit Cost", "Quantity", "On Hand", "Reorder", "SKU", or similar labels
  • Summary/total rows: any row starting with "Total", "Subtotal", "Grand Total", or similar
  • Blank rows

STEP 4 — Output.
Return ONLY a raw JSON object — no markdown fences, no explanation, no surrounding text:
{
  "items": [
    { "name": "item name", "category": "Syrups", "unitCost": 3.50, "quantityOnHand": 10, "reorderThreshold": 2, "sku": "SYR-001" }
  ]
}

Rules:
- Strip currency symbols from costs ("$3.50" → 3.50). If cost is missing or unclear, use 0.
- If quantityOnHand is missing, use 0. If reorderThreshold is missing, use 0.
- category, sku may be empty strings if not present.
- Item names should be clean and properly capitalized.
- Return an empty items array if no items are found.`;

type ParsedUpload = {
  isImage: boolean;
  userContent: string | Anthropic.MessageParam['content'];
  extractedText: string;
};

// Turn an uploaded file into content suitable for an Anthropic message:
// images become an image content block; everything else is parsed to text.
// Throws if no text could be extracted from a non-image file.
async function parseUploadToContent(file: Express.Multer.File): Promise<ParsedUpload> {
  const mime = file.mimetype;
  const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  const isImage = mime.startsWith('image/');

  if (isImage) {
    const validImageMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    type ValidImageMime = typeof validImageMime[number];
    const mediaMime: ValidImageMime = validImageMime.includes(mime as ValidImageMime)
      ? (mime as ValidImageMime)
      : 'image/jpeg';

    return {
      isImage: true,
      extractedText: '',
      userContent: [{
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaMime, data: file.buffer.toString('base64') },
      }],
    };
  }

  let text: string;
  if (mime === 'application/pdf' || ext === 'pdf') {
    const parsed = await pdfParse(file.buffer);
    text = parsed.text;
  } else if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    ext === 'xlsx' || ext === 'xls'
  ) {
    const wb = XLSX.read(file.buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    text = XLSX.utils.sheet_to_csv(ws);
  } else {
    text = file.buffer.toString('utf-8');
  }

  if (!text.trim()) throw new Error('Could not extract text from file');

  // Strip trailing empty columns from each row (Google Sheets exports ~87 trailing commas)
  const trimmedRows = text.split('\n').map(row => {
    const cols = row.split(',');
    let last = cols.length - 1;
    while (last >= 0 && !cols[last].trim().replace(/^"|"$/g, '')) last--;
    return cols.slice(0, last + 1).join(',');
  }).filter(row => row.trim());

  // Detect side-by-side recipe blocks (Google Sheets tables arranged horizontally).
  // When found, split into separate vertical sections so Claude can read each cleanly.
  text = splitSideBySideBlocks(trimmedRows);

  return { isImage: false, extractedText: text, userContent: text };
}

// Detect Google-Sheets-style CSVs where multiple recipe tables are arranged
// side-by-side in columns (separated by a wide block of empty cells). When
// detected, extract each column-block as its own vertical section so Claude
// can parse each table cleanly instead of seeing ~80 empty commas per row.
function splitSideBySideBlocks(rows: string[]): string {
  if (rows.length === 0) return '';

  // Parse every row into an array of cell values.
  const parsed = rows.map(r => r.split(','));
  const maxCols = Math.max(...parsed.map(r => r.length));

  if (maxCols < 15) return rows.join('\n'); // Too narrow to have side-by-side blocks.

  // Mark which column indices have ANY non-empty content.
  const hasContent = new Array<boolean>(maxCols).fill(false);
  for (const row of parsed) {
    for (let i = 0; i < row.length; i++) {
      if (row[i]?.trim()) hasContent[i] = true;
    }
  }

  // Walk across columns and group content-columns into blocks separated by
  // gaps of >= GAP_THRESHOLD consecutive empty columns.
  const GAP_THRESHOLD = 10;
  const blocks: { start: number; end: number }[] = [];
  let blockStart = -1;
  let gapLen = 0;

  for (let i = 0; i <= maxCols; i++) {
    if (i < maxCols && hasContent[i]) {
      if (blockStart === -1) blockStart = i;
      gapLen = 0;
    } else if (blockStart !== -1) {
      gapLen++;
      if (gapLen >= GAP_THRESHOLD || i === maxCols) {
        blocks.push({ start: blockStart, end: i - gapLen });
        blockStart = -1;
        gapLen = 0;
      }
    }
  }

  if (blocks.length <= 1) return rows.join('\n'); // Single block — nothing to split.

  // Extract each block and stack vertically with a separator.
  const sections: string[] = [];
  for (const blk of blocks) {
    const section = parsed
      .map(row => row.slice(blk.start, blk.end + 1).join(','))
      .filter(r => r.replace(/,/g, '').trim()); // Drop rows with no content in this block.
    if (section.length > 0) sections.push(section.join('\n'));
  }

  return sections.join('\n\n---\n\n');
}

type StreamParams = Parameters<Anthropic['messages']['stream']>[0];

const MAX_ANTHROPIC_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Transient Anthropic failures (overload, rate-limit, 5xx) that are safe to
// retry. Overload errors arrive as an SSE event with status `undefined`, so we
// also sniff the error payload's type rather than relying on the HTTP status.
function isTransientAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 408 || status === 409 || status === 429) return true;
    if (typeof status === 'number' && status >= 500) return true;
  }
  const e = err as { error?: { error?: { type?: string }; type?: string }; type?: string };
  const innerType = e?.error?.error?.type ?? e?.error?.type ?? e?.type;
  return innerType === 'overloaded_error' || innerType === 'api_error';
}

// Run a streaming message to completion and return its full text, retrying
// transient failures with exponential backoff.
async function extractTextWithRetry(anthropic: Anthropic, params: StreamParams): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await anthropic.messages.stream(params).finalText();
    } catch (err) {
      if (attempt >= MAX_ANTHROPIC_ATTEMPTS - 1 || !isTransientAnthropicError(err)) throw err;
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
}

// Stream message text deltas straight to the HTTP response, retrying transient
// failures ONLY while nothing has been written yet — a half-streamed response
// can't be safely restarted without duplicating output.
async function streamTextToResponse(anthropic: Anthropic, params: StreamParams, res: Response): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let wroteAny = false;
    try {
      const stream = anthropic.messages.stream(params);
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          wroteAny = true;
          res.write(event.delta.text);
        }
      }
      return;
    } catch (err) {
      if (wroteAny || attempt >= MAX_ANTHROPIC_ATTEMPTS - 1 || !isTransientAnthropicError(err)) throw err;
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
}

// ── POST /api/uploads/recipes-ai ─────────────────────────────────────────────
router.post('/uploads/recipes-ai', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.body['companyId'] as string;
    if (!companyId) return void res.status(400).json({ error: 'companyId required' });

    const file = req.file;
    if (!file) return void res.status(400).json({ error: 'No file uploaded' });

    const { data: member } = await supabase
      .from('CompanyMembers')
      .select('role')
      .eq('companyId', companyId)
      .eq('userId', ctx.user.id)
      .single();
    if (!member) return void res.status(403).json({ error: 'Forbidden' });

    const anthropic = new Anthropic();

    let isImage: boolean;
    let userContent: string | Anthropic.MessageParam['content'];
    let extractedText: string;
    try {
      ({ isImage, userContent, extractedText } = await parseUploadToContent(file));
    } catch (parseErr) {
      return void res.status(400).json({ error: parseErr instanceof Error ? parseErr.message : 'Could not parse file' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    const textRows = extractedText.split('\n');
    const CHUNK_ROWS = 350;
    const CHUNK_OVERLAP = 30;

    if (!isImage && textRows.length > CHUNK_ROWS) {
      // Large file: split into overlapping chunks so recipe blocks at boundaries
      // appear in both adjacent chunks, then deduplicate by recipe name.
      type RecipeIngredient = { name: string; quantity: number; unit: string; unitCost: number };
      type RecipeData = { name: string; ingredients: RecipeIngredient[] };

      const chunks: string[] = [];
      for (let i = 0; i < textRows.length; i += CHUNK_ROWS) {
        const start = i === 0 ? 0 : i - CHUNK_OVERLAP;
        const end = Math.min(textRows.length, i + CHUNK_ROWS);
        const chunk = textRows.slice(start, end).join('\n').trim();
        if (chunk) chunks.push(chunk);
      }

      // Map keyed by recipe name; on conflict keep the entry with more ingredients.
      // (Map writes are safe without locking — Node runs this single-threaded.)
      const recipeMap = new Map<string, RecipeData>();

      // Process chunks concurrently (capped) so wall-clock ≈ slowest batch
      // rather than the sum of every chunk's latency.
      const CHUNK_CONCURRENCY = 4;
      res.write(`Processing ${chunks.length} sections...\n`);
      let completed = 0;

      async function processChunk(chunkIdx: number) {
        try {
          const rawText = await extractTextWithRetry(anthropic, {
            model: 'claude-sonnet-4-6',
            max_tokens: 32000,
            system: RECIPE_EXTRACT_PROMPT,
            messages: [{ role: 'user', content: chunks[chunkIdx] }],
          });
          const cleaned = rawText.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
          const jStart = cleaned.indexOf('{');
          const jEnd = cleaned.lastIndexOf('}');
          let found = 0;
          if (jStart >= 0 && jEnd > jStart) {
            const parsed = JSON.parse(cleaned.slice(jStart, jEnd + 1)) as { recipes?: RecipeData[] };
            for (const r of parsed.recipes ?? []) {
              const key = r.name.toLowerCase().trim();
              const existing = recipeMap.get(key);
              if (!existing || r.ingredients.length > existing.ingredients.length) {
                recipeMap.set(key, r);
              }
            }
            found = (parsed.recipes ?? []).length;
          }
          res.write(`  Section ${chunkIdx + 1}: found ${found} recipes (${++completed}/${chunks.length}).\n`);
        } catch (chunkErr) {
          console.error(`Chunk ${chunkIdx + 1} error:`, chunkErr);
          res.write(`  Warning: could not fully process section ${chunkIdx + 1} (${++completed}/${chunks.length}).\n`);
        }
      }

      // Worker pool over a shared index queue.
      const queue = chunks.map((_, i) => i);
      await Promise.all(
        Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
          let idx: number | undefined;
          while ((idx = queue.shift()) !== undefined) {
            await processChunk(idx);
          }
        })
      );

      const allRecipes = Array.from(recipeMap.values());
      res.write(`\nDone — ${allRecipes.length} recipes extracted.\n\n`);
      res.write(JSON.stringify({ recipes: allRecipes }));
    } else {
      await streamTextToResponse(anthropic, {
        // Opus for images (vision-heavy); Sonnet for text/csv/pdf (faster).
        model: isImage ? 'claude-opus-4-8' : 'claude-sonnet-4-6',
        max_tokens: 32000,
        system: RECIPE_EXTRACT_PROMPT,
        messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
      }, res);
    }

    res.end();
  } catch (err) {
    console.error('Recipe AI upload error:', err);
    const message = isTransientAnthropicError(err)
      ? 'Claude is temporarily overloaded. Please try again in a moment.'
      : err instanceof Error ? err.message : 'Upload failed';
    if (!res.headersSent) res.status(500).json({ error: message });
    else res.end();
  }
});

// ── POST /api/uploads/inventory-ai ───────────────────────────────────────────
router.post('/uploads/inventory-ai', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.body['companyId'] as string;
    if (!companyId) return void res.status(400).json({ error: 'companyId required' });

    const file = req.file;
    if (!file) return void res.status(400).json({ error: 'No file uploaded' });

    const { data: member } = await supabase
      .from('CompanyMembers')
      .select('role')
      .eq('companyId', companyId)
      .eq('userId', ctx.user.id)
      .single();
    if (!member) return void res.status(403).json({ error: 'Forbidden' });

    const anthropic = new Anthropic();

    let isImage: boolean;
    let userContent: string | Anthropic.MessageParam['content'];
    let extractedText: string;
    try {
      ({ isImage, userContent, extractedText } = await parseUploadToContent(file));
    } catch (parseErr) {
      return void res.status(400).json({ error: parseErr instanceof Error ? parseErr.message : 'Could not parse file' });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    const textRows = extractedText.split('\n');
    const CHUNK_ROWS = 350;
    const CHUNK_OVERLAP = 30;

    if (!isImage && textRows.length > CHUNK_ROWS) {
      // Large file: split into overlapping chunks so items at boundaries appear
      // in both adjacent chunks, then deduplicate by item name.
      type ItemData = { name: string; category?: string; unitCost?: number; quantityOnHand?: number; reorderThreshold?: number; sku?: string };

      const chunks: string[] = [];
      for (let i = 0; i < textRows.length; i += CHUNK_ROWS) {
        const start = i === 0 ? 0 : i - CHUNK_OVERLAP;
        const end = Math.min(textRows.length, i + CHUNK_ROWS);
        const chunk = textRows.slice(start, end).join('\n').trim();
        if (chunk) chunks.push(chunk);
      }

      // Map keyed by item name; last write wins (later chunk overlap refines).
      // (Map writes are safe without locking — Node runs this single-threaded.)
      const itemMap = new Map<string, ItemData>();

      // Process chunks concurrently (capped) so wall-clock ≈ slowest batch.
      const CHUNK_CONCURRENCY = 4;
      res.write(`Processing ${chunks.length} sections...\n`);
      let completed = 0;

      async function processChunk(chunkIdx: number) {
        try {
          const rawText = await extractTextWithRetry(anthropic, {
            model: 'claude-sonnet-4-6',
            max_tokens: 32000,
            system: INVENTORY_EXTRACT_PROMPT,
            messages: [{ role: 'user', content: chunks[chunkIdx] }],
          });
          const cleaned = rawText.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
          const jStart = cleaned.indexOf('{');
          const jEnd = cleaned.lastIndexOf('}');
          let found = 0;
          if (jStart >= 0 && jEnd > jStart) {
            const parsed = JSON.parse(cleaned.slice(jStart, jEnd + 1)) as { items?: ItemData[] };
            for (const it of parsed.items ?? []) {
              itemMap.set(it.name.toLowerCase().trim(), it);
            }
            found = (parsed.items ?? []).length;
          }
          res.write(`  Section ${chunkIdx + 1}: found ${found} items (${++completed}/${chunks.length}).\n`);
        } catch (chunkErr) {
          console.error(`Chunk ${chunkIdx + 1} error:`, chunkErr);
          res.write(`  Warning: could not fully process section ${chunkIdx + 1} (${++completed}/${chunks.length}).\n`);
        }
      }

      // Worker pool over a shared index queue.
      const queue = chunks.map((_, i) => i);
      await Promise.all(
        Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
          let idx: number | undefined;
          while ((idx = queue.shift()) !== undefined) {
            await processChunk(idx);
          }
        })
      );

      const allItems = Array.from(itemMap.values());
      res.write(`\nDone — ${allItems.length} items extracted.\n\n`);
      res.write(JSON.stringify({ items: allItems }));
    } else {
      await streamTextToResponse(anthropic, {
        // Opus for images (vision-heavy); Sonnet for text/csv/pdf (faster).
        model: isImage ? 'claude-opus-4-8' : 'claude-sonnet-4-6',
        max_tokens: 32000,
        system: INVENTORY_EXTRACT_PROMPT,
        messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
      }, res);
    }

    res.end();
  } catch (err) {
    console.error('Inventory AI upload error:', err);
    const message = isTransientAnthropicError(err)
      ? 'Claude is temporarily overloaded. Please try again in a moment.'
      : err instanceof Error ? err.message : 'Upload failed';
    if (!res.headersSent) res.status(500).json({ error: message });
    else res.end();
  }
});

// ── POST /api/uploads/permit ──────────────────────────────────────────────────
router.post('/uploads/permit', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const eventId = req.body['eventId'] as string;
    if (!eventId) return void res.status(400).json({ error: 'eventId required' });

    const files = req.files as Express.Multer.File[];
    if (!files?.length) return void res.status(400).json({ error: 'No files uploaded' });

    const results: Array<{ fileName: string; fileUrl: string | null }> = [];

    for (const file of files) {
      const path = `permits/${eventId}/${Date.now()}_${file.originalname}`;
      const { error: uploadError } = await supabase.storage
        .from('venview-permits')
        .upload(path, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        console.warn('Storage upload failed:', uploadError.message);
        continue;
      }

      await supabase.from('Permits').insert({
        eventID: eventId,
        fileName: file.originalname,
        filePath: path,
        uploadedAt: new Date().toISOString(),
      });

      // Private bucket — hand back a short-lived signed URL for the uploader.
      const { data: signed } = await supabase.storage
        .from('venview-permits')
        .createSignedUrl(path, 60 * 60);

      results.push({ fileName: file.originalname, fileUrl: signed?.signedUrl ?? null });
    }

    res.json({ success: true, files: results });
  } catch (err) {
    console.error('Permit upload error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

export default router;
