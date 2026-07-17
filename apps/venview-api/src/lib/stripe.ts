import Stripe from 'stripe';

const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];

if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY env var');
}

// Pin to the SDK's bundled API version by omitting `apiVersion`.
export const stripe: Stripe.Stripe = new Stripe(stripeSecretKey);

// The monthly Pro price customers subscribe to.
export const STRIPE_PRO_PRICE_ID = process.env['STRIPE_PRO_PRICE_ID'] ?? '';

// Signing secret used to verify incoming webhook payloads.
export const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
