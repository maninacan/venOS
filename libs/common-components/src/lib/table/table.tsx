import {
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActiveTableFilterOption,
  ActiveTableToggle,
  BasicTableDataRow,
  CustomFilterMap,
  PaginationProps,
  TableCellContentAlignEnum,
  TableDataRow,
  TableFilter,
  TableHeaderItem,
  TableSortOption,
  TableToggle,
} from '@org/data';
import classNames from 'classnames';
import TableRow from './table-row';
import FilterBar from '../filter-bar/filter-bar';
import Pagination from '../pagination/pagination';
import SimpleBar from 'simplebar-react';
import 'simplebar/dist/simplebar.min.css';

export interface TableProps<T extends BasicTableDataRow> {
  dataTestId?: string;
  onClickRow?: (row: T) => void;
  backgroundColor?: string;
  mapData?: (row: TableDataRow<T>, index: number) => TableDataRow<T> & { [key: string]: ReactNode };
  headerList: TableHeaderItem[];
  dataList: TableDataRow<T>[];
  actionItems?: ReactNode;
  className?: string;
  label?: string;
  sortOptions?: TableSortOption[];
  activeSort?: TableSortOption;
  setActiveSort?: Dispatch<SetStateAction<TableSortOption>>;
  onSortChange?: (option: TableSortOption) => void;
  customFilterMap?: CustomFilterMap;
  filters?: TableFilter[];
  activeFilters?: ActiveTableFilterOption[];
  setActiveFilters?: Dispatch<SetStateAction<ActiveTableFilterOption[]>>;
  toggles?: TableToggle[];
  activeToggles?: ActiveTableToggle[];
  setActiveToggles?: Dispatch<SetStateAction<ActiveTableToggle[]>>;
  searchValue?: string;
  handleSearch?: (value: string) => void;
  hideCount?: boolean;
  labelSuffix?: string;
  pagination?: PaginationProps;
  loading?: boolean;
  skeletonRows?: number;
  columnVisibilityStorageKey?: string;
  defaultHiddenColumns?: string[];
  columnsDropdownIgnore?: string[];
  controlledHiddenColumns?: Set<string>;
  onHiddenColumnsChange?: (next: Set<string>) => void;
}

