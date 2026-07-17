import { ActiveTableFilterOption, TableFilter } from '@org/data';

export const getActiveTableFilterOptionFromTableFilterOption = (
  tableFilters: TableFilter[],
  filterIndex: number,
  optionIndex: number
): ActiveTableFilterOption => {
  return {
    ...tableFilters[filterIndex].options[optionIndex],
    label:
      tableFilters[filterIndex].value +
      ' - ' +
      tableFilters[filterIndex].options[optionIndex].label,
    parentId: tableFilters[filterIndex].id,
  };
};

export const getDefaultActiveTableFilterOptions = (filters: TableFilter[]) => {
  const coords: [number, number][] = [];
  filters.forEach((filter, filterIndex) => {
    filter.options.forEach((option, optionIndex) => {
      if (option.enabledByDefault) {
        coords.push([filterIndex, optionIndex]);
      }
    });
  });
  return coords.map(([filterIndex, optionIndex]) =>
    getActiveTableFilterOptionFromTableFilterOption(filters, filterIndex, optionIndex)
  );
};
