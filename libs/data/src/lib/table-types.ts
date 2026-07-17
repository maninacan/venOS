import type { ReactNode } from 'react';

export enum TableCellContentAlignEnum {
  LEFT = 'LEFT',
  CENTER = 'CENTER',
  RIGHT = 'RIGHT',
}

export interface BasicTableDataRow {
  id?: string | number;
  isDeleted?: boolean;
}

export type TableDataRow<T extends BasicTableDataRow> = T & {
  [key: string]: ReactNode;
};

export interface TableHeaderItem {
  id: string;
  headerLabel: string;
  alignment?: TableCellContentAlignEnum;
  headerStyles?: React.CSSProperties;
}

export interface TableSortOption {
  id: string;
  value: string;
}

export interface TableFilterOption {
  key: string;
  value: string;
  label: string;
  isAllOption?: boolean;
  enabledByDefault?: boolean;
  filter?: (row: BasicTableDataRow) => boolean;
}

export interface TableFilter {
  id: string;
  value: string;
  options: TableFilterOption[];
  isCustomFilter?: boolean;
  panelCss?: string;
}

export interface ActiveTableFilterOption {
  key: string;
  value: string;
  parentId: string;
  label: string;
  filter?: (row: BasicTableDataRow) => boolean;
}

export interface TableToggle {
  id: string;
  label: string;
  filter?: (row: BasicTableDataRow) => boolean;
  negativeFilter?: (row: BasicTableDataRow) => boolean;
}

export interface ActiveTableToggle {
  id: string;
  label: string;
  filter?: (row: BasicTableDataRow) => boolean;
  negativeFilter?: (row: BasicTableDataRow) => boolean;
}

export type CustomFilterMap = { [key: string]: () => ReactNode };

export interface PaginationProps {
  totalItems: number;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  currentPage: number;
  /** Localized pagination labels; English is used for any omitted key. */
  labels?: {
    showing?: string;
    to?: string;
    of?: string;
    results?: string;
    perPage?: string;
    previous?: string;
    next?: string;
  };
}
