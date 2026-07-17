import { ReactNode } from 'react';
import classNames from 'classnames';
import {
  BasicTableDataRow,
  TableCellContentAlignEnum,
  TableDataRow,
  TableHeaderItem,
} from '@org/data';

export interface TableRowProps<T extends BasicTableDataRow> {
  onClickRow?: (row: T) => void;
  row: TableDataRow<T>;
  headerList: TableHeaderItem[];
  backgroundColor?: string;
  dataTestId?: string;
}

export function TableRow<T extends BasicTableDataRow>({
  onClickRow,
  headerList,
  row,
  backgroundColor,
  dataTestId,
}: TableRowProps<T>) {
  return (
    <tr
      onClick={onClickRow ? () => onClickRow(row) : undefined}
      data-testid={dataTestId}
      className={classNames({
        'bg-white': !backgroundColor,
        [backgroundColor || '']: !!backgroundColor,
        'line-through text-red-700': row.isDeleted,
        'text-neutral-900': !row.isDeleted,
        'cursor-pointer group hover:bg-gray-100': !!onClickRow,
      })}
    >
      {headerList.map((li: TableHeaderItem) => (
        <td
          key={li.id}
          className={classNames(
            'py-2 px-3 text-xs font-medium leading-tight tracking-tight',
            {
              'bg-white': !backgroundColor,
              [backgroundColor || '']: !!backgroundColor,
              'group-hover:bg-gray-100 transition-colors': !!onClickRow,
            },
            {
              'text-left': !li.alignment || li.alignment === TableCellContentAlignEnum.LEFT,
              'text-center': li.alignment === TableCellContentAlignEnum.CENTER,
              'text-right': li.alignment === TableCellContentAlignEnum.RIGHT,
            }
          )}
        >
          {row[li.id] as ReactNode}
        </td>
      ))}
    </tr>
  );
}

export default TableRow;
