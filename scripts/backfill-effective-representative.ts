/**
 * Backfill Order.representativeId and Project.representativeId/representative
 * using the effective representative resolver.
 *
 * Run with:
 *   npx tsx scripts/backfill-effective-representative.ts
 */

import { prisma } from "../src/lib/prisma";
import { resolveEffectiveCustomerRepresentatives } from "../src/lib/crm/customer-effective-representative";

const BATCH_SIZE = 500;

async function backfill() {
  console.log("[BACKFILL] Starting effective representative backfill...");

  const customers = await prisma.customer.findMany({
    where: { deleted: false },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[BACKFILL] Total customers: ${customers.length}`);

  const sourceStats = {
    EXPLICIT_ASSIGNMENT: 0,
    SITE_BINDING: 0,
    ORG_BINDING: 0,
    NONE: 0,
  };

  let updatedOrders = 0;
  let updatedProjects = 0;
  let unchangedOrders = 0;
  let unchangedProjects = 0;

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    const customerIds = batch.map((c) => c.id);

    const effectiveMap = await resolveEffectiveCustomerRepresentatives(customerIds);

    // Collect updates
    const orderUpdates: { customerId: string; representativeId: string | null }[] = [];
    const projectUpdates: { customerId: string; representativeId: string | null; representativeName: string | null }[] = [];

    for (const customerId of customerIds) {
      const effective = effectiveMap.get(customerId);
      if (!effective) continue;

      sourceStats[effective.source] += 1;

      orderUpdates.push({
        customerId,
        representativeId: effective.representativeId,
      });
      projectUpdates.push({
        customerId,
        representativeId: effective.representativeId,
        representativeName: effective.representativeName,
      });
    }

    // Batch update orders
    for (const { customerId, representativeId } of orderUpdates) {
      const existing = await prisma.order.findMany({
        where: { customerId },
        select: { id: true, representativeId: true },
      });
      for (const order of existing) {
        if (order.representativeId !== representativeId) {
          await prisma.order.update({
            where: { id: order.id },
            data: { representativeId },
          });
          updatedOrders++;
        } else {
          unchangedOrders++;
        }
      }
    }

    // Batch update projects
    for (const { customerId, representativeId, representativeName } of projectUpdates) {
      const existing = await prisma.project.findMany({
        where: { customerId },
        select: { id: true, representativeId: true, representative: true },
      });
      for (const project of existing) {
        if (project.representativeId !== representativeId || project.representative !== representativeName) {
          await prisma.project.update({
            where: { id: project.id },
            data: { representativeId, representative: representativeName },
          });
          updatedProjects++;
        } else {
          unchangedProjects++;
        }
      }
    }

    console.log(`[BACKFILL] Processed ${Math.min(i + BATCH_SIZE, customers.length)} / ${customers.length} customers`);
  }

  console.log("\n[BACKFILL] Done!");
  console.log("Source distribution:");
  console.log(`  EXPLICIT_ASSIGNMENT: ${sourceStats.EXPLICIT_ASSIGNMENT}`);
  console.log(`  SITE_BINDING:        ${sourceStats.SITE_BINDING}`);
  console.log(`  ORG_BINDING:         ${sourceStats.ORG_BINDING}`);
  console.log(`  NONE:                ${sourceStats.NONE}`);
  console.log("\nUpdate stats:");
  console.log(`  Orders updated:      ${updatedOrders}`);
  console.log(`  Orders unchanged:    ${unchangedOrders}`);
  console.log(`  Projects updated:    ${updatedProjects}`);
  console.log(`  Projects unchanged:  ${unchangedProjects}`);
}

backfill()
  .catch((err) => {
    console.error("[BACKFILL] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
