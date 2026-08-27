# TOIT Employee Benefits — project context

This file is read automatically at the start of every Claude Code session in
this repo. It captures decisions and context from the conversation where this
project was originally built (in Claude's chat interface, not here), so you
don't have to re-derive or accidentally reverse them.

**Read `README.md` first** — it's the primary source of truth for setup,
architecture, the API reference, and known MVP simplifications. This file
adds context that isn't written down there: the *why* behind some choices,
and things to be careful not to break.

## What this is

- `backend/` — Node/Express/TypeScript/Prisma/PostgreSQL API
- `mobile/` — Expo (React Native/TypeScript) employee-facing wallet app
- `backend/public/admin/` — a small static HTML/CSS/JS admin dashboard
  (no build step, no framework) served directly by the same Express server
  at `/admin`

## Non-obvious decisions — don't relitigate these without asking the person first

1. **The Digitory reference code is deliberately NOT a verification/auth
   mechanism.** It's a 6-digit code we generate and store against an
   employee, purely so it can be manually cross-referenced later against
   Digitory's own transaction export. Our backend never calls Digitory,
   Digitory never calls us, and we never validate/consume the code. This was
   an explicit, repeated instruction from the person building this — don't
   "improve" this into a real-time verification flow (e.g. don't build an
   endpoint that checks/consumes the code) without them asking for it.
   See `ReconciliationCode` model comment in `schema.prisma` and the
   "How the Digitory hand-off flow works" section of `README.md`.

2. **There are two unrelated OTPs.** The login OTP (`/auth/otp/*`)
   authenticates the employee into the app. The reconciliation code
   (confusingly also sometimes called "OTP" by the person in conversation,
   since that's what Digitory calls its own field) is the thing above. Don't
   conflate them.

3. **Balance enforcement is a single atomic SQL UPDATE**, not
   read-then-write. See `backend/src/lib/spend.ts`. This is intentional and
   handles concurrent requests correctly - don't refactor it into separate
   check/update steps.

4. **The admin dashboard uses one shared password**, not per-admin accounts
   (`ADMIN_PASSWORD` env var). Known, accepted MVP tradeoff for a 1-2-admin
   pilot - flagged in the README, not an oversight.

5. **Employee session tokens last 30 days.** Deliberately long - reasoning
   discussed with the person was that a stolen token's blast radius is low
   (can only act as that one employee, within their own balance, and a human
   cashier still has to accept the code at checkout). Configurable via
   `SESSION_TTL_DAYS` if they want it shorter.

6. **Monthly benefit periods do NOT carry over unused balance** - this was
   an explicit product requirement, not a bug. See `backend/src/lib/period.ts`.

7. **The reconciliation CSV import guesses Digitory's column names** (see
   `CODE_CANDIDATES` etc. in `backend/public/admin/app.js`) because the
   person has never gotten Digitory's actual export format confirmed. If
   they get real documentation from Digitory, update the candidate lists
   rather than assuming the column names are fixed.

## Do not touch without being asked

- Don't merge this project into a workspace with the person's other,
  unrelated projects (they have a separate "Oven Ops" bakery-production app
  and a "CRM_clone" - different codebases, different concerns, keep this
  repo standalone).
- Don't change the visual design language (dark background `#111010`, warm
  gold accent `#d4a24c`, Space Grotesk + Inter fonts on mobile) without
  discussing it - this was a deliberate choice to avoid the generic
  dark+neon-green "crypto wallet" look, and it's shared across the mobile
  app and admin dashboard for brand consistency.

## Working with this person - practical notes

- They're following along via terminal copy-paste, not writing code
  themselves. When you give them commands to run, give complete, exact,
  copy-pasteable commands - don't assume familiarity with flags or shortcuts.
- They're on a Mac, testing the mobile app on a physical Android phone via
  Expo Go (not a simulator).
- Their local Postgres runs via Docker on **port 5433, not 5432** (moved
  deliberately to avoid colliding with a native Postgres already on their
  machine) with credentials `postgres`/`postgres` (see `docker-compose.yml`
  and `.env`, not the `toit`/`toit` in `.env.example` - those drifted during
  troubleshooting and the real running instance uses `postgres`/`postgres`).
- If you (Claude Code) don't have network access to `binaries.prisma.sh`,
  `prisma generate` will fail with a checksum/403 error - this is a sandbox
  limitation Claude previously hit repeatedly, not a real problem. On the
  person's actual Mac this resolves fine with normal internet access.
- Seeded test employee for login: phone `+919900000123` (Rahul Sharma,
  EMP00123). In dev, OTP codes print to the backend's console instead of
  sending real SMS (`SMS_PROVIDER=console`).
