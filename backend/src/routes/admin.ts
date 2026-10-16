import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { signAdminToken } from "../lib/jwt";
import { verifyGoogleIdToken } from "../lib/googleAuth";
import { hashPassword, verifyPassword } from "../lib/adminPassword";
import { requireAdmin } from "../middleware/adminAuth";
import { getOrCreatePeriod, listCurrentBalancesForActiveEmployees } from "../lib/period";
import { effectiveAllowance } from "../lib/lastDay";
import { roundMoney } from "../lib/money";

export const adminRouter = Router();

const loginSchema = z.object({ password: z.string().min(1).max(200) });
const googleSchema = z.object({ idToken: z.string().min(1) });
const passwordSchema = z.object({ password: z.string().min(10).max(200) });

// Login throttle: there is exactly one admin account, so the count is for the
// account, not per address - 5 wrong passwords from anyone and password
// sign-in is locked for 8 hours. Google sign-in (her email only) is the way
// back in and lifts the lock. In memory: a server restart clears it.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 8 * 60 * 60 * 1000;
const lock = { count: 0, lockedUntil: 0 };

// What the login page needs to draw the Google button.
adminRouter.get("/config", (_req, res) => {
  res.json({ googleClientId: env.googleClientId });
});

adminRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body" });
  }
  const now = Date.now();
  if (lock.lockedUntil > now) {
    return res.status(429).json({
      error: "too_many_attempts",
      retryAfterSeconds: Math.ceil((lock.lockedUntil - now) / 1000),
    });
  }
  const cred = env.adminEmail
    ? await prisma.adminCredential.findUnique({ where: { email: env.adminEmail } })
    : null;
  if (!cred) return res.status(409).json({ error: "password_not_set" });
  if (!verifyPassword(parsed.data.password, cred.passwordHash)) {
    // A lock that has run out starts a fresh count.
    const count = (lock.lockedUntil === 0 ? lock.count : 0) + 1;
    lock.count = count >= MAX_FAILED_LOGINS ? 0 : count;
    lock.lockedUntil = count >= MAX_FAILED_LOGINS ? now + LOCKOUT_MS : 0;
    return res.status(401).json({ error: "invalid_password", attemptsLeft: Math.max(0, MAX_FAILED_LOGINS - count) });
  }
  lock.count = 0;
  lock.lockedUntil = 0;
  res.json({ token: signAdminToken(), expiresInHours: env.adminSessionTtlHours });
});

// First sign-in, or a forgotten password: Google proves the person owns the
// admin email. Anyone else's Google account is refused.
adminRouter.post("/google", async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  let email: string;
  try {
    ({ email } = await verifyGoogleIdToken(parsed.data.idToken));
  } catch {
    return res.status(401).json({ error: "invalid_google_token" });
  }
  if (!env.adminEmail || email !== env.adminEmail) {
    return res.status(403).json({ error: "not_an_admin" });
  }
  lock.count = 0;
  lock.lockedUntil = 0;
  const cred = await prisma.adminCredential.findUnique({ where: { email } });
  res.json({ token: signAdminToken(), expiresInHours: env.adminSessionTtlHours, passwordSet: !!cred });
});

adminRouter.use(requireAdmin);

// Sets (or changes) her own password.
adminRouter.post("/password", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "password_too_short", minLength: 10 });
  const passwordHash = hashPassword(parsed.data.password);
  await prisma.adminCredential.upsert({
    where: { email: env.adminEmail },
    create: { email: env.adminEmail, passwordHash },
    update: { passwordHash },
  });
  res.json({ ok: true });
});

// One row per active employee with their current balance - the main table.
adminRouter.get("/employees", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  res.json({ employees: balances });
});

