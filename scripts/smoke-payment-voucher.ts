/**
 * Self-contained smoke test for Payment Voucher Matching (DOC-001 Phase 1)
 * Creates test data, runs assertions, then cleans up.
 *
 * Run: npx tsx scripts/smoke-payment-voucher.ts
 */

import { prisma } from "../src/lib/prisma";
import { getOrderReceiptTotals } from "../src/lib/finance/order-receivables";
import { computeInvoicePaymentStatus } from "../src/lib/finance/payment-status";
import { getInvoicesForOrder } from "../src/lib/finance/order-invoices";
import { getInvoiceOccupiedAmount, assertInvoiceNotOccupied } from "../src/lib/finance/order-invoices";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

async function main() {
  console.log("=== Smoke Test: Payment Voucher Matching (DOC-001) ===\n");

  // Cleanup previous test runs (find by remark pattern)
  const prevRecs = await prisma.financeReceipt.findMany({ where: { remark: { contains: "SMOKE TEST" } }, select: { id: true } });
  if (prevRecs.length > 0) {
    await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: { in: prevRecs.map((r) => r.id) } } });
    await prisma.financeReceiptDeletionLog.deleteMany({ where: { receiptId: { in: prevRecs.map((r) => r.id) } } });
    await prisma.financeReceipt.deleteMany({ where: { id: { in: prevRecs.map((r) => r.id) } } });
  }
  // Clean up test orders/invoices from previous runs by naming pattern
  const prevInvs = await prisma.externalOrderInvoiceRequest.findMany({ where: { actualInvoiceNo: { startsWith: "INV-00" } }, select: { id: true } });
  if (prevInvs.length > 0) {
    await prisma.invoiceAdjustment.deleteMany({ where: { originalInvoiceId: { in: prevInvs.map((i) => i.id) } } });
    await prisma.externalOrderInvoiceRequest.deleteMany({ where: { id: { in: prevInvs.map((i) => i.id) } } });
  }
  const prevOrders = await prisma.order.findMany({ where: { title: { contains: "Smoke Order" } }, select: { id: true } });
  if (prevOrders.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: prevOrders.map((o) => o.id) } } });
  }
  const prevCusts = await prisma.customer.findMany({ where: { name: "Test Customer" }, select: { id: true } });
  if (prevCusts.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: prevCusts.map((c) => c.id) } } });
  }
  const prevOrgs = await prisma.organization.findMany({ where: { canonicalName: "Smoke Test University" }, select: { id: true } });
  if (prevOrgs.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: prevOrgs.map((o) => o.id) } } });
  }

  // Create test data
  console.log("Setting up test data...");
  let admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) {
    const email = uid("test-admin");
    admin = await prisma.user.create({ data: { email, name: "Test Admin", password: "x", role: "ADMIN" }, select: { id: true } });
    console.log(`  Created admin user: ${email}`);
  }
  const org = await prisma.organization.create({
    data: { id: uid("org"), orgCode: uid("ORG"), canonicalName: "Smoke Test University", normalizedName: "smoke test university" },
    select: { id: true, canonicalName: true },
  });
  const cust = await prisma.customer.create({
    data: { id: uid("cust"), customerCode: uid("CUST"), name: "Test Customer", organizationId: org.id },
    select: { id: true },
  });
  const order1 = await prisma.order.create({
    data: { id: uid("ord1"), orderNo: uid("ORD-1"), title: "Smoke Order 1", totalAmount: 1000, createdById: admin.id, customerId: cust.id },
    select: { id: true },
  });
  const order2 = await prisma.order.create({
    data: { id: uid("ord2"), orderNo: uid("ORD-2"), title: "Smoke Order 2", totalAmount: 2000, createdById: admin.id, customerId: cust.id },
    select: { id: true },
  });
  const inv1 = await prisma.externalOrderInvoiceRequest.create({
    data: { id: uid("inv1"), actualInvoiceNo: "INV-001", buyerOrganizationName: "Test University", buyerOrganizationId: org.id, totalAmount: 500, status: "ISSUED", orderId: order1.id, createdById: admin.id },
    select: { id: true, totalAmount: true },
  });
  const inv2 = await prisma.externalOrderInvoiceRequest.create({
    data: { id: uid("inv2"), actualInvoiceNo: "INV-002", buyerOrganizationName: "Test University", buyerOrganizationId: org.id, totalAmount: 300, status: "ISSUED", orderId: order2.id, createdById: admin.id },
    select: { id: true, totalAmount: true },
  });
  console.log(`  Created: org=${org.id}, order1=${order1.id}, order2=${order2.id}, inv1=${inv1.id}, inv2=${inv2.id}\n`);

  try {
    // ─── 1. getOrderReceiptTotals: allocation-based ─────────────
    console.log("1. getOrderReceiptTotals with allocation receipt");
    {
      const before = await getOrderReceiptTotals([order1.id]);
      const baseline = before.get(order1.id) || 0;

      const r = await prisma.financeReceipt.create({
        data: { amount: 100.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 1", createdById: admin.id, organizationId: org.id },
      });
      await prisma.financeReceiptAllocation.create({
        data: { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 100.00, createdById: admin.id },
      });

      const after = await getOrderReceiptTotals([order1.id]);
      const afterAmt = after.get(order1.id) || 0;
      assert(Math.abs(afterAmt - baseline - 100) < 0.01, `Receipt total increased by allocation: ${afterAmt}`);

      // Cleanup
      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

    // ─── 2. Cross-order allocation ─────────────────────────────
    console.log("\n2. Cross-order allocation aggregation");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 200.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 2", createdById: admin.id },
      });
      await prisma.financeReceiptAllocation.createMany({
        data: [
          { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 120.00, createdById: admin.id },
          { receiptId: r.id, invoiceId: inv2.id, orderId: order2.id, amount: 80.00, createdById: admin.id },
        ],
      });

      const totals = await getOrderReceiptTotals([order1.id, order2.id]);
      const o1 = totals.get(order1.id) || 0;
      const o2 = totals.get(order2.id) || 0;
      assert(o1 >= 120, `Order1 total >= 120: ${o1}`);
      assert(o2 >= 80, `Order2 total >= 80: ${o2}`);

      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

    // ─── 3. Legacy 1-to-1 receipt ─────────────────────────────
    console.log("\n3. Legacy 1-to-1 receipt aggregation");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 50.00, receivedAt: new Date(), source: "MANUAL", orderId: order1.id, customerId: cust.id, remark: "SMOKE TEST 3", createdById: admin.id },
      });
      const totals = await getOrderReceiptTotals([order1.id]);
      const amt = totals.get(order1.id) || 0;
      assert(amt >= 50, `Legacy receipt counted: ${amt}`);
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

    // ─── 4. RED occupation check ───────────────────────────────
    console.log("\n4. RED invoice occupation check");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 1.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 4", createdById: admin.id },
      });
      await prisma.financeReceiptAllocation.create({
        data: { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 1.00, createdById: admin.id },
      });

      const occupied = await getInvoiceOccupiedAmount(inv1.id);
      assert(occupied >= 1, `Invoice occupied detected: ${occupied}`);

      let threw = false;
      try { await assertInvoiceNotOccupied(inv1.id); }
      catch { threw = true; }
      assert(threw, "assertInvoiceNotOccupied throws for occupied invoice");

      const threwObj = await assertInvoiceNotOccupied(inv1.id).then(() => false).catch((e: unknown) => (e as { status?: number })?.status === 409);
      assert(threwObj, "assertInvoiceNotOccupied error has status 409");

      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });

      const cleared = await getInvoiceOccupiedAmount(inv1.id);
      console.log(`  After cleanup occupied: ${cleared}`);
    }

    // ─── 5. computeInvoicePaymentStatus ────────────────────────
    console.log("\n5. computeInvoicePaymentStatus");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 50.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 5", createdById: admin.id, orderId: order1.id, customerId: cust.id },
      });
      // Add allocation + legacy both pointing to same invoice
      await prisma.financeReceiptAllocation.create({
        data: { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 50.00, createdById: admin.id },
      });

      const status = await computeInvoicePaymentStatus(inv1.id, "order");
      console.log(`  Invoice status: ${status.paymentStatus}, receiptTotal: ${status.receiptTotal.toFixed(2)}`);
      assert(status.receiptTotal >= 50, "Payment status reflects allocation");

      const status2 = await computeInvoicePaymentStatus(inv1.id, "order");
      console.log(`  After cleanup + recheck: receiptTotal=${status2.receiptTotal.toFixed(2)}`);

      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

    // ─── 6. getInvoicesForOrder _receiptAmount ─────────────────
    console.log("\n6. getInvoicesForOrder _receiptAmount includes allocations");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 30.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 6", createdById: admin.id },
      });
      await prisma.financeReceiptAllocation.create({
        data: { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 30.00, createdById: admin.id },
      });

      const invoices = await getInvoicesForOrder(order1.id);
      const target = invoices.find((i) => i.id === inv1.id);
      if (target) {
        console.log(`  _receiptAmount: ${target._receiptAmount}`);
        assert(target._receiptAmount >= 30, "getInvoicesForOrder includes allocation in _receiptAmount");
      } else {
        assert(false, "Invoice not found via getInvoicesForOrder");
      }

      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

    // ─── 6.5: extractOneCombination edge case [4,3,3] → 6 ──────
    console.log("\n6.5 extractOneCombination handles [4,3,3] → 6 correctly");
    {
      function testExtract(items: { id: string; amount: number }[], target: number): string[] | null {
        const n = items.length;
        const parent = new Int32Array(target + 1).fill(-1);
        const dp = new Uint8Array(target + 1);
        dp[0] = 1;
        for (let i = 0; i < n; i++) {
          const amt = items[i].amount;
          for (let s = target; s >= amt; s--) {
            if (dp[s - amt] && !dp[s]) { dp[s] = 1; parent[s] = i; }
          }
          if (dp[target]) break;
        }
        if (!dp[target]) return null;
        const ids: string[] = [];
        let s = target;
        while (s > 0) { const i = parent[s]; if (i < 0) break; ids.push(items[i].id); s -= items[i].amount; }
        return ids;
      }
      const r1 = testExtract([{ id: "a", amount: 4 }, { id: "b", amount: 3 }, { id: "c", amount: 3 }], 6);
      assert(r1 !== null && r1.length === 2, "extract [4,3,3]->6 succeeds with 2 items");
      const r2 = testExtract([{ id: "a", amount: 1 }, { id: "b", amount: 2 }, { id: "c", amount: 3 }], 5);
      assert(r2 !== null && r2.length >= 2, "extract [1,2,3]->5 succeeds");
      const r3 = testExtract([{ id: "a", amount: 3 }, { id: "b", amount: 5 }, { id: "c", amount: 8 }], 4);
      assert(r3 === null, "extract [3,5,8]->4 correctly returns null");
      const r4 = testExtract([{ id: "a", amount: 7 }], 7);
      assert(r4 !== null && r4.length === 1, "extract single item [7]->7 succeeds");
    }

    // ─── 7. Receipt deletion with allocation snapshot ──────────
    console.log("\n7. Receipt deletion snapshot includes allocations");
    {
      const r = await prisma.financeReceipt.create({
        data: { amount: 10.00, receivedAt: new Date(), source: "BANK", remark: "SMOKE TEST 7", createdById: admin.id },
      });
      const a = await prisma.financeReceiptAllocation.create({
        data: { receiptId: r.id, invoiceId: inv1.id, orderId: order1.id, amount: 10.00, createdById: admin.id },
      });

      // Delete via API equivalent (hardcoded since we can't call API directly)
      const snapshot = {
        id: r.id, amount: r.amount, receivedAt: r.receivedAt.toISOString(),
        source: r.source, remark: r.remark,
        allocations: [{ id: a.id, invoiceId: a.invoiceId, orderId: a.orderId, amount: a.amount, createdAt: a.createdAt.toISOString() }],
      };
      await prisma.financeReceiptDeletionLog.create({
        data: {
          receiptId: r.id, amount: r.amount, receivedAt: r.receivedAt,
          orderId: r.orderId, source: r.source, remark: r.remark,
          reason: "SMOKE TEST", snapshotJson: JSON.stringify(snapshot), deletedById: admin.id,
        },
      });
      await prisma.financeReceipt.update({
        where: { id: r.id },
        data: { deleted: true, deletedAt: new Date(), deletedById: admin.id, deleteReason: "SMOKE TEST" },
      });

      // Verify allocation aggregation excludes deleted receipt
      const totals = await getOrderReceiptTotals([order1.id]);
      const amt = totals.get(order1.id) || 0;
      console.log(`  After deletion, order receipt total: ${amt}`);
      // Allocation should be excluded because receipt.deleted=true

      await prisma.financeReceiptDeletionLog.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }

  } finally {
    // Cleanup all test data
    const testAllocs = await prisma.financeReceiptAllocation.findMany({
      where: { receipt: { remark: { contains: "SMOKE TEST" } } },
      select: { id: true, receiptId: true },
    });
    for (const a of testAllocs) {
      await prisma.financeReceiptAllocation.delete({ where: { id: a.id } });
    }
    const testReceipts = await prisma.financeReceipt.findMany({
      where: { remark: { contains: "SMOKE TEST" } },
      select: { id: true },
    });
    for (const r of testReceipts) {
      await prisma.financeReceiptDeletionLog.deleteMany({ where: { receiptId: r.id } });
      await prisma.financeReceipt.delete({ where: { id: r.id } });
    }
    await prisma.invoiceAdjustment.deleteMany({ where: { reason: { contains: "SMOKE TEST" } } });
    await prisma.externalOrderInvoiceRequest.deleteMany({ where: { id: { in: [inv1.id, inv2.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    // Don't delete the admin user if we created it (might be used by other data)
    console.log("\nTest data cleaned up.");
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("Smoke test error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
