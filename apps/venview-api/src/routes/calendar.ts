import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { createContext } from '../context/index.js';
import { buildEventCalendar, calendarFileName, type CalendarDayInput } from '../lib/calendar.js';
import logger from '../lib/logger.js';

const router: IRouter = Router();

/**
 * GET /api/events/:eventId/calendar.ics
 *
 * Returns the event as an iCalendar file, one VEVENT per event day. Requires an
 * authenticated member of the owning company — the same rule the GraphQL
 * resolvers enforce, applied here because this route bypasses them.
 *
 * The client fetches this with its bearer token and triggers a download from the
 * response body; a plain anchor href could not carry the Authorization header.
 */
router.get('/events/:eventId/calendar.ics', async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const eventId = req.params['eventId'] as string;

    const { data: event } = await supabase
      .from('EventInfo')
      .select('eventID, companyId, eventName, eventDate, endDate, numDays, eventLocation, zipCode, country, timeZone, eventHost, coordinator, notes, isFinalized')
      .eq('eventID', eventId)
      .maybeSingle();
    if (!event) return void res.status(404).json({ error: 'Event not found' });

    const row = event as Record<string, unknown>;

    const { data: member } = await supabase
      .from('CompanyMembers').select('role')
      .eq('companyId', row['companyId'])
      .eq('userId', ctx.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) return void res.status(403).json({ error: 'Forbidden' });

    const { data: dayRows } = await supabase
      .from('EventDays')
      .select('dayNumber, eventDate, startTime, endTime')
      .eq('eventID', eventId)
      .order('dayNumber', { ascending: true });

    const clientUrl = process.env['CLIENT_URL'] ?? 'http://localhost:4200';
    const ics = buildEventCalendar(
      row as unknown as Parameters<typeof buildEventCalendar>[0],
      (dayRows ?? []) as CalendarDayInput[],
      { eventUrl: `${clientUrl}/companies/${row['companyId']}/events/${eventId}` },
    );

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${calendarFileName(String(row['eventName'] ?? ''))}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(ics);
  } catch (err) {
    logger.error('calendar.ics: failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to build calendar file' });
  }
});

export default router;
