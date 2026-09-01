import zipcodes from 'zipcodes';
import tzLookup from 'tz-lookup';

/**
 * IANA time zone for a US ZIP code, or null when it can't be resolved.
 *
 * ZIP -> lat/lon (zipcodes) -> IANA zone (tz-lookup, polygon based). A state-level
 * map would be wrong wherever a state spans zones — Florida, Tennessee, Idaho,
 * Oregon and a dozen others — and an hour's error on an event's start time is the
 * kind of thing nobody notices until they miss a load-in.
 */
export function zipToTimeZone(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const five = String(zip).trim().slice(0, 5);
  if (!/^\d{5}$/.test(five)) return null;
  const place = zipcodes.lookup(five);
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') return null;
  try {
    return tzLookup(place.latitude, place.longitude) || null;
  } catch {
    return null;
  }
}

/** Cheap sanity check that a string is a usable IANA zone on this runtime. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone to use for an event: its stored zone when valid, otherwise derived
 * from its ZIP, otherwise null (callers should fall back to all-day entries
 * rather than guessing an hour).
 */
export function resolveEventTimeZone(
  ev: { timeZone?: string | null; zipCode?: string | null } | null | undefined,
): string | null {
  if (!ev) return null;
  if (isValidTimeZone(ev.timeZone)) return ev.timeZone as string;
  return zipToTimeZone(ev.zipCode);
}
