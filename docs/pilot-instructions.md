# promo-kit Pilot — Setup Instructions

Thanks for testing `@mcptoolshop/promo-kit`. This should take under 10 minutes.

## Requirements

- Node.js 22 or later (`node --version` to check)

## Steps

```bash
# 1. Create a fresh directory
mkdir promo-kit-pilot && cd promo-kit-pilot
npm init -y

# 2. Install
npm i @mcptoolshop/promo-kit

# 3. Initialize (creates config + 17 seed files)
npx promo-kit init

# 4. Edit kit.config.json — change these four fields:
#    org.name        → your org name
#    org.account     → your GitHub account/org
#    site.title      → whatever you want
#    contact.email   → your email

# 5. Validate
npx promo-kit selftest
```

If selftest prints all green checks, you're done.

## What to report

We only need three things:

1. **First point of confusion** — where did you stop and think "wait, what?"
2. **First error** — paste the full terminal output
3. **What you expected instead** — one sentence

Send these to the issue tracker or directly to the maintainer. That's it.

## Useful commands

```bash
npx promo-kit --version        # confirm installed version
npx promo-kit --print-config   # see resolved config
npx promo-kit --help           # full usage
```

## Troubleshooting

**"kit.config.json not found"** — make sure you ran `npx promo-kit init` first, or that you're in the directory containing `kit.config.json`.

**Node version error** — promo-kit requires Node 22+. Run `node --version` to check.

**selftest failures** — read the error message carefully; it usually names the file and suggests a fix. If stuck, paste the full output in your report.
