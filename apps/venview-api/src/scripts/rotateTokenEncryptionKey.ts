// One-time migration: re-encrypt stored POS tokens under a new TOKEN_ENCRYPTION_KEY.
//
// PosConnection.accessToken / .refreshToken are AES-256-GCM ciphertexts produced by
// lib/crypto.ts. That module holds a single key with no key-id, so swapping
// TOKEN_ENCRYPTION_KEY without re-encrypting makes every stored token undecryptable
// and breaks every customer's Square/Toast connection at once. This script bridges
// the two keys: decrypt with the old, re-encrypt with the new.
//
// Both keys must be present in the environment for the duration of the run:
//
//   OLD_TOKEN_ENCRYPTION_KEY  the value currently in Doppler
//   NEW_TOKEN_ENCRYPTION_KEY  the replacement (openssl rand -hex 32)
//
// Run per environment, dry-run first:
//
//   doppler run --project venos --config dev -- node <bundle> --dry-run
//   doppler run --project venos --config dev -- node <bundle>
//   doppler run --project venos --config prd -- node <bundle> --dry-run
//   doppler run --project venos --config prd -- node <bundle>
//
// Only after a run reports 0 failures do you set TOKEN_ENCRYPTION_KEY = the new
// value in that config and redeploy the API.
//
// Idempotent: a row already re-encrypted under the new key is detected and skipped,
// so a re-run (or a run interrupted partway) is safe. --dry-run writes nothing.
// Token plaintext is never logged.
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SECRET_KEY'];
if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY');

function loadKey(name: string): Buffer {
  const hex = process.env[name];
  if (!hex || hex.length !== 64) throw new Error(`${name} must be a 64-char hex string (32 bytes)`);
  return Buffer.from(hex, 'hex');
}
const OLD_KEY = loadKey('OLD_TOKEN_ENCRYPTION_KEY');
const NEW_KEY = loadKey('NEW_TOKEN_ENCRYPTION_KEY');
if (OLD_KEY.equals(NEW_KEY)) throw new Error('OLD and NEW keys are identical — nothing to rotate');

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Mirrors lib/crypto.ts exactly, but with the key passed in rather than read from env.
function decryptWith(k: Buffer, ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

function encryptWith(k: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

type FieldResult = { value: string | null; state: 'rotated' | 'already' | 'empty' | 'failed' };

// GCM auth tags make this unambiguous: a wrong key fails to authenticate rather
// than yielding garbage, so "decrypts under NEW" reliably means already-migrated.
function rotateField(ciphertext: string | null): FieldResult {
  if (!ciphertext) return { value: null, state: 'empty' };
  try {
    return { value: encryptWith(NEW_KEY, decryptWith(OLD_KEY, ciphertext)), state: 'rotated' };
  } catch {
    try {
      decryptWith(NEW_KEY, ciphertext);
      return { value: ciphertext, state: 'already' };
    } catch {
      return { value: ciphertext, state: 'failed' };
    }
  }
}

async function main() {
  const { data, error } = await supabase
    .from('PosConnection')
    .select('companyId, provider, accessToken, refreshToken');
  if (error) throw new Error(`Failed to read PosConnection: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}PosConnection rows: ${rows.length}\n`);

  const counts = { updated: 0, already: 0, failed: 0, unchanged: 0 };
  const failures: string[] = [];

  for (const row of rows) {
    const companyId = row['companyId'] as string;
    const provider = row['provider'] as string;
    const label = `${companyId} (${provider})`;

    const access = rotateField(row['accessToken'] as string | null);
    const refresh = rotateField(row['refreshToken'] as string | null);

    if (access.state === 'failed' || refresh.state === 'failed') {
      counts.failed++;
      const which = [
        access.state === 'failed' ? 'accessToken' : null,
        refresh.state === 'failed' ? 'refreshToken' : null,
      ].filter(Boolean).join(', ');
      failures.push(`${label}: ${which} decrypts under neither key`);
      console.error(`  FAILED ${label}: ${which} decrypts under neither key`);
      continue;
    }

    if (access.state !== 'rotated' && refresh.state !== 'rotated') {
      if (access.state === 'already' || refresh.state === 'already') counts.already++;
      else counts.unchanged++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would rotate ${label}  access=${access.state}  refresh=${refresh.state}`);
    } else {
      const { error: upErr } = await supabase.from('PosConnection').update({
        accessToken: access.value,
        refreshToken: refresh.value,
      }).eq('companyId', companyId).eq('provider', provider);
      if (upErr) {
        counts.failed++;
        failures.push(`${label}: write failed — ${upErr.message}`);
        console.error(`  FAILED ${label}: ${upErr.message}`);
        continue;
      }
    }
    counts.updated++;
  }

  console.log(`\n${DRY_RUN ? 'Would rotate' : 'Rotated'}: ${counts.updated}`);
  console.log(`Skipped — already on new key: ${counts.already}, no tokens stored: ${counts.unchanged}`);
  console.log(`Failed: ${counts.failed}`);
  if (failures.length) {
    console.log('\nRows needing attention (owner must reconnect their POS in Settings):');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('');

  if (counts.failed > 0) {
    console.error('Completed with failures — do NOT swap TOKEN_ENCRYPTION_KEY until these are resolved.\n');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
