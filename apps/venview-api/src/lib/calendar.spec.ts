import { describe, it, expect } from 'vitest';
import {
  buildEventCalendar, escapeText, foldLine, parseTime, resolveDays, calendarFileName,
  type CalendarEventInput, type CalendarDayInput,
} from './calendar.js';

const NOW = new Date('2026-09-01T12:00:00Z');
const base: CalendarEventInput = {
  eventID: 'e1', eventName: 'Farmers Market', eventDate: '2026-09-12',
  eventLocation: 'Patriot Park', zipCode: '84043', timeZone: 'America/Denver', numDays: 1,
};
const build = (ev: Partial<CalendarEventInput>, days: CalendarDayInput[] = [], opts = {}) =>
  buildEventCalendar({ ...base, ...ev }, days, { now: NOW, ...opts });
/** Reverse RFC 5545 line folding, so content assertions ignore wrapping. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('escapeText', () => {
  it('escapes the RFC 5545 specials', () => {
    expect(escapeText('a,b;c\\d')).toBe('a\\,b\;c\\\\d');
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines to 75 octets with a leading space', () => {
    const out = foldLine('DESCRIPTION:' + 'x'.repeat(200));
    const lines = out.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(Buffer.from(lines[0], 'utf8').length).toBeLessThanOrEqual(75);
    for (const l of lines.slice(1)) expect(l.startsWith(' ')).toBe(true);
  });

  // Splitting mid-sequence would corrupt the character.
  it('never splits a multi-byte character', () => {
    const out = foldLine('SUMMARY:' + 'é'.repeat(80));
    expect(out.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'é'.repeat(80));
  });
});

describe('parseTime', () => {
  it.each([['09:30', 9, 30, 0], ['9:05', 9, 5, 0], ['18:00:45', 18, 0, 45]])(
    'parses %s', (v, h, m, s) => expect(parseTime(v as string)).toEqual({ hour: h, minute: m, second: s }),
  );
  it.each([[null], [''], ['10am'], ['Noon-6'], ['25:00'], ['10:70']])(
    'rejects %s', v => expect(parseTime(v as string | null)).toBeNull(),
  );
});

describe('resolveDays', () => {
  it('uses explicit days, sorted', () => {
    const days = resolveDays(base, [
      { dayNumber: 2, eventDate: '2026-09-13' },
      { dayNumber: 1, eventDate: '2026-09-12' },
    ]);
    expect(days.map(d => d.eventDate)).toEqual(['2026-09-12', '2026-09-13']);
  });

  it('derives days from numDays when none are stored', () => {
    const days = resolveDays({ ...base, numDays: 3 }, []);
    expect(days.map(d => d.eventDate)).toEqual(['2026-09-12', '2026-09-13', '2026-09-14']);
  });

  it('returns nothing when there is no date at all', () => {
    expect(resolveDays({ ...base, eventDate: null, numDays: 2 }, [])).toEqual([]);
  });
});

describe('buildEventCalendar', () => {
  it('emits a well-formed calendar', () => {
    const ics = build({});
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics.split('\r\n').every(l => !l.endsWith(' ') || l === '')).toBe(true);
  });

  it('emits one VEVENT per day, with stable UIDs', () => {
    const ics = build({ numDays: 3 }, []);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('UID:e1-d1@venview.io');
    expect(ics).toContain('UID:e1-d3@venview.io');
  });

  it('converts local times to UTC using the event zone', () => {
    // 10:00 MDT (UTC-6 in September) is 16:00 UTC.
    const ics = build({}, [{ dayNumber: 1, eventDate: '2026-09-12', startTime: '10:00', endTime: '18:00' }]);
    expect(ics).toContain('DTSTART:20260912T160000Z');
    expect(ics).toContain('DTEND:20260913T000000Z');
  });

  it('respects DST — the same wall time shifts an hour in winter', () => {
    // 10:00 MST (UTC-7 in January) is 17:00 UTC.
    const ics = build({ eventDate: '2026-01-10' }, [
      { dayNumber: 1, eventDate: '2026-01-10', startTime: '10:00', endTime: '12:00' },
    ]);
    expect(ics).toContain('DTSTART:20260110T170000Z');
  });

  it('treats an end at or before the start as crossing midnight', () => {
    const ics = build({}, [{ dayNumber: 1, eventDate: '2026-09-12', startTime: '18:00', endTime: '02:00' }]);
    expect(ics).toContain('DTSTART:20260913T000000Z');   // 18:00 MDT
    expect(ics).toContain('DTEND:20260913T080000Z');     // 02:00 next day MDT
  });

  // Never guess an hour: without a zone, or without both ends, fall back to all-day.
  it('falls back to all-day when the zone cannot be resolved', () => {
    const ics = build({ timeZone: null, zipCode: null }, [
      { dayNumber: 1, eventDate: '2026-09-12', startTime: '10:00', endTime: '18:00' },
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260912');
    expect(ics).toContain('DTEND;VALUE=DATE:20260913');
    expect(ics).not.toContain('DTSTART:2026');
  });

  it('falls back to all-day when only one end of the shift is known', () => {
    const ics = build({}, [{ dayNumber: 1, eventDate: '2026-09-12', startTime: '10:00', endTime: null }]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260912');
  });

  it('derives the zone from the ZIP when none is stored', () => {
    const ics = build({ timeZone: null }, [
      { dayNumber: 1, eventDate: '2026-09-12', startTime: '10:00', endTime: '18:00' },
    ]);
    expect(ics).toContain('DTSTART:20260912T160000Z');
  });

  it('includes location, description and url', () => {
    const ics = build({ eventHost: 'City of Lehi', notes: 'Load in at 8' }, [], {
      eventUrl: 'https://app.venview.io/e/1',
    });
    expect(unfold(ics)).toContain('LOCATION:Patriot Park\\, 84043');
    expect(unfold(ics)).toContain('Host: City of Lehi');
    expect(unfold(ics)).toContain('URL:https://app.venview.io/e/1');
  });

  it('supports invitations with an organizer and attendees', () => {
    const ics = build({}, [], {
      method: 'REQUEST',
      organizer: { name: 'venOS', email: 'no-reply@mail.venview.io' },
      attendees: [{ name: 'Ana', email: 'ana@example.com' }, { email: 'ben@example.com' }],
    });
    expect(ics).toContain('METHOD:REQUEST');
    expect(unfold(ics)).toContain('ORGANIZER;CN=venOS:mailto:no-reply@mail.venview.io');
    expect(unfold(ics)).toContain('RSVP=TRUE;CN=Ana:mailto:ana@example.com');
    expect(unfold(ics)).toContain('RSVP=TRUE:mailto:ben@example.com');
  });

  it('marks cancellations', () => {
    const ics = build({}, [], { method: 'CANCEL', sequence: 2 });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('escapes a name containing separators', () => {
    const ics = build({ eventName: 'Market; Fall, 2026' });
    expect(ics).toContain('SUMMARY:Market\; Fall\\, 2026');
  });

  it('produces no events when the event has no date', () => {
    const ics = build({ eventDate: null, numDays: null });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('calendarFileName', () => {
  it('sanitizes the event name', () => {
    expect(calendarFileName('Farmers Market / Sat!')).toBe('Farmers_Market_Sat.ics');
    expect(calendarFileName('')).toBe('event.ics');
  });
});
