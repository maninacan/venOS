<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the venOS marketing site (`apps/marketing`). A `posthog.astro` initialization component was created and embedded into every page via `Layout.astro`. Five business-critical events are now tracked across the waitlist conversion funnel, engagement signals are captured from the sticky nav, and error exceptions are forwarded to PostHog error tracking on network failures.

| Event Name | Description | File |
|---|---|---|
| `waitlist_signup_submitted` | User clicked the waitlist submit button from either the hero or CTA section. | `apps/marketing/src/pages/index.astro` |
| `waitlist_signup_success` | Waitlist API call returned a successful response and the user's email was recorded. | `apps/marketing/src/pages/index.astro` |
| `waitlist_signup_error` | Waitlist submission failed due to a validation, network, or server error. | `apps/marketing/src/pages/index.astro` |
| `nav_cta_clicked` | User clicked the 'Get Early Access' button in the sticky navigation bar. | `apps/marketing/src/layouts/Layout.astro` |
| `cta_section_viewed` | The bottom CTA section scrolled into view, indicating the user reached the final conversion prompt. | `apps/marketing/src/pages/index.astro` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/496946/dashboard/1797226)
- [Waitlist Conversion Funnel (wizard)](https://us.posthog.com/project/496946/insights/zngwQhuX)
- [Waitlist Signups Over Time (wizard)](https://us.posthog.com/project/496946/insights/RNvvU4uF)
- [Signup Source Breakdown (wizard)](https://us.posthog.com/project/496946/insights/5o8F86Ik)
- [Nav CTA Clicks (wizard)](https://us.posthog.com/project/496946/insights/atN3HDod)
- [Signup Error Rate (wizard)](https://us.posthog.com/project/496946/insights/ulc0eA1Q)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
