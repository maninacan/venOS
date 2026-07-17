// Pure derivation of an event's lifecycle phase and the single recommended
// next action. Works off fields available on BOTH the events-list query and
// the full eventReport, so the Home page and the Event Dashboard share one
// source of truth.

export type EventPhase = 'plan' | 'reconcile' | 'finalize' | 'done';

export type NextAction =
  | 'pull-sales'      // link/pull POS sales
  | 'enter-sales'     // manual sales entry
  | 'add-costs'       // labor & expenses
  | 'review-finalize' // open profit summary / finalize
  | 'view-report';    // post-event report

export interface EventStage {
  phase: EventPhase;
  /** 0-based index of the active phase among Plan / Reconcile / Finalize. */
  stepIndex: number;
  nextStep: { label: string; action: NextAction };
}

export interface EventStageInput {
  isFinalized?: boolean | null;
  posLocationId?: string | null;
  sales?: { grossSales?: number | null; netSales?: number | null } | null;
  /** Whether the company has connected a POS (optional context). */
  posConnected?: boolean;
}

export function hasSales(sales: EventStageInput['sales']): boolean {
  if (!sales) return false;
  return Number(sales.grossSales ?? 0) > 0 || Number(sales.netSales ?? 0) > 0;
}

export const PHASE_LABELS: Record<Exclude<EventPhase, 'done'>, string> = {
  plan: 'Plan',
  reconcile: 'Reconcile',
  finalize: 'Finalize',
};

// Is the event upcoming (hasn't happened yet) or past? "past" only once today is
// strictly after the event's last day (endDate, or eventDate + numDays-1).
export function deriveEventTiming(
  ev: { eventDate?: string | null; endDate?: string | null; numDays?: number | null },
  today: Date = new Date(),
): 'upcoming' | 'past' {
  const start = ev.eventDate;
  if (!start) return 'upcoming';
  let lastISO = ev.endDate || start;
  if (!ev.endDate && ev.numDays && ev.numDays > 1) {
    const [y, m, d] = start.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + (ev.numDays - 1));
    lastISO = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return todayISO > lastISO ? 'past' : 'upcoming';
}

export function deriveEventStage(ev: EventStageInput): EventStage {
  // Finalized → nothing left but the report.
  if (ev.isFinalized) {
    return { phase: 'done', stepIndex: 2, nextStep: { label: 'View / download report', action: 'view-report' } };
  }

  // Sales captured → ready to review & finalize.
  if (hasSales(ev.sales)) {
    return { phase: 'finalize', stepIndex: 2, nextStep: { label: 'Review & finalize', action: 'review-finalize' } };
  }

  // No sales yet → reconcile. Prefer POS pull if available, else manual entry.
  const canPull = !!ev.posLocationId && ev.posConnected !== false;
  return {
    phase: 'reconcile',
    stepIndex: 1,
    nextStep: canPull
      ? { label: 'Pull POS sales', action: 'pull-sales' }
      : { label: 'Enter sales', action: 'enter-sales' },
  };
}
