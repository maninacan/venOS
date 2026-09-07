import { describe, it, expect } from 'vitest';
import { safeError } from './safeError.js';

/** The shape axios produces — the reason this helper exists. */
function axiosLikeError() {
  const e = new Error('Request failed with status code 401') as Error & Record<string, unknown>;
  e.name = 'AxiosError';
  e['code'] = 'ERR_BAD_REQUEST';
  e['status'] = 401;
  e['config'] = {
    url: 'https://connect.squareup.com/oauth2/token',
    data: JSON.stringify({ client_id: 'sq0idp-abc', client_secret: 'sq0csp-SUPERSECRET', code: 'sq0cgp-xyz' }),
    headers: { Authorization: 'Bearer EAAA-a-real-access-token' },
  };
  e['request'] = { _header: 'POST /oauth2/token\r\nAuthorization: Bearer EAAA-a-real-access-token' };
  e['response'] = { status: 401, data: { message: 'Not Authorized', type: 'service.not_authorized' } };
  return e;
}

describe('safeError', () => {
  it('keeps what is useful for debugging', () => {
    const s = safeError(axiosLikeError());
    expect(s.message).toBe('Request failed with status code 401');
    expect(s.status).toBe(401);
    expect(s.code).toBe('ERR_BAD_REQUEST');
    expect(s.name).toBe('AxiosError');
    expect(s.detail).toBe('Not Authorized');
  });

  // The whole point: nothing from the request may survive.
  it('drops the request, so credentials cannot leak', () => {
    const serialized = JSON.stringify(safeError(axiosLikeError()));
    for (const secret of ['sq0csp-SUPERSECRET', 'EAAA-a-real-access-token', 'sq0cgp-xyz', 'client_secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain('config');
    expect(serialized).not.toContain('headers');
  });

  it('reads Square-style errors arrays', () => {
    const e = Object.assign(new Error('boom'), {
      response: { status: 400, data: { errors: [{ detail: 'Invalid redirect_uri', code: 'INVALID_REQUEST' }] } },
    });
    expect(safeError(e).detail).toBe('Invalid redirect_uri');
  });

  it('reads OAuth-style error_description', () => {
    const e = Object.assign(new Error('boom'), { response: { data: { error_description: 'bad client' } } });
    expect(safeError(e).detail).toBe('bad client');
  });

  it('truncates long messages and details', () => {
    const e = Object.assign(new Error('x'.repeat(1000)), { response: { data: { message: 'y'.repeat(1000) } } });
    const s = safeError(e);
    expect(s.message.length).toBe(300);
    expect(s.detail?.length).toBe(300);
  });

  it('handles plain errors, strings, null and odd values', () => {
    expect(safeError(new Error('plain')).message).toBe('plain');
    expect(safeError('just a string').message).toBe('just a string');
    expect(safeError(null).message).toBe('Unknown error');
    expect(safeError(undefined).message).toBe('Unknown error');
    expect(safeError(42).message).toBe('42');
  });

  it('never returns undefined keys that would serialize as noise', () => {
    expect(Object.keys(safeError(new Error('x')))).toEqual(['message', 'name']);
  });
});
