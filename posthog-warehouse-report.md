# PostHog Data Warehouse Setup Report

## Summary

Four data sources were detected in this project (Supabase, Stripe, Resend, Square). None were automatically created in PostHog because credentials were not provided during the setup session. All four sources require manual setup via the PostHog app using the links below.

## Sources

### Supabase (Postgres)

**Status:** Needs browser setup — credentials not provided

Open this URL in your browser to connect Supabase as a Postgres source:

```
https://us.posthog.com/project/496946/data-warehouse/new-source?kind=Postgres
```

**Connection details to use (Session pooler — not the direct host):**

| Field    | Value                                              |
|----------|----------------------------------------------------|
| Host     | `aws-0-<region>.pooler.supabase.com`               |
| Port     | `6543`                                             |
| Database | `postgres`                                         |
| User     | `postgres.<project-ref>`                           |
| Password | Your Supabase database password (Settings → Database) |
| Schema   | `public`                                           |

- **Prod project ref:** `dxiiblpaduuzgmxodexj`
- **Dev project ref:** `vhacuniodglybfnjlzqi`

> Do **not** use the `anon` or `service_role` JWT keys for the password — use the database password.

---

### Stripe

**Status:** Needs browser setup — credentials not provided

Open this URL in your browser to connect Stripe:

```
https://us.posthog.com/project/496946/data-warehouse/new-source?kind=Stripe
```

**What you'll need:**

- A **restricted API key** (`rk_live_...`) — not your standard `sk_live_` key. Create one with the required read permissions at:
  `https://dashboard.stripe.com/apikeys`
- Your Stripe Account ID (optional, from `https://dashboard.stripe.com/settings/account`)

---

### Resend

**Status:** Needs browser setup — credentials not provided

Open this URL in your browser to connect Resend:

```
https://us.posthog.com/project/496946/data-warehouse/new-source?kind=Resend
```

**What you'll need:**

- A **full-access** Resend API key (`re_...`) with read permissions for Audiences, Broadcasts, Contacts, Domains, and Emails.
  > The key currently in your env may be restricted (send-only). Create a new full-access key at `https://resend.com/api-keys` if needed.

---

### Square

**Status:** Needs browser setup — credentials not provided

Open this URL in your browser to connect Square:

```
https://us.posthog.com/project/496946/data-warehouse/new-source?kind=Square
```

**What you'll need:**

- A **Personal Access Token** (or production app token) from the [Square Developer Dashboard](https://developer.squareup.com/apps) with these read permissions:
  - `PAYMENTS_READ`
  - `CUSTOMERS_READ`
  - `MERCHANT_PROFILE_READ`
  - `ITEMS_READ`

---

## Files Modified

No source code files were modified. This skill only connects external data sources to PostHog — it does not edit application code.

**Created:**
- `posthog-warehouse-report.md` (this file)

## Next Steps

1. Open each of the four URLs above in your browser while logged into PostHog.
2. Enter the credentials listed for each source.
3. Select which tables to sync (PostHog will suggest available tables after validating credentials).
4. Once connected, the data will appear in PostHog's Data Warehouse and can be joined against product events in HogQL queries.
