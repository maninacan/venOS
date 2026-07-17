import classNames from 'classnames';
import { Switch } from '@headlessui/react';
import { ReactNode, useEffect } from 'react';

export interface ToggleProps {
  id?: string;
  label?: ReactNode;
  enabled: boolean | undefined | null;
  setEnabled: (isEnabled: boolean) => void;
  defaultToTrue?: boolean;
  size?: 'default' | 'sm';
}

export const Toggle = ({
  label,
  enabled,
  setEnabled,
  id,
  defaultToTrue,
  size = 'default',
}: ToggleProps) => {
  useEffect(() => {
    if (defaultToTrue && enabled !== false) {
      setEnabled(true);
    }
  }, [defaultToTrue, enabled, setEnabled]);

  const isSmall = size === 'sm';

  return (
    <div className="flex items-center" id={id}>
      <Switch
        checked={!!enabled}
        onChange={setEnabled}
        className={classNames(
          enabled ? 'bg-[#0B2A4A]' : 'bg-gray-200',
          'relative inline-flex flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0B2A4A] focus:ring-offset-2',
          isSmall ? 'h-4 w-8' : 'h-6 w-11'
        )}
      >
        <span
          aria-hidden="true"
          className={classNames(
            enabled
              ? isSmall
                ? 'translate-x-4'
                : 'translate-x-5'
              : 'translate-x-0',
            'pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            isSmall ? 'h-3 w-3' : 'h-5 w-5'
          )}
        />
      </Switch>
      {!!label && (
        <span className={isSmall ? 'ml-2 text-xs' : 'ml-3 text-sm'}>
          {label}
        </span>
      )}
    </div>
  );
};

export default Toggle;
