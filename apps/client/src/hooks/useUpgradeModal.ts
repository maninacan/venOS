import { useState } from 'react';

export function useUpgradeModal() {
  const [upgradeContext, setUpgradeContext] = useState<string | null>(null);

  function showUpgrade(context: string) {
    setUpgradeContext(context);
  }

  function hideUpgrade() {
    setUpgradeContext(null);
  }

  return { upgradeContext, showUpgrade, hideUpgrade };
}
