import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { formatDate } from '../../i18n/format';
import { showToast } from '@org/data';
import { COUNTRIES } from '../../lib/countries';

const API_URL = (import.meta.env['VITE_API_URL'] as string) || 'http://localhost:3000';

const EVENT_RATING_OPTIONS = ['Family', 'Mature'];
const EVENT_RATING_LABEL_KEYS: Record<string, string> = { Family: 'form.rating.family', Mature: 'form.rating.mature' };

// ── GraphQL ──────────────────────────────────────────────────────────────────
const GET_EVENT = gql`
  query GetEventForEdit($id: ID!) {
    event(id: $id) {
      id eventName eventType eventRating eventDate applicationDate
      eventLocation zipCode country permits eventHost coordinator employees notes
      posLocationId numDays
      days { id dayNumber date startTime endTime }
    }
  }
`;
const GET_POS_LOCATIONS = gql`
  query GetPosLocations($companyId: ID!) {
    posLocations(companyId: $companyId) { id name }
  }
`;
const CREATE_EVENT = gql`
  mutation CreateEvent($companyId: ID!, $input: CreateEventInput!) {
    createEvent(companyId: $companyId, input: $input) { id }
  }
`;
const UPDATE_EVENT = gql`
  mutation UpdateEvent($id: ID!, $input: UpdateEventInput!) {
    updateEvent(id: $id, input: $input) { id }
  }
`;

// ── Date / time helpers ──────────────────────────────────────────────────────
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function fmtMonthDay(iso: string): string {
  return formatDate(iso, { month: 'short', day: 'numeric' });
}
function fmtRange(startISO: string, numDays: number, t: TFunction): string {
  if (!startISO) return '';
  const endISO = addDaysISO(startISO, Math.max(0, numDays - 1));
  const year = endISO.split('-')[0];
  if (numDays <= 1) {
    return t('form.range.single', 'Runs {{start}}, {{year}} · 1 day', {
      start: fmtMonthDay(startISO),
      year,
    });
  }
  return t('form.range.multi', 'Runs {{start}}–{{end}}, {{year}} · {{count}} days', {
    start: fmtMonthDay(startISO),
    end: fmtMonthDay(endISO),
    year,
    count: numDays,
  });
}

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const ampm = h < 12 ? 'AM' : 'PM';
      const hh = ((h + 11) % 12) + 1;
      out.push(`${hh}:${String(m).padStart(2, '0')} ${ampm}`);
    }
  }
  return out;
})();

interface DayRow { dayNumber: number; eventDate: string; startTime: string; endTime: string; }

const EMPTY_FORM = {
  eventName: '', eventType: '', eventRating: '',
  eventDate: '', applicationDate: '',
  eventLocation: '', zipCode: '', country: '', permits: '',
  eventHost: '', coordinator: '', employees: '', notes: '',
  posLocationId: '',
};
type EventFormState = typeof EMPTY_FORM;