// Takes back whatever is left of this month's balance for someone who is
// leaving: the period's allowance is lowered to exactly what they've used, so
// remaining becomes 0. Only for an employee already marked as leaving (a last
// working day came in with the roster upload) - it can't be pointed at an ordinary employee by mistake.
// Not reversible from here (restoring is a manual top-up), by design.
adminRouter.post("/employees/:employeeCode/revoke-balance", async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { employeeCode: req.params.employeeCode } });
  if (!employee) return res.status(404).json({ error: "employee_not_found" });
  if (!employee.lastWorkingDay) return res.status(409).json({ error: "set_last_working_day_first" });

  const period = await getOrCreatePeriod(prisma, employee.id);
  const revoked = roundMoney(Math.max(0, effectiveAllowance(Number(period.allowance), employee.lastWorkingDay, period.year, period.month) - Number(period.used)));
  await prisma.benefitPeriod.update({ where: { id: period.id }, data: { allowance: period.used } });
  console.log(`[admin] revoked balance of ${revoked} for ${employee.employeeCode} (${period.year}-${period.month})`);
  res.json({ employeeCode: employee.employeeCode, revoked, remaining: 0 });
});

// Persistent "this month's roster changes" - unlike the joiners/leavers echoed
// back from a single /employees/import call (which only reflect that one
// upload and only exist in the browser tab that ran it), this is derived
// straight from the Employee table so it survives a page reload and shows up
// even if nobody in the current session ran the import themselves. Joiners =
// created this calendar month (the only way an Employee row is created is
// via import, so this is exactly "new wallet_no first seen this month").
// Leavers = currently inactive whose record was last touched this calendar
// month (the only thing that ever sets active:false is the import's
// roster-diff, so this is exactly "present last import, absent from the most
// recent one, this month").
adminRouter.get("/employees/roster-changes", async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // If nothing in the table predates this month, there's no genuine "last
  // month's roster" to compare against - every employee only looks like a
  // joiner because the table itself is new (e.g. it was cleared and fully
  // reimported), not because they actually joined this month. In that case,
  // report no changes at all rather than a misleading "everyone is new".
  const hasPriorData = await prisma.employee.findFirst({
    where: { createdAt: { lt: monthStart } },
    select: { id: true },
  });
  if (!hasPriorData) {
    return res.json({ joiners: [], leavers: [] });
  }

  const [joiners, leavers] = await Promise.all([
    prisma.employee.findMany({
      where: { createdAt: { gte: monthStart } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.employee.findMany({
      where: { active: false, updatedAt: { gte: monthStart } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  res.json({
    joiners: joiners.map((e) => ({ employeeCode: e.employeeCode, name: e.name })),
    leavers: leavers.map((e) => ({ employeeCode: e.employeeCode, name: e.name })),
  });
});

// Tries a few common spreadsheet date formats before giving up - dates here
// are informational only (see schema.prisma comment on the wallet_* fields),
// so a row is never rejected just because a date didn't parse.
function parseFlexibleDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // DD-MMM-YYYY or DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[-/]([A-Za-z]{3,9}|\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const monthNum = /^\d+$/.test(m) ? Number(m) - 1 : new Date(`${m} 1, 2000`).getMonth();
    const date = new Date(Number(y), monthNum, Number(d));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

// Last working day: a calendar day, stored as that date at 00:00 UTC (@db.Date).
// parseFlexibleDate builds local-time dates, so read its year/month/day back out.
function parseDay(raw: string): Date | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return d.toISOString().startsWith(raw) ? d : null;
  }
  const d = parseFlexibleDate(raw);
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
}

function parseFlexibleBoolean(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "y"].includes(raw.trim().toLowerCase());
}

// CSV export of every active employee, in the exact same column shape as
// /employees/import expects - the starting template an admin edits (e.g.
// just the `amount` column for whoever's allowance changed) and re-uploads
// next month. Mirrors the wallet system's own "Register Master-Wallet"
// upload format so HR never has to maintain two different file shapes.
adminRouter.get("/employees/export", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  res.json({
    employees: balances.map((b) => ({
      wallet_no: b.employeeCode,
      ref_no: b.designation ?? b.roleName,
      amount: b.allowance,
      limit: b.walletLimit ?? "",
      customer_name: b.name,
      phone_number: b.phone ?? "",
      email_id: b.email,
      enable_otp: b.otpEnabled ? "1" : "0",
      valid_from: b.walletValidFrom ? b.walletValidFrom.toISOString().slice(0, 10) : "",
      valid_to: b.walletValidTo ? b.walletValidTo.toISOString().slice(0, 10) : "",
      Grade: b.grade ?? "",
      DOJ: b.dateOfJoining ? b.dateOfJoining.toISOString().slice(0, 10) : "",
      "Cost Center": b.homeOutlet ?? "",
      LWD: b.lastWorkingDay ? b.lastWorkingDay.toISOString().slice(0, 10) : "",
    })),
  });
});

// Every column is required, no exceptions - an explicit decision (see
// CLAUDE.md) that the import is all-or-nothing: a file missing any field on
// any row is rejected in full, rather than silently applying a partial
// month's data. See the pre-validation pass in the route handler below.
const importRowSchema = z.object({
  wallet_no: z.string().trim().min(1),
  customer_name: z.string().trim().min(1),
  email_id: z.string().trim().email(),
  ref_no: z.string().trim().min(1),
  amount: z.coerce.number().positive().multipleOf(0.01),
  phone_number: z.string().trim().min(1),
  "Cost Center": z.string().trim().min(1),
  // Not z.coerce.number() alone - an empty cell would coerce to Number("") = 0,
  // which passes .nonnegative() silently instead of being caught as missing.
  // Preprocess (not .pipe(z.string()...)) so this still accepts a real
  // number too - re-importing this endpoint's own /export output sends
  // limit as an actual number, not a string.
  limit: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : val),
    z.coerce.number().int().nonnegative()
  ),
  enable_otp: z.string().trim().min(1),
  valid_from: z.string().trim().min(1),
  valid_to: z.string().trim().min(1),
  Grade: z.string().trim().min(1),
  DOJ: z.string().trim().min(1),
  // The one optional column: last working day, empty for everyone who isn't
  // leaving. Column absent from the file = leave what is stored alone; column
  // present = the file is the truth (an empty cell clears it).
  LWD: z
    .string()
    .trim()
    .refine((v) => v === "" || parseDay(v) !== null, "must be a date, e.g. 08-Oct-2026")
    .optional(),
});

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
});

