# TOIT Employee Benefits

A from-scratch employee benefits app: employees sign in with Google, see their
monthly benefit allowance and remaining balance (calculated by the backend,
never the client), and record a payment by entering the **bill number** (and
amount) from the bill they paid at an outlet. The app then shows a 6-digit OTP
to hand the cashier, who types it into Digitory (TOIT's POS). Digitory handles
the actual payment; the bill number is what later ties a Digitory transaction
back to the employees who paid it.

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
- **A payment is keyed by its bill number, and still gets an OTP.** An
  employee enters the outlet, amount and a **mandatory bill number**, confirms,
  and the payment is recorded against the bill number. The app then generates
  a 6-digit OTP for it (`POST /api/me/benefits/reconciliation-code`, unique
  within the calendar month - see `periodKey` on `ReconciliationCode`) and
  shows it; the cashier types it into Digitory. Our backend never calls
  Digitory (nor Digitory us) and nothing verifies the code in real time -
  Digitory processes the payment itself. Several employees can pay the same
  bill, each from their own allowance (a table splitting one bill): each is a
  separate payment, with its own OTP, sharing one bill number.
- **The cashier screen shows one card per bill.** A screen at the till
  (`/cashier`, see "Cashier screen" below) shows each bill as soon as someone
  pays (part of) it: the bill number, the bill's total across everyone who
  paid, each payer's share and OTP, and any cash to collect. When a second or
  third person pays the same bill, the same card updates (and an OTP that
  arrives a moment after its payment fills in on the same card). It keeps each
  bill on its live board for 10 minutes and has an "All Transactions" tab for
  the rest of the day. It is read-only - it changes nothing and verifies
  nothing; Digitory is still updated by hand.
- **Reconciling later is automated, by bill number.** `POST
  /api/admin/reconcile` matches an admin-uploaded Digitory ledger export
  against our payments by bill number (within the month of each ledger row's
  own date). Ledger rows for one bill + wallet are added up and compared with
  what that employee paid on that bill (the allowance part - cash never
  reaches the wallet ledger); a row without a wallet number is compared with
  the whole bill. Bill not found, a wallet that didn't pay it, an amount
  mismatch, or a bill number used at two outlets (each outlet numbers its own
  bills; the wallet number normally tells them apart) is flagged into an
  "unreconciled" bucket with a specific reason. The real ledger sample on
  hand (`data/Ledgers-7.csv`) predates this and has no bill-number column -
  the column name is guessed from candidates (`BILL_CANDIDATES` in
  `backend/public/admin/app.js`) until a real sample confirms it.
- **Balance enforcement (for the separate "Record Benefit" self-entry flow)
  still happens in one atomic SQL statement.** See `backend/src/lib/spend.ts`
  - the update `used = used + amount WHERE used + amount <= allowance` either
  succeeds atomically or fails with zero rows changed. This is unrelated to
  the bill-number flow above; it's what runs when an employee records a spend
  in the app (a leaving employee's cap is prorated, see `lib/lastDay.ts`).
- **Offline identity cache is minimal on purpose.** The phone caches only
  `{ name, employeeCode }` in the OS Keychain/Keystore (via `expo-secure-store`),
  written only right after a successful authenticated `/api/me` call - never
  from anything the user can type. Balance and transactions are never cached;
  they're fetched fresh every time and the app shows an explicit "offline"
  state if it can't reach the server.

## Known MVP simplifications (worth revisiting before real production use)

- **Digitory's real ledger export hasn't been seen with a bill-number
  column.** `POST /api/admin/reconcile` does automated bill-number matching
  (see "How the Digitory hand-off flow works" above), but it's only been
  verified against hand-built test data - the actual column name and format
  should be confirmed against a real export.
- **Bill numbers are only as unique as the outlet's numbering.** Two outlets
  can both have a bill 1001 in a month; the wallet number in the ledger row
  disambiguates, otherwise the row is flagged, not guessed. Nothing stops two
  employees (or one, twice) from entering the same bill number - that is the
  split-bill case - so a typo'd bill number simply won't reconcile.
- **The OTP has no real expiry enforcement.** `expiresAt` on
  `ReconciliationCode` is informational only; nothing rejects a code after
  that time, since nothing verifies the code at all.
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

## Cashier screen

A screen meant to stay open on a tablet at the till. When an employee pays
(part of) a bill, the screen shows one card for that **bill number**: the bill's
**total**, each payer's **name, ID, share and OTP**, the **outlet**, and how
much **cash to collect** (if anyone's share was split). When more employees pay
the same bill, the same card updates with the new total and payer. The cashier
checks the amounts against the bill and types the OTPs into Digitory.

**URL:** `https://<server>/cashier/` (served by the backend, same as `/admin`).

**Login:** the shared password in `CASHIER_PASSWORD` (`backend/.env`). Leaving
it unset keeps the screen locked (login answers 503). Changing it signs every
till out - the token carries a fingerprint of the password. Sessions last
`CASHIER_SESSION_TTL_DAYS` (default 14). Ten wrong passwords from one address
lock that address out for five minutes.

**Which payments it shows:** after logging in the cashier picks the outlet
(the list lives in `backend/src/lib/outlets.ts` and must match `OUTLETS` in
`mobile/app/record-benefit.tsx`) or "All outlets"; only payments recorded for
that outlet appear, on both tabs below.

**Two tabs** (the control sits just before "Sign out"):

- **Live payments** - a board of **bills** that always fills the screen: 2x2
  for up to 4 bills, then 3x2 (5-6), 3x3 (7-9) and 4x3 (10-12), so nothing
  scrolls until there are more than 12. One bill number at one outlet is one card, however
  many employees paid it, each payer listed with their own OTP (a long list
  scrolls inside the card). A bill stays for **10 minutes** from its latest
  payment and then drops off by itself; "Got it" clears a card sooner (and it
  comes back if someone else then pays that bill). The length is
  `LIVE_WINDOW_MS` in `backend/src/routes/cashier.ts` (the screen reads it
  from the `windowSeconds` field of the feed). The screen asks
  `GET /api/cashier/payments` once a second (each poll covers the last minute;
  a bill that gets a new payer comes back whole, and the screen replaces its
  card). The tab shows a count of what is on the board.
- **All Transactions** - every payment recorded today, newest first
  (`GET /api/cashier/transactions`). "Today" is the **IST calendar day**
  (midnight to midnight India time - the server runs on UTC, see
  `backend/src/lib/istDay.ts`). One row per employee payment, with its OTP
  (or "No code"). A search box filters by employee **name, employee code or
  bill number**; several words
  must all match (`rahul 9001`). Voided payments are left out. It refreshes by itself every 15 seconds and as
  soon as a new payment arrives, and a banner says so if payments are waiting
  on the live board while the cashier browses.

**On the device:** it beeps on a new payment (browsers only allow sound after
a tap - a banner says so after a reload), keeps the screen awake, shows
"Reconnecting..." and recovers by itself if the connection drops, and
remembers which cards were cleared ("Got it" is stored on that device only,
not on the server). After a reload the board still shows everything from the
last 10 minutes that wasn't cleared; it just doesn't beep again for payments
older than two minutes.

Source: `backend/src/routes/cashier.ts` (API) and `backend/public/cashier/`
(plain HTML/CSS/JS, no build step).

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/google/verify` | - | Verify a Google ID token, get a session token (login) |
| POST | `/auth/logout` | employee | Revoke the current session |
| GET | `/api/me` | employee | Own profile |
| GET | `/api/me/benefits/current` | employee | Current month allowance/used/remaining |
| GET | `/api/me/benefits/transactions` | employee | Paginated transaction history |
| POST | `/api/me/benefits/transactions` | employee | Self-record a benefit spend (balance-enforced) |
| POST | `/api/admin/login` | - | Admin login (shared password) |
| GET | `/api/admin/overview` | admin | Aggregate stats across all employees |
| GET | `/api/admin/employees` | admin | Every active employee's current balance (allowance already prorated for someone leaving this month) |
| POST | `/api/admin/employees/:employeeCode/revoke-balance` | admin | Take back this month's remaining balance of an employee who has an LWD (last working day) from the roster upload |
| GET | `/api/admin/transactions` | admin | Every benefit transaction, paginated |
| GET | `/api/admin/reconciliation-codes` | admin | Every OTP generated, paginated |
| POST | `/api/me/benefits/reconciliation-code` | employee | Generate the 6-digit OTP for a recorded payment |
| POST | `/api/admin/reconcile` | admin | Upload a Digitory ledger export, match by bill number, square off amounts |
| POST | `/api/cashier/login` | - | Cashier screen login (shared password) |
| GET | `/api/cashier/outlets` | cashier | The outlets a till can be set to |
| GET | `/api/cashier/payments` | cashier | Bills paid in the last 10 minutes, one entry per bill with all its payers - the live board (`outlet`, `since`, `limit`) |
| GET | `/api/cashier/transactions` | cashier | Every confirmed payment since midnight IST, newest first (`outlet`) |

"employee" auth = `Authorization: Bearer <employee session token>`.
"admin" auth = `Authorization: Bearer <admin token>` (from `/api/admin/login`) -
a completely separate token type; an employee's session token is never
accepted on admin routes and vice versa. "cashier" auth is a third, separate
token type (from `/api/cashier/login`): it works only on `/api/cashier/*`, and
neither an employee nor an admin token is accepted there.

Note: Digitory calls its own reconciliation field "OTP" too, but
`/api/me/benefits/reconciliation-code` is unrelated to login - it's only a
reference number for Digitory and proves nothing on its own. Login goes
through `/auth/google/verify`.
# Flex