export function AddEventPage() {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const { companyId, company } = useCurrentCompany();
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const fromSetup = searchParams.get('setup') === '1';
  const isEdit = !!eventId;

  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);
  const [numDays, setNumDays] = useState(1);
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: setupData } = useQuery(GET_POS_LOCATIONS, { variables: { companyId }, skip: !companyId });
  const { data: editData } = useQuery(GET_EVENT, { variables: { id: eventId }, skip: !isEdit });

  const [createEvent] = useMutation(CREATE_EVENT);
  const [updateEvent] = useMutation(UPDATE_EVENT);

  // New events default to the company's default country (user can still change it).
  useEffect(() => {
    if (isEdit) return;
    const def = (company as { defaultCountry?: string } | null)?.defaultCountry;
    if (def) setForm(prev => (prev.country ? prev : { ...prev, country: def }));
  }, [isEdit, company]);

  const posLocations: Array<{ id: string; name: string }> = setupData?.posLocations ?? [];

  function setField<K extends keyof EventFormState>(key: K, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  // Prefill when editing
  useEffect(() => {
    if (!editData?.event) return;
    const ev = editData.event;
    setForm({
      eventName: ev.eventName ?? '', eventType: ev.eventType ?? '', eventRating: ev.eventRating ?? '',
      eventDate: ev.eventDate ?? '', applicationDate: ev.applicationDate ?? '',
      eventLocation: ev.eventLocation ?? '', zipCode: ev.zipCode ?? '', country: ev.country ?? '', permits: ev.permits ?? '',
      eventHost: ev.eventHost ?? '', coordinator: ev.coordinator ?? '', employees: ev.employees ?? '',
      notes: ev.notes ?? '', posLocationId: ev.posLocationId ?? '',
    });
    setNumDays(ev.numDays ?? 1);
    setDays((ev.days ?? []).map((d: { dayNumber: number; date: string; startTime: string; endTime: string }) => ({
      dayNumber: d.dayNumber, eventDate: d.date ?? '', startTime: d.startTime ?? '', endTime: d.endTime ?? '',
    })));
  }, [editData]);

  // Keep the day rows in sync with numDays + start date
  useEffect(() => {
    setDays(prev => Array.from({ length: numDays }, (_, i) => ({
      dayNumber: i + 1,
      eventDate: prev[i]?.eventDate || (form.eventDate ? addDaysISO(form.eventDate, i) : ''),
      startTime: prev[i]?.startTime ?? '',
      endTime: prev[i]?.endTime ?? '',
    })));
  }, [numDays, form.eventDate]);

  // Assemble the mutation input from current form state.
  function buildInput() {
    const input: Record<string, unknown> = {
      eventName: form.eventName.trim(),
      eventType: form.eventType || null,
      eventRating: form.eventRating || null,
      eventDate: form.eventDate || null,
      applicationDate: form.applicationDate || null,
      eventLocation: form.eventLocation || null,
      zipCode: form.zipCode || null,
      country: form.country || null,
      permits: form.permits || null,
      eventHost: form.eventHost || null,
      coordinator: form.coordinator || null,
      employees: form.employees || null,
      notes: form.notes || null,
      posLocationId: form.posLocationId || null,
      numDays,
    };
    if (numDays > 1) {
      input['endDate'] = addDaysISO(form.eventDate, numDays - 1);
      input['days'] = days.map(d => ({
        dayNumber: d.dayNumber,
        eventDate: d.eventDate || null,
        startTime: d.startTime || null,
        endTime: d.endTime || null,
      }));
    }
    return input;
  }

  function validate(): boolean {
    if (!form.eventName.trim()) { showToast(t('toast.eventNameRequired', 'Event name is required'), 'error'); return false; }
    if (!form.eventDate) { showToast(t('toast.startDateRequired', 'Start date is required'), 'error'); return false; }
    if (!form.eventLocation.trim()) { showToast(t('toast.venueRequired', 'Venue name is required'), 'error'); return false; }
    if (!form.zipCode.trim()) { showToast(t('toast.zipRequired', 'ZIP code is required'), 'error'); return false; }
    return true;
  }

  async function uploadPermits(targetEventId: string) {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    const { supabase } = await import('@org/data');
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const fd = new FormData();
    fd.append('eventId', targetEventId);
    Array.from(files).forEach(f => fd.append('files', f));
    await fetch(`${API_URL}/api/uploads/permit`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  }

  // ── Create flow (essentials) ──────────────────────────────────────────────
  async function handleCreate(addDetails: boolean) {
    if (!validate()) return;
    setLoading(true);
    try {
      const { data } = await createEvent({ variables: { companyId, input: buildInput() } });
      const newId = data.createEvent.id;
      showToast(t('toast.eventCreated', 'Event created!'), 'success');
      // "Create & add details" always opens the edit form. Plain "Create event"
      // launched from the setup checklist returns there to continue setup.
      navigate(addDetails
        ? `/companies/${companyId}/events/${newId}/edit`
        : fromSetup
          ? `/companies/${companyId}`
          : `/companies/${companyId}/events/${newId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.createFailed', 'Failed to create event'), 'error');
    } finally { setLoading(false); }
  }

  // ── Edit flow ──────────────────────────────────────────────────────────────
  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!validate() || !eventId) return;
    setLoading(true);
    try {
      await updateEvent({ variables: { id: eventId, input: buildInput() } });
      await uploadPermits(eventId);
      showToast(t('toast.eventUpdated', 'Event updated!'), 'success');
      navigate(`/companies/${companyId}/events/${eventId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('toast.saveFailed', 'Failed to save event'), 'error');
    } finally { setLoading(false); }
  }


  // ════════════════════════ CREATE — Step 1 essentials ════════════════════════
  if (!isEdit) {
    return (
      <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 16px', color: 'var(--vv-navy)' }}>{t('form.title', 'Add an event')}</h2>
        <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: '0.92rem' }}>
          {t('form.essentialsIntro', 'Just the essentials. You can fill in everything else later.')}
        </p>

        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6 }}>
          {t('form.stepIndicator', 'STEP 1 OF 2 · ESSENTIALS')}
        </div>
        <div style={{ height: 8, borderRadius: 99, background: '#e2e8f0', marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ width: '50%', height: '100%', background: '#16a34a', borderRadius: 99 }} />
        </div>

        <form onSubmit={e => { e.preventDefault(); handleCreate(false); }}>
          <div className="form-group">
            <label>{t('form.eventName', 'Event name')} <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>{t('form.required', 'REQUIRED')}</span></label>
            <input type="text" value={form.eventName} onChange={e => setField('eventName', e.target.value)} placeholder={t('form.eventNamePlaceholder', 'e.g., Rocky Mountain Baseball')} autoFocus />
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 220, margin: 0 }}>
              <label>{t('form.startDate', 'Start date')} <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>{t('form.required', 'REQUIRED')}</span></label>
              <input type="date" value={form.eventDate} onChange={e => setField('eventDate', e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>{t('form.howManyDays', 'How many days?')} <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>{t('form.required', 'REQUIRED')}</span></label>
              <DayStepper value={numDays} onChange={setNumDays} t={t} />
            </div>
          </div>

          {form.eventDate && (
            <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: 8, padding: '8px 14px', fontSize: '0.86rem', fontWeight: 600, margin: '12px 0 4px' }}>
              {fmtRange(form.eventDate, numDays, t)}
            </div>
          )}

          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t('form.venueName', 'Venue name')} <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>{t('form.required', 'REQUIRED')}</span></label>
            <input type="text" value={form.eventLocation} onChange={e => setField('eventLocation', e.target.value)} placeholder={t('form.venuePlaceholder', 'e.g., Patriot Park')} />
          </div>

          <div className="form-group">
            <label>{t('form.zipCode', 'ZIP code')} <span style={{ color: '#dc2626', fontSize: '0.72rem', fontWeight: 700 }}>{t('form.required', 'REQUIRED')}</span></label>
            <input type="text" value={form.zipCode} onChange={e => setField('zipCode', e.target.value)} placeholder="84043" />
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '4px 0 0' }}>{t('form.zipHelp', 'We use this to auto-look-up your sales tax rate.')}</p>
          </div>

          <div className="form-group">
            <label>{t('form.country', 'Country')}</label>
            <select value={form.country} onChange={e => setField('country', e.target.value)}>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '4px 0 0' }}>{t('form.countryHelp', 'Defaults to your company default — change it for this event if needed.')}</p>
          </div>

          <div style={{ background: '#eff6ff', borderLeft: '3px solid #0B2A4A', borderRadius: 6, padding: '12px 14px', fontSize: '0.86rem', color: 'var(--vv-navy)', margin: '16px 0' }}>
            <strong>{t('form.almostDone', 'Almost done.')}</strong> {t('form.almostDoneBody', 'After this you can add host, coordinator, permits and notes — or skip and add them anytime from the event page.')}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button type="button" className="btn-secondary" style={{ background: 'none', border: 'none', color: 'var(--muted)' }} onClick={() => navigate(`/companies/${companyId}/events`)}>
              {t('form.cancel', 'Cancel')}
            </button>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => handleCreate(true)} disabled={loading}
                className="text-white border-0 font-semibold rounded-full px-5 py-2.5 cursor-pointer inline-flex items-center gap-2 disabled:opacity-60"
                style={{ background: '#00ABE2' }}>
                {loading && <span className="spinner" />} <span>{t('form.createAndAddDetails', 'Create & add details')}</span>
              </button>
              <button type="submit" disabled={loading}
                className="text-white border-0 font-semibold rounded-full px-5 py-2.5 cursor-pointer inline-flex items-center gap-2 disabled:opacity-60"
                style={{ background: '#16a34a' }}>
                {loading && <span className="spinner" />} <span>{t('form.createEvent', 'Create event')}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ════════════════════════ EDIT — full details ════════════════════════
  const sectionHeading: React.CSSProperties = { color: '#16a34a', fontWeight: 700, fontSize: '1.05rem', margin: '22px 0 12px' };

  return (
    <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 16px', color: 'var(--vv-navy)' }}>{t('form.title', 'Add an event')}</h2>

      <form onSubmit={handleUpdate}>
        {/* Permit documents */}
        <div className="form-group">
          <label>{t('form.permitDocuments', 'Permit Documents')}</label>
          <input type="file" ref={fileInputRef} multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.doc,.docx" />
        </div>

        {/* POS location */}
        <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t('form.posLocation', 'POS Location')}</label>
        {posLocations.length === 0 ? (
          <div style={{ background: '#eff6ff', border: '1px dashed #93c5fd', borderRadius: 8, padding: '12px 14px', margin: '6px 0 4px', fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--vv-navy)' }}><i className="fa-solid fa-location-dot" aria-hidden="true" /> {t('form.noPosLocations', 'No POS locations found')}</div>
            <div style={{ color: '#3b6fb0' }}>{t('form.noPosLocationsBody', 'Connect your POS in Settings to link a location and enable automatic sales sync.')}</div>
            <a href={`/companies/${companyId}/settings`} style={{ color: '#0085b0', fontWeight: 600 }}>{t('form.connectPosLink', 'Connect your POS in Settings')} <i className="fa-solid fa-arrow-right" aria-hidden="true" /></a>
          </div>
        ) : (
          <select value={form.posLocationId} onChange={e => setField('posLocationId', e.target.value)} style={{ marginTop: 6 }}>
            <option value="">{t('form.selectLocation', 'Select location…')}</option>
            {posLocations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        )}

        {/* The basics */}
        <div style={sectionHeading}>{t('form.sectionBasics', 'The basics')}</div>
        <div className="form-group">
          <label>{t('form.eventNameLabel', 'Event Name *')}</label>
          <input type="text" value={form.eventName} onChange={e => setField('eventName', e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('form.eventType', 'Event Type')}</label>
          <input type="text" value={form.eventType} onChange={e => setField('eventType', e.target.value)} placeholder={t('form.eventTypePlaceholder', 'e.g., Baseball tournament')} />
        </div>
        <div className="form-group">
          <label>{t('form.eventRating', 'Event Rating')}</label>
          <select value={form.eventRating} onChange={e => setField('eventRating', e.target.value)}>
            <option value=""></option>
            {EVENT_RATING_OPTIONS.map(r => <option key={r} value={r}>{t(EVENT_RATING_LABEL_KEYS[r], r)}</option>)}
          </select>
        </div>

        {/* When */}
        <div style={sectionHeading}>{t('form.sectionWhen', 'When')}</div>
        <div className="form-group">
          <label>{t('form.eventDateLabel', 'Event Date *')}</label>
          <input type="date" value={form.eventDate} onChange={e => setField('eventDate', e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('form.howManyDays', 'How many days?')}</label>
          <DayStepper value={numDays} onChange={setNumDays} fullWidth t={t} />
        </div>
        {days.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', width: 48 }}>{t('form.day', 'Day {{num}}', { num: i + 1 })}</span>
            <input type="date" value={d.eventDate} style={{ width: 170 }}
              onChange={e => setDays(prev => prev.map((x, j) => j === i ? { ...x, eventDate: e.target.value } : x))} />
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{t('form.start', 'Start')}</span>
            <TimeSelect value={d.startTime} onChange={v => setDays(prev => prev.map((x, j) => j === i ? { ...x, startTime: v } : x))} t={t} />
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{t('form.end', 'End')}</span>
            <TimeSelect value={d.endTime} onChange={v => setDays(prev => prev.map((x, j) => j === i ? { ...x, endTime: v } : x))} t={t} />
          </div>
        ))}
        <div className="form-group">
          <label>{t('form.applicationDate', 'Application Date')}</label>
          <input type="date" value={form.applicationDate} onChange={e => setField('applicationDate', e.target.value)} />
        </div>

        {/* Where & permits */}
        <div style={sectionHeading}>{t('form.sectionWhere', 'Where & permits')}</div>
        <div className="form-group">
          <label>{t('form.eventLocationLabel', 'Event Location *')}</label>
          <input type="text" value={form.eventLocation} onChange={e => setField('eventLocation', e.target.value)} placeholder={t('form.eventLocationPlaceholder', 'Venue name and address')} />
        </div>
        <div className="form-group">
          <label>{t('form.zipCodeLabel', 'Zip Code *')}</label>
          <input type="text" value={form.zipCode} onChange={e => setField('zipCode', e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('form.country', 'Country')}</label>
          <select value={form.country} onChange={e => setField('country', e.target.value)}>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('form.permits', 'Permits')}</label>
          <textarea value={form.permits} onChange={e => setField('permits', e.target.value)} rows={2} placeholder={t('form.permitsPlaceholder', 'e.g., Health permit submitted 04/01, awaiting approval')} />
        </div>

        {/* Who's running it */}
        <div style={sectionHeading}>{t('form.sectionWho', "Who's running it")}</div>
        <div className="form-group">
          <label>{t('form.eventHost', 'Event Host')}</label>
          <input type="text" value={form.eventHost} onChange={e => setField('eventHost', e.target.value)} placeholder={t('form.eventHostPlaceholder', 'Host name and contact')} />
        </div>
        <div className="form-group">
          <label>{t('form.coordinator', 'Coordinator')}</label>
          <input type="text" value={form.coordinator} onChange={e => setField('coordinator', e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('form.employees', 'Employees')}</label>
          <input type="text" value={form.employees} onChange={e => setField('employees', e.target.value)} placeholder={t('form.employeesPlaceholder', 'Expected staff on site')} />
        </div>
        <div className="form-group">
          <label>{t('form.notes', 'Notes')}</label>
          <textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={3} placeholder={t('form.notesPlaceholder', 'Internal notes for your team')} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading && <span className="spinner" />} <span><i className="fa-solid fa-floppy-disk" aria-hidden="true" /> {t('form.updateEvent', 'Update Event')}</span>
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(`/companies/${companyId}/events/${eventId}`)}>
            <i className="fa-solid fa-arrow-turn-up" aria-hidden="true" /> {t('form.cancelEdit', 'Cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Small controls ───────────────────────────────────────────────────────────
function DayStepper({ value, onChange, fullWidth, t }: { value: number; onChange: (n: number) => void; fullWidth?: boolean; t: TFunction }) {
  const btn: React.CSSProperties = { width: 40, height: 38, borderRadius: 8, border: '1px solid var(--border)', background: '#f1f5f9', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: fullWidth ? '1px solid var(--border)' : 'none', borderRadius: 8, padding: fullWidth ? 6 : 0, width: fullWidth ? '100%' : 'auto' }}>
      <button type="button" style={btn} onClick={() => onChange(Math.max(1, value - 1))} aria-label={t('form.fewerDays', 'Fewer days')}>−</button>
      <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>{value}</span>
      <button type="button" style={btn} onClick={() => onChange(Math.min(30, value + 1))} aria-label={t('form.moreDays', 'More days')}>+</button>
    </div>
  );
}

function TimeSelect({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: TFunction }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: 120 }}>
      <option value="">{t('form.timePlaceholder', '-- Time --')}</option>
      {TIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}
