# OPS Runbook

> Operational guide for running and monitoring the NameOps + promotion pipeline.

---

## Weekly Schedule

| Day | Event | Trigger |
|-----|-------|---------|
| Tuesday 06:00 UTC | NameOps clearance run | `nameops-scheduled.yml` cron |
| Tuesday–Thursday | Review NameOps PR | Manual |
| Thursday | Clearance freshness refresh | `clearance-weekly.yml` cron |
| Friday | Merge approved PRs | Manual |

Both workflows can be triggered manually via `workflow_dispatch` in GitHub Actions.

---

## Running Manually

### Via GitHub UI

1. Go to **Actions** tab in the marketing repo
2. Select **NameOps scheduled clearance**
3. Click **Run workflow** on the `main` branch

### Via CLI

```bash
gh workflow run nameops-scheduled.yml --repo mcp-tool-shop/mcp-tool-shop
```

---

## Reading the /lab/ops/ Dashboard

The dashboard at `/lab/ops/` shows:

- **Summary banner**: Total runs, average duration, average cache hit rate
- **Recent runs table**: Last 7 runs with date, duration, slugs, cache rate, errors, status
- **Adapter breakdown**: Aggregated API calls per namespace (npm, pypi, docker, etc.)
- **Error codes**: Histogram of error types across recent runs
- **CI minutes trend**: Per-run CI time consumption

Data source: `site/src/data/ops-history.json` (rolling log, max 30 entries)

---

## RED Name Handling

When a name gets RED tier:

1. **Do not claim** the name on any registry
2. Review the collision cards to understand the conflict
3. Consider alternatives:
   - Add a prefix/suffix (`mcpt-<name>`, `<name>-cli`)
   - Choose a different name entirely
4. Remove the name from `data/names.txt` in the nameops repo
5. See: nameops `docs/operational-playbook.md` for full RED handling

---

## Pausing Promotion

Edit `site/src/data/promo.json`:

```json
{
  "enabled": false,
  ...
}
```

When `enabled: false`, the scheduler still runs NameOps (clearance checks continue) but skips the promotion generation step (`gen-promo.mjs`).

---

## Safety Caps Configuration

Edit `site/src/data/promo.json`:

```json
{
  "caps": {
    "maxNamesPerRun": 50,
    "failMode": "fail-closed"
  }
}
```

| Cap | Effect |
|-----|--------|
| `maxNamesPerRun` | Hard limit passed to nameops `--max-names` flag. Max 500. |
| `failMode: fail-closed` | Any batch error or publish error stops the run before PR creation |
| `failMode: fail-open` | Partial results are published even if some names fail |

---

## Promotion Queue Usage

Edit `site/src/data/promo-queue.json`:

```json
{
  "week": "2026-02-17",
  "slugs": [
    { "slug": "zip-meta-map", "channels": ["presskit", "snippets"], "reason": "launch week" }
  ],
  "promotionType": "own",
  "notes": "Focus on launch materials"
}
```

| Field | Values | Effect |
|-------|--------|--------|
| `promotionType` | `own` | Generates for any queued slug with publicProof |
| `promotionType` | `ecosystem` | Validates slugs against `worthy.json` before generation |
| `channels` | `presskit`, `snippets`, `campaigns` | Which generators to run per slug |

Clear the `slugs` array after a promotion cycle to prevent re-running.

---

## Worthy Repos Rubric

Edit `site/src/data/worthy.json`:

```json
{
  "rubric": {
    "criteria": [
      "License is OSI-approved",
      "At least 1 release published",
      "README has install + usage",
      "Activity within last 90 days",
      "No known security issues"
    ],
    "minimumScore": 3
  },
  "repos": {
    "slug-name": {
      "worthy": true,
      "score": 4,
      "assessedDate": "2026-02-16",
      "reason": "Full docs, active dev, OSS license"
    }
  }
}
```

Used by:
- `gen-targets.mjs --worthy-only` — filters target discovery to worthy repos only
- `gen-promo.mjs` — ecosystem gate skips non-worthy slugs when `promotionType: "ecosystem"`

---

## Error Codes Reference

| Code | Meaning | Fix |
|------|---------|-----|
| `RATE_LIMIT` | Registry API throttled | Increase `maxAgeHours` in nameops profile to use cached results |
| `TIMEOUT` | Adapter timed out | Reduce `concurrency` or increase timeout in profile |
| `NETWORK` | DNS/connection failure | Retry; check if registry is down |
| `PARSE` | Invalid response from registry | Usually transient; file COE issue if persistent |
| `UNKNOWN` | Unclassified error | Check full error message in batch results |

---

## Data Files Quick Reference

| File | Owner | Purpose |
|------|-------|---------|
| `site/src/data/ops-history.json` | Generated | Rolling ops log (max 30 entries) |
| `site/src/data/promo.json` | Human-curated | Promotion switch + safety caps |
| `site/src/data/promo-queue.json` | Human-curated | Weekly promotion queue |
| `site/src/data/worthy.json` | Human-curated | Repo worthiness rubric |
| `site/src/data/overrides.json` | Human-curated | Tool metadata + featured flags |
