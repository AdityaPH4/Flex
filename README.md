# TOIT Employee Benefits

A from-scratch employee benefits app: employees authenticate with phone + OTP,
see their monthly benefit allowance and remaining balance (calculated by the
backend, never the client), record benefit usage, and can generate a short
numeric reference code to hand the cashier at checkout, who types it into
Digitory (TOIT's POS). Digitory handles the actual payment; our code exists
so TOIT can later match a Digitory transaction back to the employee who made it.

```
   iOS App (Expo)
        |
   Android App (Expo)
        |
        v
   Express API  (Node + TypeScript)
        |
        v
   PostgreSQL  (via Prisma)
```

## What's here

```
toit-benefits/
  backend/     Node + Express + TypeScript + Prisma + PostgreSQL
  mobile/      Expo (React Native) + TypeScript + Expo Router
```

---

## 1. Run the backend

**Requirements:** Node 20+, Docker (for Postgres - or point at any Postgres you already have).

```bash
cd backend
cp .env.example .env
# Open .env and set JWT_SECRET to a real random value:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste that into JWT_SECRET

docker compose up -d --wait    # starts Postgres on :5433, waits until healthy
npm install                    # also runs `prisma generate` via postinstall
npx prisma migrate dev --name init   # creates the tables
npm run seed                   # sample roles, outlets, and 2 employees
npm run dev                     # starts the API on :4000
```

You should see `TOIT benefits API listening on :4000`.

**Sanity check:** `curl http://localhost:4000/health` → `{"ok":true}`

**If `docker compose up` or the migrate step complains about access being
denied:** you likely already have a different Postgres running on your
machine (Homebrew, Postgres.app, a previous project). Run `lsof -i :5433` -
it should show only Docker's process. If something else shows up there too,
pick a different port in both `docker-compose.yml` and `.env`'s
`DATABASE_URL` and keep them in sync.

The seed script creates employee `9001` / Rahul Sharma. Before running
`npm run seed`, edit `backend/src/seed.ts` and replace the placeholder email
addresses with real Gmail addresses you (and anyone else testing) can
actually sign in with - Google Sign-In has no dev bypass, so whatever email
is seeded is what you log in with on the phone.

You'll also need a Google OAuth **Web application** client ID before login
will work - see "Google Sign-In setup" below - and set it as
`GOOGLE_CLIENT_ID` in `backend/.env`.

---

## 2. Run the mobile app

**Requirements:** Node 20+, an [EAS](https://expo.dev) account (free), and
your phone on the same Wi-Fi as your computer.

Login uses Google Sign-In, which needs a native module - plain Expo Go can't
load it, so you need a one-time **development build** instead. See "Google
Sign-In setup" below for the Google Cloud Console steps first, then:

```bash
cd mobile
cp .env.example .env
# Edit EXPO_PUBLIC_API_URL - see the comments in .env.example for which
# value to use (localhost, 10.0.2.2, or your laptop's LAN IP)
# Edit EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID - same value as the backend's
# GOOGLE_CLIENT_ID (see "Google Sign-In setup" below)

npm install
npm install -g eas-cli
eas login
eas build --profile development --platform android   # one-time, ~10-15 min
```

Once the build finishes, install the resulting `.apk` on your phone (EAS
gives you a QR code / link to download it directly - no Play Store needed).
From then on, run:

```bash
npx expo start --dev-client
```

and open the installed app - it hot-reloads on JS changes exactly like Expo
Go did. You only need to repeat the `eas build` step if you change native
dependencies (e.g. the Google Sign-In plugin config), not for everyday code
changes.

**To log in:** tap "Sign in with Google" and choose the Google account that
matches the email you seeded in `backend/src/seed.ts`.

### If it can't reach the backend
This is almost always the `EXPO_PUBLIC_API_URL` value - your phone is a
different device from your laptop, so `localhost` from your phone's
perspective means "the phone itself", not your laptop. Use your laptop's LAN
IP (e.g. `http://192.168.1.42:4000`), and make sure your phone and laptop are
on the same network with no client-isolation/guest-network restrictions.

## Google Sign-In setup

Both the backend and mobile app need a Google OAuth **Web application**
client ID (the same one, used server-side as the ID-token audience and
client-side as `webClientId`) plus an **Android** client ID registered
against this app so Google will actually issue tokens to it:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in
   an app name (e.g. "TOIT Employee Benefits") and your support email. Leave
   publishing status as **Testing** and add every pilot employee's Gmail
   address under "Test users" - this avoids Google's app-verification review
   process, which is fine for a small pilot (same tradeoff as the shared
   admin password below).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   twice:
   - **Web application** - no redirect URI needed. Copy this Client ID into
     `GOOGLE_CLIENT_ID` (`backend/.env`) and
     `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (`mobile/.env`) - same value in both.
   - **Android** - package name `com.toit.benefits`, and a SHA-1 certificate
     fingerprint. Get the fingerprint for your EAS-managed development build
     with `cd mobile && eas credentials` (choose Android → the development
     profile → View/manage credentials).

---

## 3. Getting to an actual installable app (App Store / Play Store)

Section 2 above already has you building and installing a **development**
build via EAS (needed for Google Sign-In's native module). Publishing to the
stores uses the same **EAS Build** service, just with the production profile
instead of `--profile development`:

```bash
npm install -g eas-cli
eas login                      # free Expo account
cd mobile
eas build:configure
eas build --platform android   # produces a real, installable .apk/.aab
eas build --platform ios       # produces a real .ipa
```

Requirements EAS Build will ask you for:
- **Android:** nothing extra to get a `.apk` you can sideload. A Google Play
  Console account (**$25 one-time**) is only needed if you want to publish to
  the Play Store.
- **iOS:** an **Apple Developer Program** membership (**$99/year**) - Apple
  requires this for any device installation, sideloaded or not. `eas build`
  will walk you through generating certificates; you don't need a Mac.

Once built, `eas submit` can push straight to TestFlight / the Play Store's
internal testing track, which is the easiest way to actually get this on
people's phones without physically connecting devices.

If you do have a Mac with Xcode / Android Studio installed, `npx expo run:ios`
or `npx expo run:android` builds and installs a dev client locally without
needing EAS at all.

---

## How the Digitory hand-off flow works

- **Login proves identity, not the employee code.** The app authenticates via
  Google Sign-In: the mobile app gets a Google ID token, the backend verifies
  it and looks up the employee by the verified email (`backend/src/lib/googleAuth.ts`).
  After that, every API request carries a session token; the backend derives
  *who's asking* from that token. There is no field anywhere in the API where
  the client sends an employee ID or code as proof of identity -
  `req.body.employeeId` is never trusted, only `req.auth.employeeId` from the
  verified token (see `backend/src/middleware/auth.ts`). This part has
  nothing to do with Digitory.
- **The reference code is bookkeeping at the checkout moment, not a security
  mechanism.** Tapping "Get Code" on the Benefits screen asks the backend to
  generate a short 6-digit code (unique within the calendar month it was
  issued in, not globally - see `periodKey` on `ReconciliationCode`) and
  store it against the employee's ID and name, with a timestamp. The
  employee reads it aloud, the cashier types it into Digitory, and
  **Digitory processes the actual payment from there** - our backend never
  calls Digitory and Digitory never calls us, and nothing verifies or
  consumes the code in real time at the point of sale.
- **Reconciling later IS automated, once Digitory's ledger carries this
  code.** `POST /api/admin/reconcile` matches an admin-uploaded Digitory
  ledger export against the `ReconciliationCode` table by code (scoped to
  the month each ledger row's own date falls in) and "squares off" the
  amount against the linked `BenefitTransaction` - a row is only reconciled
  if both the code matches AND the amount agrees; a mismatch, an unlinked
  code, or a code that isn't found at all is flagged into an "unreconciled"
  bucket with a specific reason instead. The admin dashboard's Reconcile
  page shows both as separate tabs. The real ledger sample on hand
  (`data/Ledgers-7.csv`) doesn't have this code column yet - the column
  name is guessed from candidates (`OTP_CANDIDATES` in
  `backend/public/admin/app.js`) until a real sample confirms it. See the
  comment on the `ReconciliationCode` model for the full reasoning.
- **Balance enforcement (for the separate "Record Benefit" self-entry flow)
  still happens in one atomic SQL statement.** See `backend/src/lib/spend.ts`
  - the update `used = used + amount WHERE used + amount <= allowance` either
  succeeds atomically or fails with zero rows changed. This is unrelated to
  the reference-code flow above; it's what runs when an employee manually
  records a spend in the app, and it's untouched by the Digitory hand-off work.
- **Offline identity cache is minimal on purpose.** The phone caches only
  `{ name, employeeCode }` in the OS Keychain/Keystore (via `expo-secure-store`),
  written only right after a successful authenticated `/api/me` call - never
  from anything the user can type. Balance and transactions are never cached;
  they're fetched fresh every time and the app shows an explicit "offline"
  state if it can't reach the server.

## Known MVP simplifications (worth revisiting before real production use)

- **Digitory's real ledger export doesn't have the code column yet.**
  `POST /api/admin/reconcile` already does automated code+amount matching
  (see "How the Digitory hand-off flow works" above), but it's only been
  verified against hand-built test data - the actual column name and
  format should be confirmed against a real export once Digitory adds it.
- **The reference code has no real expiry enforcement.** `expiresAt` on
  `ReconciliationCode` is informational only (drives what the app displays);
  nothing rejects a code after that time, since nothing verifies the code at
  all. If Digitory later exposes a real API contract, this is one of the
  first things worth tightening.
- **No self-serve account linking.** An employee's Google account must match
  the `email` HR/admin set on their record ahead of time - there's no flow
  for an employee to register their own email, by design (internal,
  admin-provisioned system, same model as the old phone-based login).
- **Employee provisioning is manual/seed-only.** There's no admin UI yet to
  add employees, set roles/allowances, or upload photos - that's a natural V2
  (even a simple internal script or a thin admin panel).
- **Monthly carry-forward is not implemented**, per the product spec's
  instruction not to assume it. If TOIT wants unused benefit to roll over,
  that's a single function to change: `backend/src/lib/period.ts`.
- **Record Benefit always uses "now" as the date/time** rather than letting
  the employee pick a past date/time - kept the dependency list smaller for
  v1; adding a date-time picker (`@react-native-community/datetimepicker`) is
  a small, contained addition to `mobile/app/record-benefit.tsx`.
- **No push notifications or analytics** - deliberately out of scope per
  the V1 spec. (There is now a basic admin dashboard - see below - but it's
  view-only: no employee/role management UI yet, still Prisma Studio for that.)
- **Admin dashboard auth is a single shared password**, not per-admin
  accounts (see `ADMIN_PASSWORD` in `.env`). Fine for one or two admins on a
  pilot; move to real accounts if more people need access or you want an
  audit trail of who looked at what.

## Admin dashboard

A small, view-only web dashboard for looking at benefit usage across *all*
employees - separate from the employee-facing mobile app, and reachable from
any browser (phone or desktop) since it's just a web page served by the same
backend, no extra deploy or app install needed.

**URL:** `http://<wherever-the-backend-is-reachable>:4000/admin`
(e.g. `http://localhost:4000/admin` if you're on the same machine as the
backend, or `http://<your-LAN-IP>:4000/admin` from another device on the
same network - same reachability rules as the mobile app's `EXPO_PUBLIC_API_URL`.)

**Login:** whatever you set `ADMIN_PASSWORD` to in `backend/.env`. Sessions
last `ADMIN_SESSION_TTL_HOURS` (default 12) before needing to sign in again.

**What it shows:**
- Overview cards: active employee count, and total allowance/used/remaining
  across everyone for the current month
- **Employees** tab: every active employee's current balance in one table
- **Transactions** tab: every self-recorded benefit spend, across all
  employees, newest first
- **Reconciliation Codes** tab: every Digitory reference code generated,
  with which employee it belongs to - this is the table you'd use to match
  a line in Digitory's own export back to a person

Source: `backend/src/routes/admin.ts` (API) and `backend/public/admin/`
(the actual page - plain HTML/CSS/JS, no build step, no framework).

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/google/verify` | - | Verify a Google ID token, get a session token (login) |
| POST | `/auth/logout` | employee | Revoke the current session |
| GET | `/api/me` | employee | Own profile |
| GET | `/api/me/benefits/current` | employee | Current month allowance/used/remaining |
| GET | `/api/me/benefits/transactions` | employee | Paginated transaction history |
| POST | `/api/me/benefits/transactions` | employee | Self-record a benefit spend (balance-enforced) |
| POST | `/api/me/benefits/reconciliation-code` | employee | Generate a numeric reference code for Digitory |
| POST | `/api/admin/login` | - | Admin login (shared password) |
| GET | `/api/admin/overview` | admin | Aggregate stats across all employees |
| GET | `/api/admin/employees` | admin | Every active employee's current balance |
| GET | `/api/admin/transactions` | admin | Every benefit transaction, paginated |
| GET | `/api/admin/reconciliation-codes` | admin | Every Digitory reference code, paginated |
| POST | `/api/admin/reconcile` | admin | Upload a Digitory ledger export, match by code, square off amounts |

"employee" auth = `Authorization: Bearer <employee session token>`.
"admin" auth = `Authorization: Bearer <admin token>` (from `/api/admin/login`) -
a completely separate token type; an employee's session token is never
accepted on admin routes and vice versa.

Note: Digitory calls its own reconciliation field "OTP" too, but
`/api/me/benefits/reconciliation-code` is unrelated to login - it's only a
reference number for Digitory and proves nothing on its own. Login now goes
through `/auth/google/verify` instead.
# Flex
