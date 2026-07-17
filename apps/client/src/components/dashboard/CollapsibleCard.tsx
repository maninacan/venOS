import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
}

export function CollapsibleCard({ title, children, defaultOpen = false, headerRight }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-xl border border-[rgba(11,42,74,0.12)] overflow-hidden mb-2.5 shadow-[0_4px_12px_rgba(11,42,74,0.08)]">
      <button
        className="flex items-center justify-between w-full px-[18px] py-[13px] bg-[#f8fafc] text-left text-[0.93rem] font-semibold text-[#0B2A4A] border-0 cursor-pointer select-none font-[inherit] transition-colors hover:bg-[#f1f5f9]"
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {headerRight}
          <span
            className="text-[0.72rem] text-[#64748b] inline-block transition-transform duration-[220ms]"
            style={{ transform: open ? 'rotate(180deg)' : undefined }}
          >
            ▼
          </span>
        </span>
      </button>
      <div className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${open ? 'max-h-[99999px]' : 'max-h-0'}`}>
        <div className="px-[18px] pt-3.5 pb-[18px]">{children}</div>
      </div>
    </div>
  );
}
