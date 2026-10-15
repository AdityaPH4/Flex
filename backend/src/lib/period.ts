import { prisma } from "../db";
import { roundMoney } from "./money";
import { effectiveAllowance } from "./lastDay";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Returns the BenefitPeriod for the given employee + calendar month, creating
 * it on first access ("lazy" creation - no cron job needed for MVP).
 *
 * Allowance is snapshotted from the employee's current Role at creation time.
 * This means a mid-month role/allowance change takes effect from the *next*
 * period, not retroactively - deliberate, since re-writing a period the
 * employee has already partly spent from would be surprising.
 *
 * Carry-forward of unused balance is NOT implemented (per product spec: don't
 * assume carry-forward unless business rules require it). If TOIT wants it
 * later, this is the one function to change.
 */
export async function getOrCreatePeriod(
  db: Db,
  employeeId: string,
  date: Date = new Date()
) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12

  const existing = await db.benefitPeriod.findUnique({
    where: { employeeId_year_month: { employeeId, year, month } },
  });
  if (existing) return existing;

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { role: true },
  });

  // Upsert guards against a race where two requests both see "no period yet"
  // and try to create one at the same time.
  return db.benefitPeriod.upsert({
    where: { employeeId_year_month: { employeeId, year, month } },
    create: {
      employeeId,
      year,
      month,
      allowance: employee.role.monthlyAllowance,
      used: 0,
    },
    update: {},
  });
}

export interface EmployeeCurrentBalance {
  employeeId: string;
  employeeCode: string;
  name: string;
  email: string;
  phone: string | null;
  roleName: string;
  designation: string | null;
  department: string | null;
  homeOutlet: string | null;
  walletLimit: number | null;
  otpEnabled: boolean;
  grade: string | null;
  dateOfJoining: Date | null;
  walletValidFrom: Date | null;
  walletValidTo: Date | null;
  lastWorkingDay: Date | null;
  allowance: number; // already prorated when lastWorkingDay falls in this month
  used: number;
  remaining: number;
}

/**
 * Read-only view of every active employee's current-month balance, for the
 * admin dashboard. Unlike getOrCreatePeriod, this never writes to the
 * database - an employee who hasn't opened the app yet this month simply
 * shows their role's default allowance with 0 used, computed on the fly,
 * rather than a dashboard view silently creating hundreds of period rows.
 */
export async function listCurrentBalancesForActiveEmployees(
  db: Db,
  date: Date = new Date()
): Promise<EmployeeCurrentBalance[]> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const [employees, periods] = await Promise.all([
    db.employee.findMany({
      where: { active: true },
      include: { role: true, homeOutlet: true },
      orderBy: { name: "asc" },
    }),
    db.benefitPeriod.findMany({ where: { year, month } }),
  ]);

  const periodByEmployeeId = new Map(periods.map((p) => [p.employeeId, p]));

  return employees.map((employee) => {
    const period = periodByEmployeeId.get(employee.id);
    const used = Number(period?.used ?? 0);
    const allowance = effectiveAllowance(
      Number(period?.allowance ?? employee.role.monthlyAllowance),
      employee.lastWorkingDay,
      year,
      month,
      used
    );
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      roleName: employee.role.name,
      designation: employee.designation,
      department: employee.department,
      homeOutlet: employee.homeOutlet?.name ?? null,
      walletLimit: employee.walletLimit,
      otpEnabled: employee.otpEnabled,
      grade: employee.grade,
      dateOfJoining: employee.dateOfJoining,
      walletValidFrom: employee.walletValidFrom,
      walletValidTo: employee.walletValidTo,
      lastWorkingDay: employee.lastWorkingDay,
      allowance,
      used,
      remaining: Math.max(0, roundMoney(allowance - used)),
    };
  });
}
