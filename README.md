# Weave Engineering Impact Dashboard

A one-page, evidence-backed view of the five engineers creating the most sustained impact in the PostHog repository over the 91 days from 2026-06-05 through 2026-09-03.

## Approach

Raw activity is a poor proxy for impact, so the analysis groups related merged PRs by engineer, product area, and week into **impact arcs**. Each arc contributes—with diminishing returns—to four independently percentile-ranked dimensions:

- **Product outcomes (25%)**: shipped or improved customer capability.
- **Risk retired (20%)**: security, reliability, recovery, data integrity, and billing correctness.
- **Team leverage (15%)**: performance, tooling, tests, docs, build, and delivery systems.
- **Sustained ownership (15%)**: returning to the same product area across multiple weeks, with a smaller breadth signal.
- **Code durability (25%)**: current nonblank production lines last touched in the window, weighted by age and grouped into monthly product episodes with square-root diminishing returns.

The durability analysis uses a deterministic sample of production files changed during the window. Tests, generated code, migrations, fixtures, and vendor code are excluded. The dashboard exposes the sample size and each leader's surviving-line share, median line age, and episode count.

The model intentionally excludes lines changed, raw commit ranking, bots, dependency churn, and unmerged work. Public Git history cannot reliably expose mentorship, review quality, incident leadership, or invisible coordination; the UI names that limitation.

## Data coverage

The committed snapshot was generated from a blobless clone of `PostHog/posthog` and covers the complete Git history for the stated window: 14,482 commits scanned, 13,190 human-authored merged PR references classified, and 146 engineers compared. The reproducible script is in `scripts/analyze.mjs`.

```bash
git clone --filter=blob:none --no-checkout --shallow-since='2026-06-05T00:00:00Z' https://github.com/PostHog/posthog.git /tmp/posthog-90d
npm run analyze -- /tmp/posthog-90d ./src/data/impact.json
```

## Local development

```bash
npm install
npm run dev
```

## Cloudflare / OpenNext

This follows the same small deployment shape as the Transient gateway: Next.js, `@opennextjs/cloudflare`, `.open-next/worker.js`, and static assets served through the Worker asset binding.

```bash
npm run build:cf
npm run deploy
```
