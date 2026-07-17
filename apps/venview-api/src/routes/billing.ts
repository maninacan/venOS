import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { stripe, STRIPE_PRO_PRICE_ID, STRIPE_WEBHOOK_SECRET } from '../lib/stripe.js';
import { createContext } from '../context/index.js';

// Derive Stripe resource types from the client so we don't depend on the
// package's namespace-export shape (which varies across versions/builds).
type StripeEvent = ReturnType<typeof stripe.webhooks.constructEvent>;
type StripeSubscription = Extract<StripeEvent, { type: 'customer.subscription.updated' }>['data']['object'];

const router: IRouter = Router();

const CLIENT_URL = process.env['CLIENT_URL'] ?? 'http://localhost:4200';

function billingUrl(companyId: string, status?: string): string {
  const suffix = status ? `?billing=${status}` : '';
  return `${CLIENT_URL}/companies/${companyId}/billing${suffix}`;
}

// Resolve the requesting user and confirm they own the company. Returns the
// company row on success, or null after writing the appropriate error response.
async function requireOwner(req: Request, res: Response): Promise<Record<string, unknown> | null> {
  const ctx = await createContext(req);
  if (!ctx.user) { res.status(401).json({ error: 'Unauthorized' }); return null; }

  const companyId = (req.body as { companyId?: string })?.companyId;
  if (!companyId) { res.status(400).json({ error: 'companyId required' }); return null; }

  const { data: member } = await supabase
    .from('CompanyMembers')
    .select('role')
    .eq('companyId', companyId)
    .eq('userId', ctx.user.id)
    .single();
  if (!member) { res.status(403).json({ error: 'Forbidden' }); return null; }
  if ((member as { role: string }).role !== 'owner') {
    res.status(403).json({ error: 'Only the company owner can manage billing' });
    return null;
  }

  const { data: company } = await supabase
    .from('Companies')
    .select('*')
    .eq('id', companyId)
    .single();
  if (!company) { res.status(404).json({ error: 'Company not found' }); return null; }

  return { ...(company as Record<string, unknown>), _email: ctx.user.email };
}

// Return the company's Stripe customer id, creating the customer on first use.
async function ensureStripeCustomer(company: Record<string, unknown>): Promise<string> {
  const existing = company['stripeCustomerId'] as string | null;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email: (company['email'] as string) || (company['_email'] as string) || undefined,
    name: company['name'] as string,
    metadata: { companyId: company['id'] as string },
  });

  await supabase
    .from('Companies')
    .update({ stripeCustomerId: customer.id })
    .eq('id', company['id'] as string);

  return customer.id;
}

