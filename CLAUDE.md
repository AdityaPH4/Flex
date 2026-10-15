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
- `backend/public/cashier/` — the till-side **cashier screen**, same approach
  (static page at `/cashier`, API in `backend/src/routes/cashier.ts`). It
  shows each BILL as one card (every employee who paid part of that bill, the
  bill total, any cash to collect) so the cashier can check the amounts. Two
  tabs: a 2x2 "Live payments" board that keeps each bill for 10 minutes, and
  "All Transactions" (today, IST day, searchable by name/employee code/bill
  no). Read-only: Digitory is still updated by hand. Shared `CASHIER_PASSWORD` login, like the admin dashboard. The outlet
  list it offers (`backend/src/lib/outlets.ts`) must stay in sync with
  `OUTLETS` in `mobile/app/record-benefit.tsx`.

## Non-obvious decisions — don't relitigate these without asking the person first

1. **Payments are keyed by BILL NUMBER; there is no reference code any more
   (branch `bill-no-workflow`).** An explicit, later decision superseding the
   earlier 6-digit-code flow: the employee enters outlet + amount + a
   **mandatory bill number**, confirms, done - nothing is generated or read
   aloud. Our backend never calls Digitory and Digitory never calls us;
   Digitory processes the payment independently. Several employees can pay one
   bill (each from their own allowance): the cashier screen shows ONE card per
   (outlet, bill number) with the bill's total and every payer, and
   `POST /admin/reconcile` (`backend/src/routes/admin.ts`) matches an uploaded
   Digitory ledger against our payments by bill number within the month of
   each ledger row's date - ledger rows for one bill + wallet are summed and
   squared off against what that employee paid on that bill (allowance part
   only); bill not found / wallet didn't pay it / amount mismatch / bill number
   at two outlets are flagged with a specific reason. The ledger's bill-number
   column name is guessed (`BILL_CANDIDATES` in `backend/public/admin/app.js`)
   until Digitory's real export confirms it. The `ReconciliationCode` table,
   its admin list endpoint and any old codes are left in place (history), but
   nothing creates codes. Don't reintroduce the code flow without asking.

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
   Digitory's own "OTP" wallet flag (`enable_otp` in the roster) is unrelated
   to login. Don't conflate them.

3. **Balance enforcement is a single atomic SQL UPDATE**, not
   read-then-write. See `backend/src/lib/spend.ts`. This is intentional and
   handles concurrent requests correctly - don't refactor it into separate
   check/update steps. (It now reads `used + amount <= LEAST(allowance, cap)`:
   `cap` is the prorated allowance of an employee with a last working day,
   see `backend/src/lib/lastDay.ts` - still one statement.)

   **Last working day** (`Employee.lastWorkingDay`, nullable) comes in through
   the roster import's optional `LWD` column (empty = not leaving; column
   absent from a file = stored values left alone; present = the file wins,
   an empty cell clears it). The Employees table only displays it: in the month of that date only
   `day/30` of the allowance is usable (flat 30, capped at 100%), spending
   works through the end of that day (IST) and is refused after it. "Revoke
   balance" (admin, only for someone with a last working day set) lowers the
   month's allowance to what was used.

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
   `BILL_CANDIDATES` in `backend/public/admin/app.js`) because the
   person has never gotten Digitory's actual export format confirmed. If
   they get real documentation from Digitory, update the candidate lists
   rather than assuming the column names are fixed.

## Do not touch without being asked

- Don't merge this project into a workspace with the person's other,
  unrelated projects (they have a separate "Oven Ops" bakery-production app
  and a "CRM_clone" - different codebases, different concerns, keep this
  repo standalone).
