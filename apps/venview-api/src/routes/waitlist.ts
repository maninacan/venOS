import { Router, type IRouter } from 'express';
import { supabase } from '../lib/supabase.js';
import logger from '../lib/logger.js';

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Early-access signups from the marketing site. Stored in the locked-down
// "Waitlist" table via the service-role client.
router.post('/waitlist', async (req, res) => {
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const source =
    typeof req.body?.source === 'string' ? req.body.source.slice(0, 50) : null;

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  // Idempotent: a repeat signup with the same email is a no-op, not an error.
  const { error } = await supabase
    .from('Waitlist')
    .upsert({ email, source }, { onConflict: 'email', ignoreDuplicates: true });

  if (error) {
    logger.error('waitlist signup failed', { error: error.message });
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }

  return res.status(201).json({ ok: true });
});

export default router;
