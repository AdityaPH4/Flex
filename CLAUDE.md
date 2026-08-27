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

2. **Login is Google Sign-In, not phone/OTP.** The original phone + SMS OTP
   login (`/auth/otp/*`) was replaced with Google Sign-In
   (`POST /auth/google/verify`) to avoid per-SMS cost and India's TRAI/DLT
   registration requirement — an explicit decision by the person building
   this, made because the rollout is Android-only (every Android phone
   already needs a Google account for Play Store). `Employee.email` (unique)
   is now the login identifier; `Employee.phone` still exists but is
   optional, HR-contact-info only, and is never used to authenticate. There
   is **no dev bypass** for Google Sign-In the way console-printed OTPs
   worked — testing requires seeding a real Gmail address in `seed.ts` that
   whoever is testing can actually sign in with. See
   `backend/src/lib/googleAuth.ts` and `backend/src/routes/auth.ts`.
   The Digitory reconciliation code (item 1 above) is unrelated to any of
   this — Digitory calls its own field "OTP" too, which is a naming
   coincidence, not a shared mechanism. Don't conflate them.

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
- They're on a Mac, testing the mobile app on a physical Android phone.
  Originally via plain Expo Go; since Google Sign-In needs a native module
  Expo Go can't load, they now need a one-time **Expo dev-client build**
  (`eas build --profile development --platform android`, install the
  resulting `.apk`, then `npx expo start --dev-client`) — after that initial
  install, JS changes still hot-reload the same way Expo Go did.
- Their local Postgres runs via Docker on **port 5433, not 5432** (moved
  deliberately to avoid colliding with a native Postgres already on their
  machine) with credentials `postgres`/`postgres` (see `docker-compose.yml`
  and `.env`, not the `toit`/`toit` in `.env.example` - those drifted during
  troubleshooting and the real running instance uses `postgres`/`postgres`).
- If you (Claude Code) don't have network access to `binaries.prisma.sh`,
  `prisma generate` will fail with a checksum/403 error - this is a sandbox
  limitation Claude previously hit repeatedly, not a real problem. On the
  person's actual Mac this resolves fine with normal internet access.
- Seeded test employee: Rahul Sharma, EMP00123 — `seed.ts` ships with a
  placeholder Gmail (`replace-with-your-real-gmail@gmail.com`) that must be
  edited to a real Gmail address before seeding, since that's what's used to
  sign in (see item 2 above).
