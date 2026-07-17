import { Resend } from 'resend';
import logger from './logger.js';

// Resend transactional email client. The API key is a send-only restricted
// key (see Doppler RESEND_API_KEY). Auth emails (signup/reset/invite) are sent
// by Supabase over Resend SMTP; this client is for app-level transactional
// email the API sends directly.
const apiKey = process.env['RESEND_API_KEY'];

// "Name <address>" — address must be on a Resend-verified domain.
export const EMAIL_FROM = process.env['EMAIL_FROM'] ?? 'venOS <no-reply@mail.venview.io>';

const resend = apiKey ? new Resend(apiKey) : null;

if (!resend) {
  logger.warn('email: RESEND_API_KEY not set — outgoing app emails will be skipped');
}

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/**
 * Best-effort transactional send. Returns true on success, false if email is
 * unconfigured or the send failed — callers should never let email failures
 * break the surrounding operation.
 */
export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  if (!resend) {
    logger.warn('sendEmail: skipped (RESEND_API_KEY not set)', { subject: args.subject });
    return false;
  }
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    if (error) {
      logger.error('sendEmail: Resend returned an error', { error: error.message, subject: args.subject });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('sendEmail: failed to send', {
      error: err instanceof Error ? err.message : String(err),
      subject: args.subject,
    });
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

// ── Branded email shell (VenView logo + green/lime theme) ─────────────────────
const LOGO_URL = 'https://dxiiblpaduuzgmxodexj.supabase.co/storage/v1/object/public/assets/venOS-logo.jpg';
const GREEN = '#1e8a3e';
const GREEN_DARK = '#14632c';
const LIME = '#a5d610';

/** Wrap message-specific `inner` HTML in the branded shell (logo header + footer). */
function shell(inner: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(20,99,44,0.10);">
          <tr><td style="height:5px;line-height:5px;font-size:0;background:${GREEN};background:linear-gradient(90deg,${GREEN},${LIME});">&nbsp;</td></tr>
          <tr><td align="center" style="background:#ffffff;padding:26px 32px 20px;border-bottom:1px solid #eef2f7;">
            <img src="${LOGO_URL}" alt="venOS" width="120" height="94" style="display:block;width:120px;height:auto;border:0;outline:none;text-decoration:none;" />
          </td></tr>
          <tr><td style="padding:32px;">
            ${inner}
          </td></tr>
          <tr><td style="padding:0 32px 32px;">
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;" />
            <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">venOS — profit tracking for event vendors. If this wasn't you, you can safely ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Branded CTA button linking to `url`. */
function brandButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border-radius:10px;background:${GREEN};background:linear-gradient(135deg,${GREEN},#37a24a);">
    <a href="${url}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
  </td></tr></table>`;
}

const heading = (t: string) => `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${GREEN_DARK};">${t}</h1>`;
const para = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${t}</p>`;
const linkFallback = (url: string) =>
  `<p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Or paste this link into your browser:</p>` +
  `<p style="margin:0;font-size:12px;word-break:break-all;"><a href="${url}" style="color:${GREEN};">${url}</a></p>`;

/**
 * Branded welcome email sent when a new company is created. Best-effort.
 */
export async function sendWelcomeEmail(to: string, companyName: string, companyId: string): Promise<boolean> {
  const clientUrl = process.env['CLIENT_URL'] ?? 'https://app.venview.io';
  const companyUrl = `${clientUrl}/companies/${companyId}`;
  const company = escapeHtml(companyName);
  const html = shell(
    heading('Welcome to venOS! 🎉') +
    para(`Your company <strong>${company}</strong> is ready. venOS helps event vendors know if they actually made money — track sales, costs, and true profit for every market, festival, and pop-up.`) +
    para('The fastest way to see it in action: add a recent event and open its Profit Summary.') +
    brandButton(companyUrl, 'Open venOS')
  );
  const text = `Welcome to venOS!\n\nYour company ${companyName} is ready. venOS helps event vendors track sales, costs, and true profit for every event.\n\nOpen venOS: ${companyUrl}`;
  return sendEmail({ to, subject: 'Welcome to venOS 🎉', html, text });
}

/**
 * Notifies a company owner that someone has requested to join their company,
 * linking straight to the Team Access section of Settings. Best-effort.
 */
export async function sendJoinRequestEmail(
  to: string,
  opts: { companyId: string; companyName: string; requesterEmail?: string; reminder?: boolean }
): Promise<boolean> {
  const clientUrl = process.env['CLIENT_URL'] ?? 'https://app.venview.io';
  const teamUrl = `${clientUrl}/companies/${opts.companyId}/settings#team-access`;
  const company = escapeHtml(opts.companyName);
  const requester = opts.requesterEmail ? escapeHtml(opts.requesterEmail) : 'Someone';
  const title = opts.reminder ? `Reminder: request to join ${company}` : `New request to join ${company}`;
  const intro = opts.reminder
    ? `Just a reminder — <strong>${requester}</strong> is still waiting to join your company on venOS. Approve or deny the request from your team settings.`
    : `<strong>${requester}</strong> has requested to join your company on venOS. Review the request and approve or deny it from your team settings.`;
  const html = shell(
    heading(title) +
    para(intro) +
    brandButton(teamUrl, 'Review request') +
    linkFallback(teamUrl)
  );
  const subject = opts.reminder
    ? `Reminder: request to join ${opts.companyName}`
    : `New request to join ${opts.companyName}`;
  const text = `${opts.requesterEmail ?? 'Someone'} is waiting to join ${opts.companyName} on venOS.\n\nReview the request (approve or deny) here: ${teamUrl}`;
  return sendEmail({ to, subject, html, text });
}
