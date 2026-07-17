import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  ActiveTableFilterOption,
  CustomFilterMap,
  TableFilter,
  TableFilterOption,
} from '@org/data';
import classNames from 'classnames';

export interface FilterPopoverProps {
  section: TableFilter;
  activeFilters: ActiveTableFilterOption[];
  toggleFilter: (
    e: ChangeEvent<HTMLInputElement>,
    section: TableFilter,
    option: TableFilterOption
  ) => void;
  calculateChecked: (section: TableFilter, option: TableFilterOption) => boolean;
  customFilterMap?: CustomFilterMap;
}

export const FilterPopover = ({
  section,
  activeFilters,
  toggleFilter,
  calculateChecked,
  customFilterMap,
}: FilterPopoverProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const numSelected = activeFilters.filter(
    (filter) => filter.parentId === section.id
  ).length;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block px-4 text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group inline-flex justify-center text-sm font-medium text-gray-700 hover:text-gray-900"
      >
        <span>{section.value}</span>
        {numSelected ? (
          <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-gray-700">
            {numSelected}
          </span>
        ) : null}
        <i aria-hidden="true" className="-mr-1 ml-1 text-gray-400 group-hover:text-gray-500 fa-solid fa-chevron-down text-sm" />
      </button>

      {open && (
        <div
          className={classNames(
            'w-fit absolute right-0 z-10 mt-2 pb-8 origin-top-right rounded-md bg-white p-4 shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-y-auto',
            section.panelCss
          )}
        >
          {section.isCustomFilter && customFilterMap ? (
            customFilterMap[section.id]()
          ) : (
            <form className="space-y-4">
              {section.options.map((option, optionIdx) => (
                <div key={option.value} className="flex items-center">
                  <input
                    id={`filter-${section.id}-${optionIdx}`}
                    name={`${section.id}[]`}
                    defaultValue={option.value}
                    type="checkbox"
                    checked={calculateChecked(section, option)}
                    className="h-4 w-4 rounded border-gray-300 text-[#0B2A4A] focus:ring-[#0B2A4A]"
                    onChange={(e) => toggleFilter(e, section, option)}
                  />
                  <label
                    htmlFor={`filter-${section.id}-${optionIdx}`}
                    className="ml-3 whitespace-nowrap pr-6 text-sm font-medium text-gray-900"
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </form>
          )}
        </div>
      )}
    </div>
  );
};