export function Table<T extends BasicTableDataRow>({
  dataTestId,
  onClickRow,
  backgroundColor,
  dataList,
  mapData,
  headerList,
  actionItems,
  className,
  label,
  sortOptions,
  activeSort,
  setActiveSort,
  onSortChange,
  customFilterMap,
  filters,
  activeFilters,
  setActiveFilters,
  toggles,
  activeToggles,
  setActiveToggles,
  searchValue,
  handleSearch,
  hideCount = false,
  labelSuffix,
  pagination,
  loading = false,
  skeletonRows = 5,
  columnVisibilityStorageKey,
  defaultHiddenColumns = [],
  columnsDropdownIgnore = [],
  controlledHiddenColumns,
  onHiddenColumnsChange,
}: TableProps<T>) {
  const [internalHiddenColumns, setInternalHiddenColumns] = useState<Set<string>>(() => {
    if (controlledHiddenColumns !== undefined) return new Set();
    if (!columnVisibilityStorageKey) return new Set();
    try {
      const stored = localStorage.getItem(columnVisibilityStorageKey);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set(defaultHiddenColumns);
    } catch {
      return new Set(defaultHiddenColumns);
    }
  });

  const hiddenColumns = controlledHiddenColumns ?? internalHiddenColumns;
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!columnsDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setColumnsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [columnsDropdownOpen]);

  const toggleColumn = (id: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (onHiddenColumnsChange) {
      onHiddenColumnsChange(next);
    } else {
      setInternalHiddenColumns(next);
      if (columnVisibilityStorageKey) {
        localStorage.setItem(columnVisibilityStorageKey, JSON.stringify([...next]));
      }
    }
  };

  const visibleHeaders =
    columnVisibilityStorageKey || controlledHiddenColumns
      ? headerList.filter((h) => !hiddenColumns.has(h.id))
      : headerList;

  return (
    <div className={classNames(className, 'text-neutral-900 bg-white rounded-xl shadow p-2')}>
      <div className="mx-4 mt-3 mb-3 flex justify-between items-center max-sm:flex-wrap max-sm:gap-y-2">
        <div className="max-sm:w-full">
          <div className="text-sm font-medium leading-snug tracking-tight">
            {label && hideCount
              ? label
              : label
              ? `${label} ${pagination?.totalItems != null ? `(${pagination.totalItems})` : ''}${labelSuffix ? ` ${labelSuffix}` : ''}`
              : ''}
          </div>
          {handleSearch && (
            <div className="min-w-[280px] w-[340px] h-[38px] max-sm:w-full max-sm:min-w-0 px-3 py-2 bg-stone-50 rounded-lg justify-start items-center gap-2 inline-flex group ring-1 ring-gray-300">
              <i className="fa-solid fa-magnifying-glass text-gray-400 flex-shrink-0 text-[15px]" />
              <input
                value={searchValue}
                onChange={(e) => handleSearch(e.target.value)}
                className="grow shrink basis-0 text-neutral-600 text-xs font-normal leading-snug tracking-tight bg-stone-50 border-none outline-none"
                placeholder="Search..."
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {columnVisibilityStorageKey && (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setColumnsDropdownOpen((o) => !o)}
                className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
              >
                Columns
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
              {columnsDropdownOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  {headerList
                    .filter((h) => !columnsDropdownIgnore.includes(h.id))
                    .map((h) => (
                      <label key={h.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(h.id)}
                          onChange={() => toggleColumn(h.id)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                        />
                        {h.headerLabel}
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}
          {actionItems}
        </div>
      </div>

      {(sortOptions || filters || toggles) && (
        <FilterBar
          customFilterMap={customFilterMap}
          sortOptions={sortOptions}
          activeSort={activeSort}
          setActiveSort={setActiveSort}
          onSortChange={onSortChange}
          filters={filters}
          activeFilters={activeFilters}
          setActiveFilters={setActiveFilters}
          toggles={toggles}
          activeToggles={activeToggles}
          setActiveToggles={setActiveToggles}
        />
      )}

      <div className="overflow-hidden rounded-b-xl">
        <SimpleBar style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }} autoHide={false}>
          {' '}
          <table
            data-testid={dataTestId}
            className={classNames('border-b border-neutral-300 bg-white w-full', className)}
          >
            <thead className="px-3 py-2">
              <tr className="relative border-b border-neutral-300">
                {visibleHeaders.map((headerItem) => (
                  <th
                    key={headerItem.id}
                    scope="col"
                    style={headerItem?.headerStyles || {}}
                    className={classNames(
                      'py-2 px-3 text-neutral-900 text-xs font-semibold leading-tight tracking-tight',
                      {
                        'text-left': !headerItem.alignment || headerItem.alignment === TableCellContentAlignEnum.LEFT,
                        'text-center': headerItem.alignment === TableCellContentAlignEnum.CENTER,
                        'text-right': headerItem.alignment === TableCellContentAlignEnum.RIGHT,
                      }
                    )}
                  >
                    {headerItem.headerLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading
                ? Array.from({ length: skeletonRows }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {visibleHeaders.map((header) => (
                        <td key={header.id} className="py-3 px-3">
                          <div className="h-4 rounded bg-gray-200 w-3/4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : dataList.map((row, index) => {
                    const modifiedRow = mapData ? mapData(row, index) : row;
                    return (
                      <TableRow
                        onClickRow={onClickRow}
                        backgroundColor={backgroundColor}
                        key={row.id ?? index}
                        headerList={visibleHeaders}
                        row={modifiedRow}
                        dataTestId={`table-row-${row.id ?? index}`}
                      />
                    );
                  })}
            </tbody>
          </table>
        </SimpleBar>
      </div>

      {pagination &&
        typeof pagination.totalItems === 'number' &&
        pagination.totalItems > 0 &&
        pagination.onPageChange &&
        pagination.currentPage &&
        !hideCount && (
          <div className="px-3 py-2">
            <Pagination
              totalItems={pagination.totalItems}
              itemsPerPage={pagination.itemsPerPage}
              onPageChange={pagination.onPageChange}
              onItemsPerPageChange={pagination.onItemsPerPageChange}
              currentPage={pagination.currentPage}
              labels={pagination.labels}
            />
          </div>
        )}
    </div>
  );
}

export default Table;
