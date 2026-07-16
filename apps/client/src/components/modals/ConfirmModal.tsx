import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  message: ReactNode;
  /** Final action label (e.g. "Delete company"). */
  confirmLabel: string;
  cancelLabel: string;
  /** Style the confirm action as destructive. */
  danger?: boolean;
  /**
   * When set, the user must type this text before confirming — a second step
   * appears after the warning. Match is trimmed + case-insensitive.
   */
  requireText?: string;
  /** Instruction shown above the type-to-confirm input. */
  requireTextPrompt?: ReactNode;
  /** Label for the phase-1 advance button when requireText is set (defaults to confirmLabel). */
  continueLabel?: string;
  backLabel?: string;
  /** Placeholder for the type-to-confirm input. */
  inputPlaceholder?: string;
  /** Runs on confirm. Throw to surface an error in-modal; on success the parent should close/unmount. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Reusable confirmation modal. Two modes:
 *  - Simple: title + message + confirm/cancel.
 *  - Type-to-confirm: pass `requireText` — the warning becomes step 1, and a
 *    second step requires the user to type the phrase before the action enables.
 * Presentational: all copy is passed in (already translated) by the caller.
 */
export function ConfirmModal({
  title, message, confirmLabel, cancelLabel, danger, requireText, requireTextPrompt,
  continueLabel, backLabel, inputPlaceholder, onConfirm, onClose,
}: Props) {
  const [phase, setPhase] = useState<'warn' | 'type'>('warn');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = !requireText || norm(typed) === norm(requireText);
  const confirmClass = danger ? 'btn-danger' : 'btn-primary';

  // Escape cancels (unless mid-action).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Focus the input when the type step appears.
  useEffect(() => { if (phase === 'type') inputRef.current?.focus(); }, [phase]);

  async function runConfirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      // Success: the parent unmounts this modal (navigation / state change).
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // Backdrop click cancels only on the warning step and when idle — avoids
  // accidentally discarding an in-progress type-to-confirm.
  const onOverlay = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && phase === 'warn' && !busy) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onOverlay}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        {!busy && <button className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>}
        <h3 style={{ margin: '0 0 8px', color: 'var(--vv-navy)' }}>{title}</h3>

        {phase === 'warn' ? (
          <>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
              {message}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
              {requireText ? (
                <button type="button" className={confirmClass} onClick={() => setPhase('type')}>
                  {continueLabel ?? confirmLabel}
                </button>
              ) : (
                <button type="button" className={confirmClass} onClick={runConfirm} disabled={busy}>
                  {busy && <span className="spinner" />} <span>{confirmLabel}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={e => { e.preventDefault(); if (matches && !busy) runConfirm(); }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
              {requireTextPrompt}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={inputPlaceholder}
              autoComplete="off"
              disabled={busy}
              style={{ width: '100%', marginBottom: 4 }}
            />
            {error && <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
              <button type="button" className="btn-secondary" onClick={() => setPhase('warn')} disabled={busy}>
                {backLabel ?? cancelLabel}
              </button>
              <button type="submit" className={confirmClass} disabled={!matches || busy}>
                {busy && <span className="spinner" />} <span>{confirmLabel}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
