import { prisma } from "./db";

async function main() {
  const crew = await prisma.role.upsert({
    where: { name: "Crew" },
    create: { name: "Crew", monthlyAllowance: 1500 },
    update: { monthlyAllowance: 1500 },
  });
  const shiftLead = await prisma.role.upsert({
    where: { name: "Shift Lead" },
    create: { name: "Shift Lead", monthlyAllowance: 2000 },
    update: { monthlyAllowance: 2000 },
  });
  const manager = await prisma.role.upsert({
    where: { name: "Manager" },
    create: { name: "Manager", monthlyAllowance: 3000 },
    update: { monthlyAllowance: 3000 },
  });

  const indiranagar = await prisma.outlet.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "TOIT Indiranagar",
      address: "100 Ft Rd, Indiranagar, Bengaluru",
    },
    update: {},
  });
  const koramangala = await prisma.outlet.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "TOIT Koramangala",
      address: "5th Block, Koramangala, Bengaluru",
    },
    update: {},
  });

  const rahul = await prisma.employee.upsert({
    where: { employeeCode: "EMP00123" },
    create: {
      employeeCode: "EMP00123",
      name: "Rahul Sharma",
      phone: "+919900000123",
      designation: "Shift Lead",
      department: "Operations",
      roleId: shiftLead.id,
      homeOutletId: indiranagar.id,
    },
    update: {},
  });

  await prisma.employee.upsert({
    where: { employeeCode: "EMP00991" },
    create: {
      employeeCode: "EMP00991",
      name: "Anita Rao",
      phone: "+919900000991",
      designation: "Manager",
      department: "Operations",
      roleId: manager.id,
      homeOutletId: koramangala.id,
    },
    update: {},
  });

  // A couple of sample transactions for Rahul so the app has something to show.
  const now = new Date();
  const period = await prisma.benefitPeriod.upsert({
    where: {
      employeeId_year_month: {
        employeeId: rahul.id,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      },
    },
    create: {
      employeeId: rahul.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      allowance: shiftLead.monthlyAllowance,
      used: 650,
    },
    update: { used: 650 },
  });

  await prisma.benefitTransaction.upsert({
    where: { idempotencyKey: "seed-txn-1" },
    create: {
      employeeId: rahul.id,
      periodId: period.id,
      outletId: indiranagar.id,
      amount: 250,
      items: [{ name: "Burger", amount: 250 }],
      occurredAt: now,
      idempotencyKey: "seed-txn-1",
    },
    update: {},
  });

  await prisma.benefitTransaction.upsert({
    where: { idempotencyKey: "seed-txn-2" },
    create: {
      employeeId: rahul.id,
      periodId: period.id,
      outletId: koramangala.id,
      amount: 400,
      items: [{ name: "Pizza", amount: 400 }],
      occurredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      idempotencyKey: "seed-txn-2",
    },
    update: {},
  });

  console.log("Seed complete.");
  console.log("Try logging in as:", rahul.phone, "(OTP prints to this console)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
