import { DateTime } from 'luxon';
import { resolveEventTimeZone } from './timeZone.js';

/**
 * iCalendar (RFC 5545) generation for events.
 *
 * Design decisions worth knowing:
 *
 *  - One VEVENT per event day, not one block spanning the whole event. A three
 *    day festival is three 10-6 shifts, not a single 72 hour commitment, and
 *    that is how it should sit on a vendor's calendar.
 *
 *  - Timed entries are emitted in UTC rather than with a VTIMEZONE component.
 *    The local time is converted using the event's IANA zone, which luxon
 *    resolves correctly across DST. This avoids hand-writing VTIMEZONE blocks,
 *    which are verbose and a common source of off-by-an-hour bugs.
 *
 *  - A timed entry requires a zone AND both a start and an end. Anything else
 *    falls back to an all-day entry. We never invent a duration or assume a
 *    zone: an event on the wrong day is obvious, an event at the wrong hour is
 *    not, and someone misses a load-in.
 *
 *  - UIDs are stable and derived from the event id, so re-adding updates the
 *    existing entry instead of duplicating it, and a later CANCEL can target it.
 */

export interface CalendarEventInput {
  eventID: string;
  eventName: string;
  eventDate?: string | null;      // ISO date
  endDate?: string | null;        // ISO date
  numDays?: number | null;
  eventLocation?: string | null;
  zipCode?: string | null;
  country?: string | null;
  timeZone?: string | null;
  eventHost?: string | null;
  coordinator?: string | null;
  notes?: string | null;
  isFinalized?: boolean | null;
}

export interface CalendarDayInput {
  dayNumber: number;
  eventDate?: string | null;      // ISO date
  startTime?: string | null;      // HH:MM[:SS]
  endTime?: string | null;        // HH:MM[:SS]
}

export type CalendarMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';

export interface CalendarOptions {
  method?: CalendarMethod;
  /** Bumped when the event changes, so calendars replace rather than duplicate. */
  sequence?: number;
  /** Deep link back into the app. */
  eventUrl?: string;
  organizer?: { name: string; email: string };
  attendees?: Array<{ name?: string | null; email: string }>;
  /** Injectable for deterministic tests. */
  now?: Date;
}

const PRODID = '-//venOS//Event Calendar//EN';
const UID_DOMAIN = 'venview.io';

/** RFC 5545 text escaping: backslash, semicolon, comma and newline. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets per line with a leading space on continuations. Folding is
 * by BYTE length, not character count — a multi-byte character split across a
 * fold boundary corrupts the file.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not split inside a multi-byte sequence: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

function utcStamp(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
}

function dateOnly(iso: string): string {
  return iso.replace(/-/g, '');
}

function addDaysISO(iso: string, days: number): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).plus({ days }).toFormat('yyyy-LL-dd');
}

/** HH:MM or HH:MM:SS -> {hour, minute, second}, or null. */
export function parseTime(value: string | null | undefined): { hour: number; minute: number; second: number } | null {
  if (!value) return null;
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(value));
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]), second = Number(m[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** The days to emit: explicit EventDays when present, else derived from the event. */
export function resolveDays(event: CalendarEventInput, days: CalendarDayInput[]): CalendarDayInput[] {
  const withDates = (days ?? []).filter(d => !!d.eventDate);
  if (withDates.length > 0) {
    return [...withDates].sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));
  }
  if (!event.eventDate) return [];
  const count = Math.max(1, Number(event.numDays ?? 1));
  return Array.from({ length: count }, (_, i) => ({
    dayNumber: i + 1,
    eventDate: addDaysISO(event.eventDate as string, i),
    startTime: null,
    endTime: null,
  }));
}

function buildDescription(event: CalendarEventInput, eventUrl?: string): string {
  const lines: string[] = [];
  if (event.eventHost) lines.push(`Host: ${event.eventHost}`);
  if (event.coordinator) lines.push(`Coordinator: ${event.coordinator}`);
  if (event.notes) lines.push(`Notes: ${event.notes}`);
  if (eventUrl) lines.push(`View in venOS: ${eventUrl}`);
  return lines.join('\n');
}

function buildLocation(event: CalendarEventInput): string {
  return [event.eventLocation, event.zipCode].filter(Boolean).join(', ');
}

