interface Props {
  title: string;
  /** Items completed so far. */
  done: number;
  /** Total items to process. */
  total: number;
  /** Optional line under the bar, e.g. "12 of 340 deleted". */
  detail?: string;
}

/**
 * Blocking determinate-progress modal for a bounded batch operation (e.g. bulk
 * delete). Presentational — the caller drives `done`/`total`. No close button:
 * it's meant to stay up until the operation finishes and the parent unmounts it.
 */
export function ProgressModal({ title, done, total, detail }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: '0 0 14px', color: 'var(--vv-navy)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner spinner-dark" style={{ width: 16, height: 16, borderWidth: 2 }} />
          {title}
        </h3>
        <div style={{ height: 8, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--vv-navy)', transition: 'width 0.2s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.84rem', color: 'var(--muted)' }}>
          <span>{detail}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--vv-navy)' }}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}
