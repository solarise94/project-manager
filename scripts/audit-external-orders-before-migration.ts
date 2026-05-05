/**
 * Audit script — runs before migration to inspect ExternalOrder data quality.
 *
 * Usage:
 *   npx tsx scripts/audit-external-orders-before-migration.ts [--json]
 *
 * Output:
 *   - terminal summary (default)
 *   - JSON report to stdout (--json flag)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface AuditStats {
  total: number;
  unmerged: number;
  merged: number;
  withCustomerId: number;
  withProjectId: number;
  withInvoiceRequests: number;
  withCoverage: number;
  withReceipts: number;
  duplicateSourceExternalOrderNo: number;
  paidAmountMissing: number;
  paidAmountZero: number;
  financeCategoryUnknown: number;
  financeTreatmentDistribution: Record<string, number>;
  duplicateStatusDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
  mergedSourceHasInvoice: number;
  mergedSourceHasReceipt: number;
  anomalies: string[];
}

async function main() {
  const stats: AuditStats = {
    total: 0,
    unmerged: 0,
    merged: 0,
    withCustomerId: 0,
    withProjectId: 0,
    withInvoiceRequests: 0,
    withCoverage: 0,
    withReceipts: 0,
    duplicateSourceExternalOrderNo: 0,
    paidAmountMissing: 0,
    paidAmountZero: 0,
    financeCategoryUnknown: 0,
    financeTreatmentDistribution: {},
    duplicateStatusDistribution: {},
    sourceDistribution: {},
    mergedSourceHasInvoice: 0,
    mergedSourceHasReceipt: 0,
    anomalies: [],
  };

  // 1. Basic counts
  stats.total = await prisma.externalOrder.count();

  // mergedIntoId is authoritative, but duplicateStatus=MERGED without mergedIntoId
  // is also a merged source signal. Count both and flag the mismatch.
  stats.unmerged = await prisma.externalOrder.count({
    where: { mergedIntoId: null, duplicateStatus: { not: "MERGED" } },
  });

  stats.merged = await prisma.externalOrder.count({
    where: { mergedIntoId: { not: null } },
  });

  const mergedByStatusOnly = await prisma.externalOrder.count({
    where: { mergedIntoId: null, duplicateStatus: "MERGED" },
  });
  if (mergedByStatusOnly > 0) {
    stats.anomalies.push(
      `${mergedByStatusOnly} 条订单 duplicateStatus=MERGED 但 mergedIntoId 为空（状态与字段不一致）`
    );
  }

  stats.withCustomerId = await prisma.externalOrder.count({
    where: { customerId: { not: null } },
  });

  stats.withProjectId = await prisma.externalOrder.count({
    where: { projectId: { not: null } },
  });

  stats.withInvoiceRequests = await prisma.externalOrder.count({
    where: { invoiceRequests: { some: {} } },
  });

  stats.withCoverage = await prisma.externalOrder.count({
    where: { invoiceCoverage: { some: {} } },
  });

  stats.withReceipts = await prisma.externalOrder.count({
    where: { receipts: { some: {} } },
  });

  // 2. Duplicate source + externalOrderNo check
  const dupes = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
    `SELECT COUNT(*) as cnt FROM (
       SELECT source, externalOrderNo, COUNT(*) as grp
       FROM ExternalOrder
       GROUP BY source, externalOrderNo
       HAVING grp > 1
     )`
  );
  stats.duplicateSourceExternalOrderNo = Number(dupes[0]?.cnt ?? 0);
  if (stats.duplicateSourceExternalOrderNo > 0) {
    stats.anomalies.push(
      `发现 ${stats.duplicateSourceExternalOrderNo} 组 source+externalOrderNo 重复`
    );
  }

  // 3. Amount anomalies
  stats.paidAmountMissing = await prisma.externalOrder.count({
    where: { paidAmount: null },
  });
  if (stats.paidAmountMissing > 0) {
    stats.anomalies.push(
      `${stats.paidAmountMissing} 条订单 paidAmount 为空`
    );
  }

  stats.paidAmountZero = await prisma.externalOrder.count({
    where: { paidAmount: 0 },
  });

  // 4. Category unknown
  stats.financeCategoryUnknown = await prisma.externalOrder.count({
    where: { financeCategory: "UNKNOWN" },
  });
  if (stats.financeCategoryUnknown > 0) {
    stats.anomalies.push(
      `${stats.financeCategoryUnknown} 条订单 financeCategory = UNKNOWN`
    );
  }

  // 5. Distributions
  const treatmentRows = await prisma.$queryRawUnsafe<Array<{ val: string; cnt: number }>>(
    `SELECT financeTreatment as val, COUNT(*) as cnt FROM ExternalOrder GROUP BY financeTreatment`
  );
  for (const r of treatmentRows) {
    stats.financeTreatmentDistribution[r.val] = Number(r.cnt);
  }

  const dupStatusRows = await prisma.$queryRawUnsafe<Array<{ val: string; cnt: number }>>(
    `SELECT duplicateStatus as val, COUNT(*) as cnt FROM ExternalOrder GROUP BY duplicateStatus`
  );
  for (const r of dupStatusRows) {
    stats.duplicateStatusDistribution[r.val] = Number(r.cnt);
  }

  const sourceRows = await prisma.$queryRawUnsafe<Array<{ val: string; cnt: number }>>(
    `SELECT source as val, COUNT(*) as cnt FROM ExternalOrder GROUP BY source`
  );
  for (const r of sourceRows) {
    stats.sourceDistribution[r.val] = Number(r.cnt);
  }

  // 6. Merged source orders (by either signal) that still have active financial links
  const mergedWhere = {
    OR: [
      { mergedIntoId: { not: null } },
      { duplicateStatus: "MERGED" },
    ],
  };

  stats.mergedSourceHasInvoice = await prisma.externalOrder.count({
    where: { ...mergedWhere, invoiceRequests: { some: {} } },
  });
  if (stats.mergedSourceHasInvoice > 0) {
    stats.anomalies.push(
      `${stats.mergedSourceHasInvoice} 条已合并来源订单仍有关联发票`
    );
  }

  stats.mergedSourceHasReceipt = await prisma.externalOrder.count({
    where: { ...mergedWhere, receipts: { some: {} } },
  });
  if (stats.mergedSourceHasReceipt > 0) {
    stats.anomalies.push(
      `${stats.mergedSourceHasReceipt} 条已合并来源订单仍有关联回款`
    );
  }

  // 7. Check for cross-source mergedIntoId (merged into orders from different source)
  const crossMerge = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
    `SELECT COUNT(*) as cnt FROM ExternalOrder src
     JOIN ExternalOrder tgt ON src.mergedIntoId = tgt.id
     WHERE src.source != tgt.source`
  );
  if (Number(crossMerge[0]?.cnt ?? 0) > 0) {
    stats.anomalies.push(
      `发现跨来源合并的订单对`
    );
  }

  // Output
  const isJson = process.argv.includes("--json");

  if (isJson) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log("═══════════════════════════════════════════");
    console.log("  ExternalOrder 迁移前审计报告");
    console.log("═══════════════════════════════════════════");
    console.log("");
    console.log(`总订单数:              ${stats.total}`);
    console.log(`未合并:                ${stats.unmerged}`);
    console.log(`已合并 (source):       ${stats.merged}`);
    console.log("");
    console.log("── 关联情况 ──");
    console.log(`有客户绑定:            ${stats.withCustomerId}`);
    console.log(`有项目绑定:            ${stats.withProjectId}`);
    console.log(`有开票申请:            ${stats.withInvoiceRequests}`);
    console.log(`有合并开票 coverage:   ${stats.withCoverage}`);
    console.log(`有回款记录:            ${stats.withReceipts}`);
    console.log("");
    console.log("── 数据质量 ──");
    console.log(`paidAmount 为空:       ${stats.paidAmountMissing}`);
    console.log(`paidAmount = 0:        ${stats.paidAmountZero}`);
    console.log(`financeCategory=UNKNOWN: ${stats.financeCategoryUnknown}`);
    console.log(`source+externalOrderNo 重复组: ${stats.duplicateSourceExternalOrderNo}`);
    console.log("");
    console.log("── 来源分布 ──");
    for (const [k, v] of Object.entries(stats.sourceDistribution)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log("");
    console.log("── 财务计入口径分布 ──");
    for (const [k, v] of Object.entries(stats.financeTreatmentDistribution)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log("");
    console.log("── 去重状态分布 ──");
    for (const [k, v] of Object.entries(stats.duplicateStatusDistribution)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log("");
    console.log("── 风险项 ──");
    console.log(`已合并源有发票:        ${stats.mergedSourceHasInvoice}`);
    console.log(`已合并源有回款:        ${stats.mergedSourceHasReceipt}`);
    console.log("");

    if (stats.anomalies.length > 0) {
      console.log("── 异常项 ──");
      for (const a of stats.anomalies) {
        console.log(`  ⚠ ${a}`);
      }
      console.log("");
    }

    console.log("═══════════════════════════════════════════");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
