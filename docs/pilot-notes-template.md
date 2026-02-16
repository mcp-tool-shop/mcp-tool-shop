# Pilot Notes — [Org Name]

**Date**: YYYY-MM-DD
**Pilot type**: friendly dev / cold-ish dev
**promo-kit version**: 0.1.x

## Setup

```bash
mkdir promo-kit-pilot && cd promo-kit-pilot
npm init -y
npm i @mcptoolshop/promo-kit

npx promo-kit init
# edit kit.config.json (org.name, org.account, site.title, contact.email)
npx promo-kit selftest
```

## Time to green

- `npm i` → `selftest pass`: _____ minutes

## First point of confusion

> (What did they stop and ask about?)

## First error

```
(paste full output)
```

**Expected instead**: ...

## Config fields misunderstood

| Field | What they thought | What it actually means |
|-------|-------------------|----------------------|
| | | |

## Docs fixes shipped

| File | Change | PR/Commit |
|------|--------|-----------|
| | | |

## Outcome

- [ ] Completed without editing their repo
- [ ] Required a docs fix (patch release)
- [ ] Required a code fix (patch release)
- [ ] Blocked — could not complete

## Notes

(Anything else worth recording)
