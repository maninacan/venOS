/**
 * Reduce an unknown error to fields that are safe to log.
 *
 * Axios attaches the whole request to its errors — `config.data` and
 * `config.headers` included. Logging one verbatim publishes whatever was being
 * sent: the Square OAuth exchange put `client_secret` and the authorization code
 * into plaintext logs, and every authenticated POS call carries a bearer token in
 * its headers. Anthropic and Supabase errors are similarly generous.
 *
 * This keeps what is actually useful when debugging — status, code, message, and
 * a short extract of the provider's own error text — and drops everything else.
 * Nothing here walks the request: the request is the dangerous part.
 */

export interface SafeError {
  message: string;
  name?: string;
  /** HTTP status, when the error came from an HTTP client. */
  status?: number;
  /** Library or provider error code, e.g. 'ERR_BAD_REQUEST'. */
  code?: string;
  /** Short extract of the provider's error body, truncated. */
  detail?: string;
}

const DETAIL_MAX = 300;

/** Pull a human-readable message out of a provider's error body, if there is one. */
function extractDetail(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body.slice(0, DETAIL_MAX) || undefined;
  if (typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  // Square uses `errors: [{ detail, code }]`; most others use message/error.
  const first = Array.isArray(o['errors']) ? (o['errors'] as unknown[])[0] : undefined;
  const candidate =
    o['message'] ?? o['error_description'] ?? o['error'] ??
    (first && typeof first === 'object'
      ? (first as Record<string, unknown>)['detail'] ?? (first as Record<string, unknown>)['code']
      : undefined);
  if (typeof candidate === 'string') return candidate.slice(0, DETAIL_MAX) || undefined;
  return undefined;
}

export function safeError(err: unknown): SafeError {
  if (err == null) return { message: 'Unknown error' };
  if (typeof err === 'string') return { message: err.slice(0, DETAIL_MAX) };

  const e = err as {
    message?: unknown; name?: unknown; code?: unknown; status?: unknown;
    response?: { status?: unknown; data?: unknown };
  };

  const out: SafeError = {
    message: typeof e.message === 'string' ? e.message.slice(0, DETAIL_MAX) : String(err).slice(0, DETAIL_MAX),
  };
  if (typeof e.name === 'string') out.name = e.name;
  if (typeof e.code === 'string') out.code = e.code;

  const status = typeof e.status === 'number' ? e.status
    : typeof e.response?.status === 'number' ? e.response.status
    : undefined;
  if (status !== undefined) out.status = status;

  const detail = extractDetail(e.response?.data);
  if (detail) out.detail = detail;

  return out;
}
