import { describe, it, expect } from 'vitest';
import { zipToTimeZone, isValidTimeZone, resolveEventTimeZone } from './timeZone.js';

describe('zipToTimeZone', () => {
  it('resolves a straightforward ZIP', () => {
    expect(zipToTimeZone('84043')).toBe('America/Denver');
  });

  // The whole reason for polygon lookup rather than a state map.
  it.each([
    ['32505', 'America/Chicago',     'Pensacola FL — central'],
    ['33101', 'America/New_York',    'Miami FL — eastern'],
    ['37401', 'America/New_York',    'Chattanooga TN — eastern'],
    ['38103', 'America/Chicago',     'Memphis TN — central'],
    ['83814', 'America/Los_Angeles', "Coeur d'Alene ID — pacific"],
    ['83702', 'America/Boise',       'Boise ID — mountain'],
  ])('splits %s correctly (%s)', (zip, expected) => {
    expect(zipToTimeZone(zip)).toBe(expected);
  });

  it('accepts ZIP+4 by taking the first five digits', () => {
    expect(zipToTimeZone('84043-1234')).toBe('America/Denver');
  });

  it.each([[null], [undefined], [''], ['abcde'], ['1234'], ['00000']])(
    'returns null for unusable input %s',
    (zip) => { expect(zipToTimeZone(zip as string | null)).toBeNull(); },
  );
});

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });
  it('rejects junk and empties', () => {
    for (const v of [null, undefined, '', 'Mars/Olympus', 'MST7MDT-nope']) {
      expect(isValidTimeZone(v as string | null)).toBe(false);
    }
  });
});

describe('resolveEventTimeZone', () => {
  it('prefers a valid stored zone', () => {
    expect(resolveEventTimeZone({ timeZone: 'America/New_York', zipCode: '84043' })).toBe('America/New_York');
  });
  it('falls back to the ZIP when the stored zone is missing or junk', () => {
    expect(resolveEventTimeZone({ timeZone: null, zipCode: '84043' })).toBe('America/Denver');
    expect(resolveEventTimeZone({ timeZone: 'Mars/Olympus', zipCode: '84043' })).toBe('America/Denver');
  });
  it('returns null when nothing resolves, so callers can choose all-day', () => {
    expect(resolveEventTimeZone({ timeZone: null, zipCode: null })).toBeNull();
    expect(resolveEventTimeZone(null)).toBeNull();
  });
});