// ── POST /api/billing/checkout ───────────────────────────────────────────────
// Start a hosted Checkout session for the monthly Pro subscription.
router.post('/billing/checkout', async (req: Request, res: Response) => {
  try {
    const company = await requireOwner(req, res);
    if (!company) return;

    if (!STRIPE_PRO_PRICE_ID) {
      return void res.status(500).json({ error: 'Billing is not configured (missing price)' });
    }

    const companyId = company['id'] as string;
    const customerId = await ensureStripeCustomer(company);

    // Guard against duplicate subscriptions: if one is already active, mirror it
    // and send them to manage it instead of charging a second time.
    const existing = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    if (existing.data.some((s: { status: string }) => s.status === 'active' || s.status === 'trialing')) {
      await reconcileFromStripe(customerId);
      return void res.status(409).json({ error: 'You already have an active Pro subscription.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: companyId,
      line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: billingUrl(companyId, 'success'),
      cancel_url: billingUrl(companyId, 'cancelled'),
      subscription_data: { metadata: { companyId } },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing checkout error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start checkout' });
  }
});

// ── POST /api/billing/portal ─────────────────────────────────────────────────
// Open the Stripe Billing Portal to manage / cancel an existing subscription.
router.post('/billing/portal', async (req: Request, res: Response) => {
  try {
    const company = await requireOwner(req, res);
    if (!company) return;

    const companyId = company['id'] as string;
    const customerId = company['stripeCustomerId'] as string | null;
    if (!customerId) {
      return void res.status(400).json({ error: 'No subscription to manage yet' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: billingUrl(companyId),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to open billing portal' });
  }
});

// Pull the customer's live subscription state from Stripe and mirror it onto
// the company. Self-heal path for when a webhook event was never delivered.
async function reconcileFromStripe(customerId: string): Promise<void> {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const activeSub = subs.data.find((s: { status: string }) => s.status === 'active' || s.status === 'trialing');
  if (activeSub) {
    await syncSubscription(activeSub);
  } else if (subs.data.length > 0) {
    await clearSubscription(subs.data[0]);
  }
}

// ── POST /api/billing/refresh ────────────────────────────────────────────────
// Any active member can trigger a reconcile from Stripe (used on return from
// Checkout so the plan reflects immediately even if the webhook was missed).
router.post('/billing/refresh', async (req: Request, res: Response) => {
  try {
    const ctx = await createContext(req);
    if (!ctx.user) return void res.status(401).json({ error: 'Unauthorized' });

    const companyId = (req.body as { companyId?: string })?.companyId;
    if (!companyId) return void res.status(400).json({ error: 'companyId required' });

    const { data: member } = await supabase
      .from('CompanyMembers')
      .select('role')
      .eq('companyId', companyId)
      .eq('userId', ctx.user.id)
      .eq('status', 'active')
      .single();
    if (!member) return void res.status(403).json({ error: 'Forbidden' });

    const { data: company } = await supabase
      .from('Companies')
      .select('stripeCustomerId')
      .eq('id', companyId)
      .single();
    const customerId = (company as Record<string, unknown> | null)?.['stripeCustomerId'] as string | null;
    if (customerId) await reconcileFromStripe(customerId);

    const { data: updated } = await supabase
      .from('Companies')
      .select('plan, subscriptionStatus, currentPeriodEnd')
      .eq('id', companyId)
      .single();

    res.json({ ok: true, ...(updated as object) });
  } catch (err) {
    console.error('Billing refresh error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to refresh billing' });
  }
});

// Apply a subscription's current state to the owning company row.
async function syncSubscription(subscription: StripeSubscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  // Prefer the companyId stamped on the subscription; fall back to customer id.
  const companyId = subscription.metadata?.['companyId'];
  const query = supabase.from('Companies').select('id');
  const { data: company } = companyId
    ? await query.eq('id', companyId).single()
    : await query.eq('stripeCustomerId', customerId).single();
  if (!company) return;

  const status = subscription.status;
  const isActive = status === 'active' || status === 'trialing';

  // `current_period_end` lives on the subscription item in recent API versions.
  const periodEnd = subscription.items?.data?.[0]?.current_period_end
    ?? (subscription as unknown as { current_period_end?: number }).current_period_end;

  await supabase
    .from('Companies')
    .update({
      plan: isActive ? 'pro' : 'starter',
      planUpdatedAt: new Date().toISOString(),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    })
    .eq('id', (company as { id: string }).id);
}

// Downgrade a company to starter when its subscription is removed.
async function clearSubscription(subscription: StripeSubscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
  const companyId = subscription.metadata?.['companyId'];

  const query = supabase.from('Companies').select('id');
  const { data: company } = companyId
    ? await query.eq('id', companyId).single()
    : await query.eq('stripeCustomerId', customerId).single();
  if (!company) return;

  await supabase
    .from('Companies')
    .update({
      plan: 'starter',
      planUpdatedAt: new Date().toISOString(),
      stripeSubscriptionId: null,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: null,
    })
    .eq('id', (company as { id: string }).id);
}

// ── POST /api/billing/webhook ────────────────────────────────────────────────
// Public endpoint — authenticity is established by Stripe signature, not auth.
// NOTE: this route is mounted with express.raw() in main.ts; req.body is a Buffer.
router.post('/billing/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  if (!signature || !STRIPE_WEBHOOK_SECRET) {
    return void res.status(400).send('Missing signature or webhook secret');
  }

  let event: StripeEvent;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature as string, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return void res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'invalid'}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subId);
          await syncSubscription(subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await syncSubscription(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await clearSubscription(event.data.object);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

export default router;
