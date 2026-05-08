/**
 * One-time migration: convert Project.budgetCost values into FinanceCost records.
 *
 * Usage: npx tsx scripts/migrate-project-budget-costs.ts
 *
 * Idempotent via sourceKey = "project-budget-cost:<projectId>".
 * Only creates FinanceCost for projects where budgetCost > 0 and no existing record.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[MIGRATE] Scanning projects with budgetCost > 0...");

  // Find an admin user to set as createdBy
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
  });

  if (!admin) {
    console.error("[MIGRATE] No ADMIN user found — cannot proceed without a valid createdById.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[MIGRATE] Using admin user: ${admin.email} (${admin.id})`);

  const projects = await prisma.project.findMany({
    where: {
      budgetCost: { gt: 0 },
      deleted: false,
    },
    select: {
      id: true,
      name: true,
      budgetCost: true,
      customerId: true,
    },
  });

  console.log(`[MIGRATE] Found ${projects.length} projects with budgetCost > 0`);

  let created = 0;
  let skipped = 0;

  for (const p of projects) {
    const sourceKey = `project-budget-cost:${p.id}`;

    const existing = await prisma.financeCost.findUnique({
      where: { sourceKey },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.financeCost.create({
      data: {
        projectId: p.id,
        customerId: p.customerId,
        amount: p.budgetCost!,
        costType: "OTHER",
        sourceType: "PROJECT_BUDGET_COST",
        sourceKey,
        occurredAt: new Date(),
        remark: "历史项目成本迁移",
        createdById: admin.id,
      },
    });

    created++;
    console.log(`[MIGRATE] + ${p.name} (budgetCost=${p.budgetCost})`);
  }

  console.log(`[MIGRATE] Done: created=${created}, skipped=${skipped}, total=${projects.length}`);

  const total = await prisma.financeCost.aggregate({
    _sum: { amount: true },
    where: { sourceType: "PROJECT_BUDGET_COST" },
  });
  console.log(`[MIGRATE] Total migrated cost: ${total._sum.amount || 0}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[MIGRATE] Fatal error:", err);
  process.exit(1);
});