export function buildEventCalendar(
  event: CalendarEventInput,
  days: CalendarDayInput[],
  opts: CalendarOptions = {},
): string {
  const {
    method = 'PUBLISH',
    sequence = 0,
    eventUrl,
    organizer,
    attendees = [],
    now = new Date(),
  } = opts;

  const zone = resolveEventTimeZone(event);
  const stamp = utcStamp(now);
  const location = buildLocation(event);
  const description = buildDescription(event, eventUrl);

  const out: string[] = [
    'BEGIN:VCALENDAR',
    `PRODID:${PRODID}`,
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
  ];

  for (const day of resolveDays(event, days)) {
    const date = day.eventDate as string;
    const start = parseTime(day.startTime);
    const end = parseTime(day.endTime);

    out.push('BEGIN:VEVENT');
    out.push(`UID:${event.eventID}-d${day.dayNumber}@${UID_DOMAIN}`);
    out.push(`DTSTAMP:${stamp}`);
    out.push(`SEQUENCE:${sequence}`);

    if (zone && start && end) {
      const s = DateTime.fromObject({ ...dateParts(date), ...start }, { zone });
      let e = DateTime.fromObject({ ...dateParts(date), ...end }, { zone });
      // An end at or before the start means the shift runs past midnight.
      if (e <= s) e = e.plus({ days: 1 });
      out.push(`DTSTART:${s.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`);
      out.push(`DTEND:${e.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`);
    } else {
      // All-day. DTEND is exclusive, so it is the following day.
      out.push(`DTSTART;VALUE=DATE:${dateOnly(date)}`);
      out.push(`DTEND;VALUE=DATE:${dateOnly(addDaysISO(date, 1))}`);
    }

    out.push(`SUMMARY:${escapeText(event.eventName)}`);
    if (location) out.push(`LOCATION:${escapeText(location)}`);
    if (description) out.push(`DESCRIPTION:${escapeText(description)}`);
    if (eventUrl) out.push(`URL:${eventUrl}`);
    out.push(`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`);
    out.push('TRANSP:OPAQUE');

    if (organizer) {
      out.push(`ORGANIZER;CN=${escapeText(organizer.name)}:mailto:${organizer.email}`);
    }
    for (const a of attendees) {
      const cn = a.name ? `;CN=${escapeText(a.name)}` : '';
      out.push(
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${a.email}`,
      );
    }

    out.push('END:VEVENT');
  }

  out.push('END:VCALENDAR');
  return out.map(foldLine).join('\r\n') + '\r\n';
}

function dateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

/** A filesystem-safe name for the downloaded file. */
export function calendarFileName(eventName: string): string {
  const safe = (eventName || 'event').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${safe || 'event'}.ics`;
}

/**
 * Deep links for the web calendars that accept a pre-filled compose URL.
 *
 * These are generated here, not in the browser, so the timezone conversion has a
 * single implementation. Note the deliberate difference from the .ics: a deep
 * link can only express ONE entry, so a multi-day event becomes a single block
 * spanning first day to last. The .ics remains the higher-fidelity option with
 * one entry per day, which is why it stays the primary action.
 */
export function buildProviderLinks(
  event: CalendarEventInput,
  days: CalendarDayInput[],
  opts: { eventUrl?: string } = {},
): { google: string; outlook: string } | null {
  const list = resolveDays(event, days);
  if (list.length === 0) return null;

  const zone = resolveEventTimeZone(event);
  const firstDay = list[0];
  const lastDay = list[list.length - 1];
  const start = parseTime(firstDay.startTime);
  const end = parseTime(lastDay.endTime);

  const title = event.eventName ?? 'Event';
  const location = buildLocation(event);
  const details = buildDescription(event, opts.eventUrl);

  let googleDates: string;
  let outlookStart: string;
  let outlookEnd: string;
  let allDay = false;

  if (zone && start && end) {
    const s = DateTime.fromObject({ ...dateParts(firstDay.eventDate as string), ...start }, { zone });
    let e = DateTime.fromObject({ ...dateParts(lastDay.eventDate as string), ...end }, { zone });
    if (e <= s) e = e.plus({ days: 1 });
    const fmt = (d: DateTime) => d.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
    googleDates = `${fmt(s)}/${fmt(e)}`;
    outlookStart = s.toUTC().toISO() ?? '';
    outlookEnd = e.toUTC().toISO() ?? '';
  } else {
    allDay = true;
    const endExclusive = addDaysISO(lastDay.eventDate as string, 1);
    googleDates = `${dateOnly(firstDay.eventDate as string)}/${dateOnly(endExclusive)}`;
    outlookStart = firstDay.eventDate as string;
    outlookEnd = endExclusive;
  }

  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: googleDates,
    ...(details ? { details } : {}),
    ...(location ? { location } : {}),
  }).toString();

  const outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?' + new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: outlookStart,
    enddt: outlookEnd,
    ...(allDay ? { allday: 'true' } : {}),
    ...(details ? { body: details } : {}),
    ...(location ? { location } : {}),
  }).toString();

  return { google, outlook };
}
