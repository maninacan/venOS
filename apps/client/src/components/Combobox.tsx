import { useState, useEffect, useRef } from 'react';

// Searchable picker used for recipe/inventory columns in the POS mapping modals.
// Renders its dropdown with position:fixed so it isn't clipped by the modal's
// scrollable list.
export function Combobox({ options, value, onChange, disabled, noneLabel, placeholder, noMatchesLabel, highlight }: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  noneLabel: string;
  placeholder: string;
  noMatchesLabel: string;
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find(o => o.id === value) ?? null;

  function place() {
    const el = inputRef.current;
    if (el) { const rc = el.getBoundingClientRect(); setCoords({ left: rc.left, top: rc.bottom + 2, width: rc.width }); }
  }
  function openMenu() { if (disabled) return; setQuery(''); place(); setOpen(true); }
  function closeMenu() { setOpen(false); setQuery(''); }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) closeMenu();
    };
    // Close when the page/modal scrolls (the fixed-position menu would detach),
    // but NOT when the user is scrolling inside the dropdown list itself.
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);

  const filtered = options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : (selected ? selected.label : '')}
        placeholder={selected ? selected.label : placeholder}
        onFocus={openMenu}
        onChange={e => { setQuery(e.target.value); if (!open) { place(); setOpen(true); } }}
        onKeyDown={e => {
          if (e.key === 'Escape') { closeMenu(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Enter' && filtered.length) { onChange(filtered[0].id); closeMenu(); (e.target as HTMLInputElement).blur(); }
        }}
        style={{ width: '100%', padding: '5px 8px', border: highlight ? '1.5px solid #f59e0b' : '1px solid #d1d5db', borderRadius: 6, fontSize: '0.83rem', background: disabled ? '#f3f4f6' : highlight ? '#fffbeb' : '#fff', opacity: disabled ? 0.6 : 1 }}
      />
      {open && coords && (
        <div ref={popRef} style={{ position: 'fixed', left: coords.left, top: coords.top, width: coords.width, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', zIndex: 1000, fontSize: '0.83rem' }}>
          <div onMouseDown={e => { e.preventDefault(); onChange(null); closeMenu(); }}
            style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--muted)' }}>{noneLabel}</div>
          {filtered.map(o => (
            <div key={o.id} onMouseDown={e => { e.preventDefault(); onChange(o.id); closeMenu(); }}
              style={{ padding: '7px 10px', cursor: 'pointer', background: o.id === value ? '#eff6ff' : '#fff' }}>{o.label}</div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '7px 10px', color: 'var(--muted)' }}>{noMatchesLabel}</div>}
        </div>
      )}
    </div>
  );
}