// Monthly bulk import, matching the wallet system's own "Register
// Master-Wallet" upload format exactly (see schema.prisma's wallet_* fields
// for the full mapping). Creates or updates employees by wallet_no
// (= employeeCode) and sets each one's CURRENT month's allowance. Never
// touches `used` on an existing period - only ever the allowance figure.
// Role and Outlet are found-or-created by name (ref_no / Cost Center) rather
// than rejected when unmatched - this file is the source of truth for those
// names, not our seed data.
//
// All-or-nothing: every column is required on every row (see
// importRowSchema), and the whole file is validated BEFORE any database
// write happens. If even one row is missing one field, nothing is imported -
// the admin gets back exactly which row(s)/field(s) are missing so they can
// fix the file and re-upload, rather than the system silently applying a
// partial month's data.
adminRouter.post("/employees/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const validationIssues: { row: number; wallet_no: string | null; field: string; message: string }[] = [];
  const validatedRows: z.infer<typeof importRowSchema>[] = [];
  parsed.data.rows.forEach((raw, index) => {
    const row = importRowSchema.safeParse(raw);
    if (!row.success) {
      const walletNo = typeof raw.wallet_no === "string" && raw.wallet_no.trim() ? raw.wallet_no.trim() : null;
      for (const issue of row.error.issues) {
        validationIssues.push({
          row: index + 1, // 1-indexed data row, matching how the admin counts rows in their spreadsheet (header excluded)
          wallet_no: walletNo,
          field: String(issue.path[0] ?? "(unknown)"),
          message: issue.message,
        });
      }
    } else {
      validatedRows.push(row.data);
    }
  });

  if (validationIssues.length > 0) {
    return res.status(400).json({
      error: "missing_required_fields",
      message: "Can't upload - some rows are missing required fields. Fix the file and re-upload.",
      issues: validationIssues,
    });
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // HR re-uploads the ENTIRE roster every time (confirmed, not a delta) - so
  // "who was active before this import" doubles as "last month's roster",
  // and anyone missing from this upload has left. Snapshotted before any
  // writes below.
  const previouslyActive = await prisma.employee.findMany({ where: { active: true } });
  const uploadedCodes = new Set(validatedRows.map((r) => r.wallet_no));

  // Fetched once and matched case-insensitively - the wallet upload's ref_no/
  // Cost Center casing can vary between rows/months for what's meant to be
  // the same role or outlet ("Crew" vs "CREW"), and an exact-match upsert
  // would silently create a duplicate for every casing variant.
  const [existingRoles, existingOutlets] = await Promise.all([prisma.role.findMany(), prisma.outlet.findMany()]);
  const roleByName = new Map(existingRoles.map((r) => [r.name.toLowerCase(), r]));
  const outletByName = new Map(existingOutlets.map((o) => [o.name.toLowerCase(), o]));

  // Every result row echoes back the full set of import columns (not just
  // wallet_no/status/error) so the dashboard can show exactly what was - or
  // would have been - saved, without a separate lookup.
  type ImportResultRow = {
    wallet_no: string;
    ref_no: string | null;
    amount: number | null;
    limit: number | null;
    customer_name: string | null;
    phone_number: string | null;
    email_id: string | null;
    enable_otp: boolean | null;
    valid_from: string | null;
    valid_to: string | null;
    Grade: string | null;
    DOJ: string | null;
    "Cost Center": string | null;
    LWD: string | null;
    status: "created" | "updated" | "error";
    error?: string;
  };
  const results: ImportResultRow[] = [];

  for (const data of validatedRows) {
    const costCenter = data["Cost Center"];

    try {
      let role = roleByName.get(data.ref_no.toLowerCase());
      if (!role) {
        role = await prisma.role.create({ data: { name: data.ref_no, monthlyAllowance: data.amount } });
        roleByName.set(data.ref_no.toLowerCase(), role);
      }

      let outletId: string | null = null;
      if (costCenter) {
        let outlet = outletByName.get(costCenter.toLowerCase());
        if (!outlet) {
          outlet = await prisma.outlet.create({ data: { name: costCenter } });
          outletByName.set(costCenter.toLowerCase(), outlet);
        }
        outletId = outlet.id;
      }

      const existing = await prisma.employee.findUnique({ where: { employeeCode: data.wallet_no } });
      const employeeFields = {
        name: data.customer_name,
        email: data.email_id.toLowerCase(),
        phone: data.phone_number || null,
        designation: data.ref_no,
        roleId: role.id,
        homeOutletId: outletId,
        walletLimit: data.limit ?? null,
        otpEnabled: parseFlexibleBoolean(data.enable_otp),
        grade: data.Grade || null,
        dateOfJoining: parseFlexibleDate(data.DOJ),
        walletValidFrom: parseFlexibleDate(data.valid_from),
        walletValidTo: parseFlexibleDate(data.valid_to),
        ...(data.LWD !== undefined ? { lastWorkingDay: data.LWD ? parseDay(data.LWD) : null } : {}),
        // Being present in ANY upload means active, full stop - this is what
        // lets a previously-deactivated employee (a false-positive leaver, or
        // someone who genuinely rejoined) come back to life simply by
        // reappearing in the next roster upload, rather than staying stuck
        // inactive forever once marked as a leaver.
        active: true,
      };
      const employee = await prisma.employee.upsert({
        where: { employeeCode: data.wallet_no },
        create: { employeeCode: data.wallet_no, ...employeeFields },
        update: employeeFields,
      });

      await prisma.benefitPeriod.upsert({
        where: { employeeId_year_month: { employeeId: employee.id, year, month } },
        create: { employeeId: employee.id, year, month, allowance: data.amount, used: 0 },
        update: { allowance: data.amount },
      });

      results.push({
        wallet_no: data.wallet_no,
        ref_no: data.ref_no,
        amount: data.amount,
        limit: data.limit ?? null,
        customer_name: data.customer_name,
        phone_number: data.phone_number || null,
        email_id: data.email_id.toLowerCase(),
        enable_otp: parseFlexibleBoolean(data.enable_otp),
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        Grade: data.Grade || null,
        DOJ: data.DOJ || null,
        "Cost Center": costCenter || null,
        LWD: data.LWD || null,
        status: existing ? "updated" : "created",
      });
    } catch {
      results.push({
        wallet_no: data.wallet_no,
        ref_no: data.ref_no,
        amount: data.amount,
        limit: data.limit ?? null,
        customer_name: data.customer_name,
        phone_number: data.phone_number || null,
        email_id: data.email_id,
        enable_otp: parseFlexibleBoolean(data.enable_otp),
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        Grade: data.Grade || null,
        DOJ: data.DOJ || null,
        "Cost Center": costCenter || null,
        LWD: data.LWD || null,
        status: "error",
        error: "Could not save this row.",
      });
    }
  }

  // Anyone active before this import but absent from it entirely has left -
  // deactivate them (this is what already gates login, see requireAuth) and
  // call it out explicitly rather than silently dropping them off the table.
  const leaverEmployees = previouslyActive.filter((e) => !uploadedCodes.has(e.employeeCode));
  if (leaverEmployees.length > 0) {
    await prisma.employee.updateMany({
      where: { id: { in: leaverEmployees.map((e) => e.id) } },
      data: { active: false },
    });
  }
  const leavers = leaverEmployees.map((e) => ({ employeeCode: e.employeeCode, name: e.name }));

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  res.json({ results, summary, leavers });
});

