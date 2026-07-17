
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface PaginationLabels {
  showing: string;
  to: string;
  of: string;
  results: string;
  perPage: string;
  previous: string;
  next: string;
}

const DEFAULT_LABELS: PaginationLabels = {
  showing: 'Showing',
  to: 'to',
  of: 'of',
  results: 'results',
  perPage: '/ page',
  previous: 'Previous',
  next: 'Next',
};

interface PaginationProps {
  totalItems: number;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  currentPage: number;
  /** Localized labels; English is used for any omitted key. */
  labels?: Partial<PaginationLabels>;
}

const Pagination = ({
  totalItems,
  itemsPerPage = 10,
  onPageChange,
  onItemsPerPageChange,
  currentPage,
  labels,
}: PaginationProps) => {
  const l: PaginationLabels = { ...DEFAULT_LABELS, ...labels };
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    onPageChange?.(page);
  };

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        pages.push(1, 2, 3, 4, 5, '...', totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className="flex items-center justify-between border-t border-gray-200 bg-white px-3 py-2 sm:px-4 space-x-4">
      <div className="flex flex-1 items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-700">
            {l.showing} <span className="font-medium">{startItem}</span> {l.to}{' '}
            <span className="font-medium">{endItem}</span> {l.of}{' '}
            <span className="font-medium">{totalItems}</span> {l.results}
          </p>
          {onItemsPerPageChange && (
            <select
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              className="w-auto rounded-md border border-gray-300 bg-white py-1 pl-2 pr-7 text-xs text-gray-700 focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} {l.perPage}</option>
              ))}
            </select>
          )}
        </div>
        <nav aria-label="Pagination" className="isolate inline-flex -space-x-px rounded-md shadow-xs">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            data-testid="pagination-previous-button"
            disabled={currentPage === 1}
            className="relative inline-flex items-center rounded-l-md px-1.5 py-1.5 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 disabled:opacity-50"
          >
            <span className="sr-only">{l.previous}</span>
            <i aria-hidden="true" className="fa-solid fa-chevron-left text-sm" />
          </button>

          {pages.map((page, idx) =>
            typeof page === 'number' ? (
              <button
                key={idx}
                data-testid={`pagination-page-button-${page}`}
                onClick={() => handlePageChange(page)}
                className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold focus:z-20 ${
                  currentPage === page
                    ? 'z-10 bg-[#0B2A4A] text-white'
                    : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'
                }`}
              >
                {page}
              </button>
            ) : (
              <span
                key={idx}
                className="relative inline-flex items-center px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-300"
              >
                ...
              </span>
            )
          )}

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            data-testid="pagination-next-button"
            disabled={currentPage === totalPages}
            className="relative inline-flex items-center rounded-r-md px-1.5 py-1.5 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 disabled:opacity-50"
          >
            <span className="sr-only">{l.next}</span>
            <i aria-hidden="true" className="fa-solid fa-chevron-right text-sm" />
          </button>
        </nav>
      </div>
    </div>
  );
};

export default Pagination;
