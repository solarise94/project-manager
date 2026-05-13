// One-shot migration: move project-only receipts to orders on demo DB.
// Usage: npx tsx scripts/migrate-demo-receipts-to-orders.ts

import { PrismaClient } from "@prisma/client";

const DEMO_DB = "/home/solarise/task-manager-data/demo/dev.db";

async function main() {
  console.log(`Connecting to demo DB: ${DEMO_DB}`);
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${DEMO_DB}` } },
  });

  // 1. Find receipts without orderId that have a projectId
  const orphans = await prisma.financeReceipt.findMany({
    where: { orderId: null, projectId: { not: null } },
    select: { id: true, amount: true, projectId: true, customerId: true },
  });
  console.log(`Found ${orphans.length} project-only receipts to migrate`);

  let migrated = 0;
  let createdOrders = 0;
  const skipped: string[] = [];

  for (const r of orphans) {
    if (!r.projectId) continue;

    // Find orders linked to this project
    const links = await prisma.orderProjectLink.findMany({
      where: { projectId: r.projectId },
      select: { orderId: true, order: { select: { id: true, customerId: true, totalAmount: true } } },
    });

    let targetOrderId: string | null = null;

    if (links.length === 1) {
      targetOrderId = links[0].orderId;
    } else if (links.length > 1) {
      // Pick the order whose amount is closest to the receipt amount
      let best: typeof links[0] | null = null;
      let bestDiff = Infinity;
      for (const l of links) {
        const diff = Math.abs((l.order?.totalAmount ?? 0) - r.amount);
        if (diff < bestDiff) { bestDiff = diff; best = l; }
        // Prefer same customer
        if (l.order?.customerId === r.customerId && diff < bestDiff + 100) {
          best = l;
          break;
        }
      }
      targetOrderId = best?.orderId ?? null;
    }

    if (!targetOrderId) {
      // No linked orders — create a migration order
      const project = await prisma.project.findUnique({
        where: { id: r.projectId },
        select: { name: true, customerId: true },
      });
      const orderNo = `SO-MIG-${Date.now()}-${migrated}`;
      const order = await prisma.order.create({
        data: {
          orderNo,
          source: "MANUAL",
          title: `历史项目回款迁移 - ${project?.name || r.projectId}`,
          category: "UNKNOWN",
          status: "CONFIRMED",
          deliveryStatus: "DELIVERED",
          customerId: r.customerId || project?.customerId || null,
          totalAmount: r.amount,
          createdById: "__MIGRATION__",
          customerMatchStatus: "UNMATCHED",
        },
      });
      targetOrderId = order.id;
      createdOrders++;
    }

    if (!targetOrderId) {
      skipped.push(r.id);
      continue;
    }

    await prisma.financeReceipt.update({
      where: { id: r.id },
      data: { orderId: targetOrderId, projectId: null },
    });
    migrated++;
  }

  // 2. Verify
  const remaining = await prisma.financeReceipt.count({ where: { orderId: null } });
  const withProject = await prisma.financeReceipt.count({ where: { projectId: { not: null } } });

  console.log(`\nMigration complete:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Created migration orders: ${createdOrders}`);
  console.log(`  Skipped (no order found): ${skipped.length}`);
  console.log(`  Remaining receipts without orderId: ${remaining}`);
  console.log(`  Remaining receipts with projectId: ${withProject}`);

  if (remaining > 0) console.warn(`  WARNING: ${remaining} receipts still have no orderId!`);
  if (skipped.length > 0) console.log(`  Skipped IDs: ${skipped.join(", ")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
