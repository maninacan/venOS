import {
  ChangeEvent,
  Dispatch,
  Fragment,
  SetStateAction,
  useState,
} from 'react';
import {
  Dialog,
  DialogPanel,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  PopoverGroup,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import classNames from 'classnames';
import {
  ActiveTableFilterOption,
  ActiveTableToggle,
  CustomFilterMap,
  TableFilter,
  TableFilterOption,
  TableSortOption,
  TableToggle,
} from '@org/data';
import { FilterPopover } from './filter-popover';
import Toggle from '../toggle/toggle';

export interface FilterBarProps {
  customFilterMap?: CustomFilterMap;
  sortOptions?: TableSortOption[];
  activeSort?: TableSortOption;
  setActiveSort?: Dispatch<SetStateAction<TableSortOption>>;
  onSortChange?: (option: TableSortOption) => void;
  filters?: TableFilter[];
  activeFilters?: ActiveTableFilterOption[];
  setActiveFilters?: Dispatch<SetStateAction<ActiveTableFilterOption[]>>;
  toggles?: TableToggle[];
  activeToggles?: ActiveTableToggle[];
  setActiveToggles?: Dispatch<SetStateAction<ActiveTableToggle[]>>;
}

export const FilterBar = ({
  customFilterMap,
  sortOptions,
  activeSort,
  setActiveSort,
  filters,
  activeFilters,
  setActiveFilters,
  onSortChange,
  toggles,
  activeToggles,
  setActiveToggles,
}: FilterBarProps) => {
  const [open, setOpen] = useState(false);

  const removeActiveFilter = (key: string) => {
    setActiveFilters?.((prevActiveFilters) =>
      prevActiveFilters.filter((filter) => filter.key !== key)
    );
  };

  const toggleFilter = (
    e: ChangeEvent<HTMLInputElement>,
    section: TableFilter,
    option: TableFilterOption
  ) => {
    if (e.target.checked) {
      setActiveFilters?.((prev) => {
        if (option.isAllOption) {
          return section.options
            .filter((opt) => !opt.isAllOption)
            .map((opt) => ({
              key: opt.key,
              value: opt.value,
              parentId: section.id,
              label: section.value + ' - ' + opt.label,
            }));
        }
        return [
          ...prev,
          {
            key: option.key,
            value: option.value,
            parentId: section.id,
            label: section.value + ' - ' + option.label,
            filter: option.filter,
          },
        ] as ActiveTableFilterOption[];
      });
    } else {
      setActiveFilters?.((prev) => {
        if (option.isAllOption) {
          return prev.filter((filter) => filter.parentId !== section.id);
        }
        return prev.filter((filter) => filter.key !== option.key);
      });
    }
  };

  const toggleToggle = (isEnabled: boolean, toggle: TableToggle) => {
    if (isEnabled) {
      setActiveToggles?.((prev) => [
        ...prev,
        { id: toggle.id, label: toggle.label, filter: toggle.filter, negativeFilter: toggle.negativeFilter },
      ]);
    } else {
      setActiveToggles?.((prev) => prev.filter((t) => t.id !== toggle.id));
    }
  };

  const calculateChecked = (section: TableFilter, option: TableFilterOption): boolean => {
    if (option.isAllOption) {
      const nonAllOptions = section.options.filter((opt) => !opt.isAllOption);
      return nonAllOptions.every((opt) =>
        activeFilters?.some((filter) => filter.key === opt.key)
      );
    }
    return activeFilters?.some((filter) => filter.key === option.key) || false;
  };

  return (
    <div className="bg-white">
      {/* Mobile filter dialog */}
      <Transition show={open} as={Fragment}>
        <Dialog as="div" className="relative z-40 sm:hidden" autoFocus={false} onClose={setOpen}>
          <TransitionChild
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </TransitionChild>

          <div className="fixed inset-0 z-40 flex">
            <TransitionChild
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="translate-x-full"
            >
              <DialogPanel className="relative ml-auto flex h-full w-full max-w-xs flex-col overflow-y-auto bg-white py-4 pb-12 shadow-xl">
                <div className="flex items-center justify-between px-4">
                  <h2 className="text-lg font-medium text-gray-900">Filters</h2>
                  <button
                    type="button"
                    className="-mr-2 flex h-10 w-10 items-center justify-center rounded-md bg-white p-2 text-gray-400"
                    onClick={() => setOpen(false)}
                  >
                    <span className="sr-only">Close menu</span>
                    <i aria-hidden="true" className="fa-solid fa-xmark text-lg" />
                  </button>
                </div>

                <form className="mt-4">
                  {filters?.map((section) => (
                    <Disclosure as="div" key={section.id} className="border-t border-gray-200 px-4 py-6" defaultOpen>
                      {({ open: sectionOpen }) => (
                        <>
                          <h3 className="-mx-2 -my-3 flow-root">
                            <DisclosureButton className="flex w-full items-center justify-between bg-white px-2 py-3 text-sm text-gray-400">
                              <span className="font-medium text-gray-900">{section.value}</span>
                              <span className="ml-6 flex items-center">
                                <span
                                  className={classNames(sectionOpen ? '-rotate-180' : 'rotate-0', 'transform inline-block text-sm')}
                                  aria-hidden="true"
                                ><i className="fa-solid fa-chevron-down" /></span>
                              </span>
                            </DisclosureButton>
                          </h3>
                          <DisclosurePanel className="pt-6">
                            {section.isCustomFilter && customFilterMap ? (
                              customFilterMap[section.id]()
                            ) : (
                              <div className="space-y-6">
                                {section.options.map((option, optionIdx) => (
                                  <div key={option.key} className="flex items-center">
                                    <input
                                      id={`filter-mobile-${section.id}-${optionIdx}`}
                                      name={`${section.id}[]`}
                                      defaultValue={option.value}
                                      type="checkbox"
                                      checked={calculateChecked(section, option)}
                                      className="h-4 w-4 rounded border-gray-300 text-[#0B2A4A] focus:ring-[#0B2A4A]"
                                      onChange={(e) => toggleFilter(e, section, option)}
                                    />
                                    <label
                                      htmlFor={`filter-mobile-${section.id}-${optionIdx}`}
                                      className="ml-3 text-sm text-gray-500"
                                    >
                                      {option.label}
                                    </label>
                                  </div>
                                ))}
                              </div>
                            )}
                          </DisclosurePanel>
                        </>
                      )}
                    </Disclosure>
                  ))}
                  {toggles?.map((toggle, index) => (
                    <div key={index} className="flex items-center px-4 py-2">
                      <Toggle
                        id={toggle.id}
                        label={toggle.label}
                        size="sm"
                        enabled={!!activeToggles?.some((t) => t.id === toggle.id)}
                        setEnabled={(isEnabled) => toggleToggle(isEnabled, toggle)}
                      />
                    </div>
                  ))}
                </form>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      {/* Desktop filters */}
      <section aria-labelledby="filter-heading">
        <h2 id="filter-heading" className="sr-only">Filters</h2>

        <div className="border-b border-gray-200 bg-white pb-2">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div>
              {sortOptions && (
                <Menu as="div" className="relative inline-block text-left">
                  <MenuButton className="group inline-flex justify-center text-xs font-medium text-gray-700 hover:text-gray-900">
                    {`Sort by ${activeSort?.value}`}
                    <i aria-hidden="true" className="-mr-1 ml-1 flex-shrink-0 text-gray-400 group-hover:text-gray-500 fa-solid fa-chevron-down text-xs" />
                  </MenuButton>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <MenuItems anchor="bottom" className="absolute left-0 z-10 mt-2 w-40 origin-top-left rounded-md bg-white shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="py-1">
                        {sortOptions.map((option) => {
                          const isActive = option.value === activeSort?.value;
                          return (
                            <MenuItem key={option.value}>
                              <div
                                className={classNames(
                                  isActive ? 'font-medium text-gray-900' : 'text-gray-500',
                                  'block data-[focus]:bg-gray-100 px-3 py-1.5 text-xs cursor-pointer'
                                )}
                                onClick={() => {
                                  if (onSortChange) onSortChange(option);
                                  else setActiveSort?.(option);
                                }}
                              >
                                {option.value}
                              </div>
                            </MenuItem>
                          );
                        })}
                      </div>
                    </MenuItems>
                  </Transition>
                </Menu>
              )}
            </div>

            <button
              type="button"
              className="inline-block text-sm font-medium text-gray-700 hover:text-gray-900 sm:hidden"
              onClick={() => setOpen(true)}
            >
              Filters
            </button>

            <div className="hidden sm:block">
              <div className="flow-root">
                <PopoverGroup className="-mx-4 flex items-center divide-x divide-gray-200">
                  {activeFilters && setActiveFilters && filters?.map((section, sectionIdx) => (
                    <FilterPopover
                      key={sectionIdx}
                      section={section}
                      activeFilters={activeFilters}
                      toggleFilter={toggleFilter}
                      calculateChecked={calculateChecked}
                      customFilterMap={customFilterMap}
                    />
                  ))}
                  {activeToggles && setActiveToggles && toggles?.map((toggle, index) => (
                    <div key={index} className="flex items-center px-4 py-2">
                      <Toggle
                        id={toggle.id}
                        label={toggle.label}
                        size="sm"
                        enabled={!!activeToggles?.some((t) => t.id === toggle.id)}
                        setEnabled={(isEnabled) => toggleToggle(isEnabled, toggle)}
                      />
                    </div>
                  ))}
                </PopoverGroup>
              </div>
            </div>
          </div>
        </div>

        {/* Active filters */}
        <div className={classNames('bg-gray-100 overflow-hidden', {
          'h-auto': (activeFilters?.length || 0) > 0,
          'h-0': (activeFilters || []).length === 0,
        })}>
          <div className="mx-auto max-w-7xl px-4 py-3 sm:flex sm:items-center sm:px-6 lg:px-8">
            <h3 className="text-sm font-medium text-gray-500">
              Filters<span className="sr-only">, active</span>
            </h3>
            <div aria-hidden="true" className="hidden h-5 w-px bg-gray-300 sm:ml-4 sm:block" />
            <div className="mt-2 sm:ml-4 sm:mt-0">
              <div className="-m-1 flex flex-wrap items-center">
                {activeFilters?.map((activeFilter) => (
                  <span
                    key={activeFilter.key}
                    className="m-1 inline-flex items-center rounded-full border border-gray-200 bg-white py-1.5 pl-3 pr-2 text-sm font-medium text-gray-900"
                  >
                    <span>{activeFilter.label}</span>
                    <button
                      type="button"
                      className="ml-1 inline-flex h-4 w-4 flex-shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-500"
                      onClick={() => removeActiveFilter(activeFilter.key)}
                    >
                      <span className="sr-only">Remove filter for {activeFilter.label}</span>
                      <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8">
                        <path strokeLinecap="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default FilterBar;
