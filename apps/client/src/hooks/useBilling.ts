import { useState } from 'react';
import { showToast } from '@org/data';

const API_URL = (import.meta.env['VITE_API_URL'] as string) || 'http://localhost:3000';

// Posts to a billing REST endpoint with the Supabase session token and
// redirects the browser to the Stripe-hosted URL it returns.
async function redirectToStripe(path: string, companyId: string): Promise<void> {
  const { supabase } = await import('@org/data');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${API_URL}/api/billing/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ companyId }),
  });

  const result = await res.json() as { url?: string; error?: string };
  if (!res.ok || !result.url) throw new Error(result.error ?? 'Billing request failed');
  window.location.href = result.url;
}

export function useBilling() {
  const [busy, setBusy] = useState(false);

  async function run(path: string, companyId: string, failMsg: string) {
    setBusy(true);
    try {
      await redirectToStripe(path, companyId);
      // Browser navigates away on success; no need to clear `busy`.
    } catch (err) {
      showToast(err instanceof Error ? err.message : failMsg, 'error');
      setBusy(false);
    }
  }

  // Reconcile plan from Stripe (no redirect). Returns true if it succeeded.
  async function refresh(companyId: string): Promise<boolean> {
    try {
      const { supabase } = await import('@org/data');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/billing/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ companyId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    busy,
    startCheckout: (companyId: string) => run('checkout', companyId, 'Failed to start checkout'),
    openPortal: (companyId: string) => run('portal', companyId, 'Failed to open billing portal'),
    refresh,
  };
}