- Don't change the visual design language without discussing it first - but
  note it **has already changed once**, at the person's explicit request
  (they didn't like the original dark theme and gave a reference screenshot
  to redesign around). Current mobile theme (`mobile/src/theme/tokens.ts`):
  warm light background `#F7F4EF`, white/pastel cards with soft shadows
  (no more hairline borders), generous border radius (`radii.lg`=28,
  `xl`=32), two accent families - brand gold (`colors.gold` `#D4A24C`
  unchanged, paired with pastel `goldSoft`/readable `goldText`) and a new
  warm sage green (`sageSoft`/`sageText`) for cards that need to read as
  distinct from the gold "hero" card. Space Grotesk + Inter fonts are
  unchanged. The tab bar also gained a floating center "+" button (opens
  Record Benefit) - see `(tabs)/_layout.tsx`'s `record-action` screen.
  The **admin dashboard was NOT updated** to match (`backend/public/admin/`
  still uses the old dark/gold look) - that's a deliberate scope cut for this
  pass, not an oversight; revisit it if/when asked.

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
- **The app now runs against AWS RDS, not the local Docker Postgres.**
  `backend/.env`'s `DATABASE_URL` points at `toit-production-db` (an RDS
  instance in `ap-south-1`), database `toit_production`, inside a dedicated
  **`toit_benefits` schema** (`?schema=toit_benefits` on the connection
  string) - that database is shared with the person's other projects
  (bakery/Oven Ops tables live in its `public` schema, a reconciliation app
  in a `recon` schema, etc.), so this app gets its own schema namespace to
  stay isolated per the "keep this repo standalone" note above, without
  needing a separate database. The local Docker Postgres (port 5433,
  `postgres`/`postgres`, see `docker-compose.yml`) still exists and still
  has the same data, but is no longer what the app points at day to day -
  it was kept only as a fallback, not actively used. **The RDS instance's
  security group only allows a short allow-list of IPs on port 5432** - if
  `psql`/the app suddenly can't reach it, that's the first thing to check
  (`aws ec2 describe-security-groups --group-ids sg-0ef43d20c18b3507b`),
  not the DB itself; home ISPs reassign public IPs periodically, so this is
  the most likely thing to go stale over time.
- **The checked-in `prisma/migrations/` history had drifted from the actual
  schema** (found while first deploying to RDS, since that was the first
  time it had ever been replayed from empty onto a truly fresh database -
  the Docker one had been patched ad hoc over time and never hit this).
  Two migrations were corrected: `ReconciliationCode`'s original
  `CREATE TABLE` was missing entirely (added into
  `20260923110548_reconciliation_code_transaction_link`, the migration that
  first assumed the table already existed), and a new
  `20260928090924_drop_redemption_token` migration was added to drop the
  stale `RedemptionToken` table/column that had been removed by hand but
  never captured as a migration. Verified by replaying the full history
  onto an empty scratch database and diffing the result against both the
  Docker dev database and `schema.prisma` until all three matched exactly -
  worth redoing that check
  (`prisma migrate diff --from-url <replayed> --to-url <live> --script`)
  before trusting `migrate deploy` on a new environment again.
- If you (Claude Code) don't have network access to `binaries.prisma.sh`,
  `prisma generate` will fail with a checksum/403 error - this is a sandbox
  limitation Claude previously hit repeatedly, not a real problem. On the
  person's actual Mac this resolves fine with normal internet access.
- Seeded test employee: Rahul Sharma, employeeCode `9001` — `seed.ts` ships
  with a placeholder Gmail (`replace-with-your-real-gmail@gmail.com`) that
  must be edited to a real Gmail address before seeding, since that's what's
  used to sign in (see item 2 above).
- **`employeeCode` = the wallet system's `wallet_no`, not an invented code.**
  The admin dashboard's Import/Export still match the real external
  wallet/POS system's own file formats (`data/Register Master-Wallet.xlsx`
  for the monthly HR upload) - see `backend/src/routes/admin.ts`.
  **Reconcile is by bill number (see item 1).** The older code-based and
  wallet-number-by-`Ledgers-7.csv` versions are commented out in `admin.ts` or
  in git history, not live - don't revive them as the primary mechanism
  without asking.
- **Import is all-or-nothing - every column is required on every row, no
  exceptions.** An explicit decision (superseding an earlier one where only
  `email_id` was required and other columns were optional/nullable). The
  whole file is validated upfront in `POST /employees/import`
  (`backend/src/routes/admin.ts`) before any database write happens - if
  even one row is missing one field, nothing is imported and the admin gets
  back exactly which row(s)/field(s) are missing (`error:
  "missing_required_fields"`, with an `issues` array), rendered as a
  toast-style banner in `backend/public/admin/app.js`
  (`formatMissingFieldsError`). Don't relax this back to per-row
  create-what-you-can leniency without asking first.
