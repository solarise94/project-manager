#!/usr/bin/env tsx
/**
 * Smoke test: multiple invoices matched into one allocation receipt can be
 * created and then retrieved through the public API.
 *
 * Runs against the local demo service on http://127.0.0.1:31081.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const DEMO_DB = "file:/home/solarise/task-manager-data/demo/dev.db";
const BASE_URL = "http://127.0.0.1:31081";

const prisma = new PrismaClient({ datasources: { db: { url: DEMO_DB } } });

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractCookie(setCookie: string | string[] | null, name: string): string | null {
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  const parts: string[] = [];
  for (const r of raw) {
    // Set-Cookie headers may be folded into one comma-separated string
    parts.push(...r.split(", "));
  }
  for (const c of parts) {
    const match = c.match(new RegExp(`(^|;)\\s*${name}=([^;]+)`));
    if (match) return match[2];
  }
  return null;
}

async function login(email: string, password: string): Promise<string> {
  // 1. CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { credentials: "include" });
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const csrfCookie = csrfRes.headers.get("set-cookie") || "";

  // 2. Credentials callback
  const params = new URLSearchParams();
  params.set("csrfToken", csrfToken);
  params.set("email", email);
  params.set("password", password);
  params.set("callbackUrl", BASE_URL);
  params.set("json", "true");

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: typeof csrfCookie === "string" ? csrfCookie : csrfCookie.join("; "),
    },
    body: params.toString(),
    redirect: "manual",
  });

  const sessionToken = extractCookie(loginRes.headers.get("set-cookie"), "next-auth.session-token");
  if (!sessionToken) {
    const body = await loginRes.text();
    const setCookie = loginRes.headers.get("set-cookie");
    throw new Error(`Login failed: ${loginRes.status} ${body}\nset-cookie: ${setCookie}`);
  }
  return `next-auth.session-token=${sessionToken}`;
}

async function apiFetch(path: string, cookie: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function main() {
  console.log("=== Smoke Test: Payment Voucher Allocation Receipt Retrieval ===\n");

  // Ensure a clean admin test user exists
  const email = `smoke-${Date.now()}@scimanage.local`;
  const password = "SmokePass123!";
  await prisma.user.deleteMany({ where: { email: { contains: "@scimanage.local" } } });
  const user = await prisma.user.create({
    data: { email, name: "Smoke Admin", role: "ADMIN", password: await bcrypt.hash(password, 12) },
  });

  // Give the running demo service a moment to see the new row via its own Prisma connection
  await new Promise((r) => setTimeout(r, 500));

  const cookie = await login(email, password);

  // Create test data
  const org = await prisma.organization.create({
    data: { canonicalName: `Smoke Org ${Date.now()}`, normalizedName: `smoke org ${Date.now()}`, orgCode: `SMOKE-${Date.now()}` },
  });
  const customer = await prisma.customer.create({
    data: { name: `Smoke Customer ${Date.now()}`, customerCode: `SMOKE-CUST-${Date.now()}` },
  });
  const now = new Date();
  const order1 = await prisma.order.create({
    data: {
      orderNo: `SO-${Date.now()}-1`,
      source: "MANUAL",
      title: "Smoke Order 1",
      status: "NOT_STARTED",
      orderedAt: now,
      customerId: customer.id,
      totalAmount: 300,
      createdById: user.id,
    },
  });
  const order2 = await prisma.order.create({
    data: {
      orderNo: `SO-${Date.now()}-2`,
      source: "MANUAL",
      title: "Smoke Order 2",
      status: "NOT_STARTED",
      orderedAt: now,
      customerId: customer.id,
      totalAmount: 500,
      createdById: user.id,
    },
  });

  const inv1 = await prisma.externalOrderInvoiceRequest.create({
    data: {
      orderId: order1.id,
      buyerOrganizationId: org.id,
      buyerOrganizationName: org.canonicalName,
      actualInvoiceNo: `INV-${Date.now()}-1`,
      totalAmount: 300,
      status: "ISSUED",
      invoiceType: "NORMAL",
      createdById: user.id,
    },
  });
  const inv2 = await prisma.externalOrderInvoiceRequest.create({
    data: {
      orderId: order2.id,
      buyerOrganizationId: org.id,
      buyerOrganizationName: org.canonicalName,
      actualInvoiceNo: `INV-${Date.now()}-2`,
      totalAmount: 500,
      status: "ISSUED",
      invoiceType: "NORMAL",
      createdById: user.id,
    },
  });

  console.log(`Created org=${org.id}, customer=${customer.id}, orders=${order1.id},${order2.id}, invoices=${inv1.id},${inv2.id}`);

  // 1. Match API should return a combination of both invoices (300 + 500 = 800)
  const matchRes = await apiFetch("/api/finance/payment-vouchers/match", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: org.id, amount: 800, receivedAt: todayStr() }),
  });
  if (!matchRes.ok) {
    const text = await matchRes.text();
    throw new Error(`Match API failed: ${matchRes.status} ${text}`);
  }
  const matchData = await matchRes.json();
  if (matchData.status !== "MATCHED" || !matchData.combinations || matchData.combinations.length === 0) {
    throw new Error(`Expected MATCHED with combinations, got ${JSON.stringify(matchData)}`);
  }
  const combo = matchData.combinations[0];
  if (combo.count !== 2 || Math.abs(combo.sum - 800) > 0.001) {
    throw new Error(`Expected 2-invoice combo sum 800, got ${combo.count} / ${combo.sum}`);
  }
  console.log("✓ Match API returned 2-invoice combination for 800.00");

  // 2. Create receipt with allocations
  const allocations = combo.invoiceIds.map((id: string, idx: number) => ({
    invoiceId: id,
    amount: combo.amounts[idx],
  }));
  const receiptRes = await apiFetch("/api/finance/receipts", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: 800,
      receivedAt: todayStr(),
      source: "BANK",
      organizationId: org.id,
      allocations,
    }),
  });
  if (!receiptRes.ok) {
    const text = await receiptRes.text();
    throw new Error(`Receipt creation failed: ${receiptRes.status} ${text}`);
  }
  const receiptData = await receiptRes.json();
  const receiptId = receiptData.receipt.id;
  console.log(`✓ Created allocation receipt ${receiptId}`);

  // 3. Retrieve via date range filter
  const listRes = await apiFetch(`/api/finance/receipts?dateFrom=${todayStr()}&dateTo=${todayStr()}`, cookie);
  if (!listRes.ok) {
    throw new Error(`List receipts failed: ${listRes.status}`);
  }
  const listData = await listRes.json();
  const foundByDate = listData.receipts.find((r: { id: string }) => r.id === receiptId);
  if (!foundByDate) {
    throw new Error(`Receipt not found by date range filter`);
  }
  if (foundByDate.allocationCount !== 2) {
    throw new Error(`Expected allocationCount=2 in list, got ${foundByDate.allocationCount}`);
  }
  console.log("✓ Receipt retrieved by date range with allocationCount=2");

  // 4. Retrieve via orderId filter for each linked order
  for (const oid of [order1.id, order2.id]) {
    const orderRes = await apiFetch(`/api/finance/receipts?orderId=${oid}`, cookie);
    if (!orderRes.ok) {
      throw new Error(`List receipts by order failed: ${orderRes.status}`);
    }
    const orderData = await orderRes.json();
    const foundByOrder = orderData.receipts.find((r: { id: string }) => r.id === receiptId);
    if (!foundByOrder) {
      throw new Error(`Receipt not found by orderId=${oid}`);
    }
    console.log(`✓ Receipt retrieved by orderId=${oid}`);
  }

  // 5. Verify allocation details in detail view
  const detailRes = await apiFetch(`/api/finance/receipts/${receiptId}`, cookie);
  if (!detailRes.ok) {
    throw new Error(`Receipt detail failed: ${detailRes.status}`);
  }
  const detail = await detailRes.json();
  if (!detail.allocations || detail.allocations.length !== 2) {
    throw new Error(`Expected 2 allocations in detail, got ${detail.allocations?.length}`);
  }
  console.log("✓ Receipt detail contains 2 allocations");

  // 6. Order receivables should reflect the cross-order receipt
  const orRes = await apiFetch("/api/finance/order-receivables", cookie);
  if (!orRes.ok) {
    throw new Error(`Order receivables failed: ${orRes.status}`);
  }
  const orData = await orRes.json();
  const or1 = orData.orders.find((i: { id: string }) => i.id === order1.id);
  const or2 = orData.orders.find((i: { id: string }) => i.id === order2.id);
  if (!or1 || or1.receivedAmount < 300 - 0.001) {
    throw new Error(`Order1 receivedAmount missing or too low: ${or1?.receivedAmount}`);
  }
  if (!or2 || or2.receivedAmount < 500 - 0.001) {
    throw new Error(`Order2 receivedAmount missing or too low: ${or2?.receivedAmount}`);
  }
  console.log("✓ Order receivables reflected cross-order allocation");

  // Cleanup
  await prisma.financeReceiptAllocation.deleteMany({ where: { receiptId } });
  await prisma.financeReceipt.delete({ where: { id: receiptId } });
  await prisma.externalOrderInvoiceRequest.deleteMany({ where: { id: { in: [inv1.id, inv2.id] } } });
  await prisma.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();

  console.log("\n=== RESULTS: all retrieval checks passed ===");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
