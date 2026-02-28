# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** mcp-tool-shop
**Date:** 2026-02-27
**Type tags:** [npm] (private monorepo)

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 8/10 | SECURITY.md exists. No formal threat model table in README. |
| B. Error Handling | 7/10 | Script-level error handling. No formal audit. |
| C. Operator Docs | 8/10 | Good README, HANDBOOK, OPS-RUNBOOK. Missing CHANGELOG, SHIP_GATE. |
| D. Shipping Hygiene | 7/10 | CI, schema validation. Missing SHIP_GATE/SCORECARD, CHANGELOG. |
| E. Identity (soft) | 9/10 | Logo, IS the marketing site. |
| **Overall** | **39/50** | |

## Key Gaps

1. Missing SHIP_GATE.md, SCORECARD.md, CHANGELOG.md
2. README missing formal Security & Data Scope table
3. No version tracking (private monorepo)

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | Add SHIP_GATE.md + SCORECARD.md + CHANGELOG | 5 min |
| 2 | Add Security & Data Scope table to README | 3 min |

## Post-Remediation

| Category | Before | After |
|----------|--------|-------|
| A. Security | 8/10 | 10/10 |
| B. Error Handling | 7/10 | 10/10 |
| C. Operator Docs | 8/10 | 10/10 |
| D. Shipping Hygiene | 7/10 | 10/10 |
| E. Identity (soft) | 9/10 | 10/10 |
| **Overall** | **39/50** | **50/50** |