// The Digitory reconciliation codes, newest first - lets an admin cross-
// reference "who does this code in Digitory's export belong to?" without
// needing direct database access.
adminRouter.get("/reconciliation-codes", async (req, res) => {
  const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().uuid().optional(),
  });
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const { limit, cursor } = parsed.data;

  const rows = await prisma.reconciliationCode.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    codes: page.map((c) => ({
      id: c.id,
      code: c.code,
      employeeName: c.employeeName,
      employeeCode: c.employeeCode,
      context: c.context,
      createdAt: c.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

/*
 * SUPERSEDED - kept for reference, not deleted (may come back).
 *
 * This matched an uploaded export against our own 6-digit ReconciliationCode
 * table. The real wallet ledger export has no code column at all - it
 * identifies employees by Wallet #, so reconciliation below now matches on
 * that instead. The in-app "read this code to the cashier" flow (see
 * routes/me.ts, ReconciliationCode model) is untouched by this - only the
 * admin-side matching mechanism changed.
 *
 * const reconcileSchema = z.object({
 *   rows: z
 *     .array(
 *       z.object({
 *         code: z.string().min(1),
 *         amount: z.number().optional(),
 *         date: z.string().optional(),
 *         outlet: z.string().optional(),
 *       })
 *     )
 *     .min(1)
 *     .max(5000),
 * });
 *
 * adminRouter.post("/reconcile", async (req, res) => {
 *   const parsed = reconcileSchema.safeParse(req.body);
 *   if (!parsed.success) {
 *     return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
 *   }
 *   const normalize = (code) => code.trim().padStart(6, "0");
 *   const rows = parsed.data.rows.map((r) => ({ ...r, code: normalize(r.code) }));
 *   const found = await prisma.reconciliationCode.findMany({
 *     where: { code: { in: rows.map((r) => r.code) } },
 *   });
 *   const foundByCode = new Map(found.map((f) => [f.code, f]));
 *   const results = rows.map((row) => {
 *     const match = foundByCode.get(row.code);
 *     return {
 *       code: row.code,
 *       amount: row.amount ?? null,
 *       date: row.date ?? null,
 *       outlet: row.outlet ?? null,
 *       matched: Boolean(match),
 *       employeeName: match?.employeeName ?? null,
 *       employeeCode: match?.employeeCode ?? null,
 *       generatedAt: match?.createdAt ?? null,
 *     };
 *   });
 *   const matchedCount = results.filter((r) => r.matched).length;
 *   res.json({
 *     results,
 *     summary: { total: results.length, matched: matchedCount, unmatched: results.length - matchedCount },
 *   });
 * });
 */

/*
 * SUPERSEDED - kept for reference, not deleted (may come back).
 *
 * This matched an uploaded wallet-ledger export by employeeCode (= Wallet #),
 * which was itself a stand-in for code-based matching adopted only because
 * the real ledger sample we had at the time carried no OTP column. Digitory's
 * ledger export is now expected to carry an OTP column (the same code
 * generated in routes/me.ts's "read this code to the cashier" flow), so
 * matching goes back to that code - see the active handler below.
 *
 * const ledgerRowSchema = z.object({
 *   walletNo: z.string().trim().min(1),
 *   event: z.string().optional(),
 *   transactionId: z.string().optional(),
 *   paymentName: z.string().optional(),
 *   amount: z.number().optional(),
 *   balance: z.number().optional(),
 *   dateTime: z.string().optional(),
 *   user: z.string().optional(),
 *   status: z.string().optional(),
 * });
 *
 * const reconcileSchema = z.object({
 *   rows: z.array(ledgerRowSchema).min(1).max(5000),
 * });
 *
 * adminRouter.post("/reconcile", async (req, res) => {
 *   const parsed = reconcileSchema.safeParse(req.body);
 *   if (!parsed.success) {
 *     return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
 *   }
 *   const rows = parsed.data.rows;
 *   const employees = await prisma.employee.findMany({
 *     where: { employeeCode: { in: rows.map((r) => r.walletNo) } },
 *   });
 *   const employeeByCode = new Map(employees.map((e) => [e.employeeCode, e]));
 *   const results = rows.map((row) => {
 *     const employee = employeeByCode.get(row.walletNo);
 *     return {
 *       walletNo: row.walletNo,
 *       matched: Boolean(employee),
 *       employeeName: employee?.name ?? null,
 *       employeeCode: employee?.employeeCode ?? null,
 *     };
 *   });
 *   const matchedCount = results.filter((r) => r.matched).length;
 *   res.json({ results, summary: { total: results.length, matched: matchedCount, unmatched: results.length - matchedCount } });
 * });
 */

const ledgerRowSchema = z.object({
  billNo: z.string().trim().min(1),
  walletNo: z.string().trim().optional(),
  event: z.string().optional(),
  transactionId: z.string().optional(),
  paymentName: z.string().optional(),
  amount: z.number().nullable().optional(),
  balance: z.number().optional(),
  dateTime: z.string().optional(),
  user: z.string().optional(),
  status: z.string().optional(),
});

const reconcileSchema = z.object({
  rows: z.array(ledgerRowSchema).min(1).max(5000),
});

// Matches an admin-uploaded Digitory ledger export against our payments by
// BILL NUMBER (every payment carries the bill number the employee entered).
// Several employees can pay one bill, so the amounts are summed: all the
// ledger rows for one bill + wallet are compared with what that employee paid
// on that bill in our system (the allowance part - cash never reaches
// Digitory's wallet ledger). A ledger row with no wallet number is compared
// with the whole bill. Anything that doesn't square - bill not found, wallet
// didn't pay it here, amounts differ, bill number used at two outlets - goes
// to the unreconciled bucket with a specific reason, never silently dropped.
//
// A bill number is only trusted within the calendar month of the ledger row's
// own Date Time (numbers get reused over time, and reconciliation usually
// happens after the month ended). A row whose date doesn't parse is compared
// only if its bill number appears in a single month.
const normBill = (raw: string) => raw.trim().toLowerCase().replace(/^0+(?=\d)/, "");
const IST_MONTH_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const monthKeyIST = (d: Date) => {
  const shifted = new Date(d.getTime() + IST_MONTH_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
};

adminRouter.post("/reconcile", async (req, res) => {
  const parsed = reconcileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const rows = parsed.data.rows;

  const rowPeriods = rows.map((row) => {
    const d = parseFlexibleDate(row.dateTime);
    // The ledger's date is wall-clock text; parseFlexibleDate reads it back in
    // local time, so local getters return the month as written.
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
  });

  // Matched on the normalised number in memory (stored bill numbers are as the
  // employee typed them), narrowed in the query by the plain forms.
  const bills = [...new Set(rows.map((r) => normBill(r.billNo)))];
  const ours = (
    await prisma.benefitTransaction.findMany({
      where: { status: "confirmed", billNo: { not: null } },
      include: { employee: { select: { name: true, employeeCode: true } } },
    })
  ).filter((t) => bills.includes(normBill(t.billNo!)));

  // Ledger rows for the same bill + wallet are one payment split over several
  // rows; their amounts add up before they are compared.
  const groupKey = (i: number) => `${normBill(rows[i].billNo)}|${rowPeriods[i] ?? ""}|${rows[i].walletNo ?? ""}`;
  const ledgerSum = new Map<string, number>();
  rows.forEach((r, i) => ledgerSum.set(groupKey(i), (ledgerSum.get(groupKey(i)) ?? 0) + (r.amount ?? 0)));

  const results = rows.map((row, i) => {
    const period = rowPeriods[i];
    let candidates = ours.filter((t) => normBill(t.billNo!) === normBill(row.billNo));
    if (period) candidates = candidates.filter((t) => monthKeyIST(t.createdAt) === period);

    let reason: string | null = null;
    let mine: typeof candidates = [];
    if (candidates.length === 0) {
      reason = period ? "Bill number not found in our system for that month." : "Bill number not found in our system.";
    } else {
      // Each outlet numbers its own bills, so the same number can exist at two
      // outlets. The wallet number (when the ledger has one) tells them apart;
      // without it the row is flagged rather than guessed.
      mine = row.walletNo ? candidates.filter((t) => t.employee.employeeCode === row.walletNo) : candidates;
      if (row.walletNo && mine.length === 0) {
        reason = `Bill found, but wallet ${row.walletNo} did not pay it in our system.`;
      } else if (new Set(mine.map((t) => t.outletName)).size > 1) {
        reason = "This bill number was used at more than one outlet - can't tell which one the ledger means.";
      } else if (!period && new Set(mine.map((t) => monthKeyIST(t.createdAt))).size > 1) {
        reason = "Ambiguous bill number - the ledger row's date didn't parse and this number appears in more than one month.";
      }
    }

    const ourAmount = mine.length ? roundMoney(mine.reduce((n, t) => n + Number(t.amount), 0)) : null;
    let reconciled = false;
    if (!reason && ourAmount != null) {
      if (row.amount == null) {
        reason = "Ledger row has no amount to compare.";
      } else {
        const ledgerTotal = ledgerSum.get(groupKey(i))!;
        if (Math.round(ledgerTotal * 100) !== Math.round(ourAmount * 100)) {
          reason = `Amount mismatch: ledger ₹${roundMoney(ledgerTotal)} vs our system ₹${ourAmount}.`;
        } else {
          reconciled = true;
        }
      }
    }

    // Whose payment this is, when it is one person's (a whole-bill row can be several).
    const onePayer = mine.length > 0 && new Set(mine.map((t) => t.employeeId)).size === 1;

    return {
      billNo: row.billNo.trim(),
      walletNo: row.walletNo ?? null,
      event: row.event ?? null,
      amount: row.amount ?? null,
      balance: row.balance ?? null,
      dateTime: row.dateTime ?? null,
      user: row.user ?? null,
      status: row.status ?? null,
      reconciled,
      reason,
      employeeName: onePayer ? mine[0].employee.name : null,
      employeeCode: onePayer ? mine[0].employee.employeeCode : null,
      ourAmount,
    };
  });

  const reconciled = results.filter((r) => r.reconciled);
  const unreconciled = results.filter((r) => !r.reconciled);
  res.json({
    reconciled,
    unreconciled,
    summary: { total: results.length, reconciled: reconciled.length, unreconciled: unreconciled.length },
  });
});
