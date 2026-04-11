# Weekly Spotlight Readiness Checklist

Run every Monday before publishing the spotlight. All **A + C** must be green, no accidental freezes, and at least one proof link ready.

---

## A) Site is promotable (public-facing path works)

- [ ] Homepage shows the week's featured content (or "this week" section is non-empty)
- [ ] Promo week page exists and loads: `/promo/<week>`
- [ ] Promo week page includes:
  - [ ] "Verify this week" box visible
  - [ ] Input hash table renders (not empty)
  - [ ] Copy Verification Bundle works
  - [ ] Copy Verify Command works
- [ ] Trust Center exists and is current: `/trust/`
- [ ] Trust Center includes clickable canonical path: Presskit → Trust → Receipts → Promo → Verify
- [ ] Receipts index exists and lists recent receipts: `/receipts/`
- [ ] Trust receipt file is present and recent: `site/public/trust.json`
- [ ] Trust receipt is sane:
  - [ ] Includes commit SHA (or clear "commit unavailable" warning)
  - [ ] Includes SHA-256 hashes for all expected artifacts
  - [ ] `provenClaims` count is non-zero (when applicable)

## B) Automation is ready (and not accidentally frozen)

- [ ] `governance.json` is valid and `schemaVersion` matches expected
- [ ] Freeze modes are correct for this week:
  - [ ] `decisionsFrozen` is `false` (unless intentionally frozen)
  - [ ] `experimentsFrozen` is `false` (unless intentionally frozen)
- [ ] Drift generation runs clean (or last run artifact is present):
  - [ ] `decision-drift.json` exists and schema-valid
- [ ] Recommendation pipeline is healthy:
  - [ ] `recommendations.json` exists (even if empty)
  - [ ] `recommendation-patch.json` exists (even if empty)
- [ ] Weekly PR automation is armed:
  - [ ] Scheduled workflow exists
  - [ ] Last run succeeded or has an understandable failure

## C) promo-kit npm package is "complete" (presentation + trust)

- [ ] npm shows latest version (expected): `@mcptoolshop/promo-kit@X.Y.Z`
- [ ] npm README renders correctly:
  - [ ] Logo image displays (raw GitHub URL)
  - [ ] Badges display (npm version, GitHub release, MIT)
  - [ ] Tables render (no broken markdown)
- [ ] README links work (absolute URLs, not relative):
  - [ ] Portable Core docs link
  - [ ] Quickstart doc link
  - [ ] Presskit Handbook link
  - [ ] Trust Center link
- [ ] Package metadata is complete:
  - [ ] License is MIT
  - [ ] `repository`, `bugs`, `homepage` correct
  - [ ] `engines.node >= 22` present
- [ ] Tarball contents are clean (no junk):
  - [ ] No tests/fixtures/screenshots/.git
  - [ ] README + LICENSE included
- [ ] "Golden path" works from npm install:
  - [ ] `npx promo-kit init` succeeds in an empty folder
  - [ ] `npx promo-kit selftest` passes

## D) Proof artifacts exist for this week's spotlight post (no-vibes rule)

- [ ] One public PR link exists for the weekly run (or latest relevant run)
- [ ] One trust receipt link exists (file path or hosted URL)
- [ ] One example outputs folder exists and is linkable (drift/recs/receipt)
- [ ] Planned post(s) include at least one proof link each (PR or trust.json)

## E) Images & media (site + repo hygiene)

- [ ] Repo root has `logo.png` committed
- [ ] Any screenshot paths referenced by overrides/pages exist
- [ ] OpenGraph images render (at least default):
  - [ ] `/trust/` preview looks sane
  - [ ] `/promo/<week>` preview looks sane
  - [ ] `/tools/<slug>` preview looks sane (for at least one tool)
- [ ] No broken images on key pages (homepage, trust, promo week)

---

## Final Go/No-Go

1. All **A + C** are green (site path + npm package completeness)
2. No intentional freeze is accidentally enabled
3. You have at least one proof link ready to paste into a post

**If all three are true: Go publish the spotlight this week.**
