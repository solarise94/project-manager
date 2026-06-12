import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadFinance, getFinanceCustomerScopeWhere } from "@/lib/finance/permissions";
import { collectByChunks } from "@/lib/finance/query-chunk";

const MAX_RESULTS = 20;
const MAX_N_FOR_EXACT = 40;
const MAX_T_FOR_DP = 10_000_000; // 10 million cents = 100,000 yuan

interface CandidateInvoice {
  id: string;
  invoiceNo: string | null;
  totalAmount: number;
  outstanding: number;
  issuedAt: string | null;
  orderId: string | null;
  buyerOrganizationName: string;
}

interface Combination {
  invoiceIds: string[];
  amounts: number[];
  sum: number;
  count: number;
  crossOrder: boolean;
  orderBreakdown: Array<{ orderId: string; sum: number }>;
}

interface MatchResult {
  status: "MATCHED" | "NO_EXACT_MATCH";
  reason?: "SUM_SHORTFALL" | "NO_SUBSET_EQUALS";
  organization: { id: string; canonicalName: string };
  candidateInvoices: CandidateInvoice[];
  orphanInvoiceCount: number;
  excludedCoveredInvoiceCount: number;
  excludedNonIssuedInvoiceCount: number;
  excludedFullyAllocatedInvoiceCount: number;
  candidateTotal: number;
  combinations?: Combination[];
  nearestBelow?: { sum: number; delta: number; count: number };
  nearestAbove?: { sum: number; delta: number; count: number };
  degraded: boolean;
  truncated?: boolean;
  totalCombinations?: number;
}

// ─── Combination Algorithm ──────────────────────────────────────

function findExactCombinations(
  items: { id: string; amount: number }[],
  targetCents: number,
): { combinations: string[][]; degraded: boolean; truncated: boolean; totalFound: number } {
  const n = items.length;
  if (n === 0) return { combinations: [], degraded: false, truncated: false, totalFound: 0 };

  const amounts = items.map((it) => it.amount);

  // suffixSum[i] = sum of items[i..n)
  const suffixSum = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    suffixSum[i] = suffixSum[i + 1] + amounts[i];
  }

  // suffixPossible[i][s] = can we make sum s from items[i..)?
  // Use Uint8Array for memory efficiency
  let suffixPossible: Uint8Array[] | null = null;
  let degraded = false;

  if (n <= MAX_N_FOR_EXACT && targetCents <= MAX_T_FOR_DP) {
    const memEstimate = (n + 1) * (targetCents + 1); // bytes
    if (memEstimate <= 200_000_000) {
      // ~200 MB max
      suffixPossible = new Array(n + 1);
      suffixPossible[n] = new Uint8Array(targetCents + 1);
      suffixPossible[n][0] = 1;

      for (let i = n - 1; i >= 0; i--) {
        const cur = new Uint8Array(targetCents + 1);
        const next = suffixPossible[i + 1]!;
        const amt = amounts[i];
        for (let s = 0; s <= targetCents; s++) {
          if (next[s]) {
            cur[s] = 1;
          } else if (s >= amt && next[s - amt]) {
            cur[s] = 1;
          }
        }
        suffixPossible[i] = cur;
      }
    } else {
      degraded = true;
    }
  } else {
    degraded = true;
  }

  const results: string[][] = [];
  let truncated = false;
  const path: string[] = [];

  function dfs(i: number, remain: number) {
    if (remain === 0) {
      results.push([...path]);
      return;
    }
    if (results.length >= MAX_RESULTS) {
      truncated = true;
      return;
    }
    if (i >= n) return;
    if (suffixSum[i] < remain) return;

    if (suffixPossible && !degraded) {
      if (!suffixPossible[i]![remain]) return;
    }

    // Skip items[i]
    dfs(i + 1, remain);

    // Take items[i]
    if (remain >= amounts[i]) {
      path.push(items[i].id);
      dfs(i + 1, remain - amounts[i]);
      path.pop();
    }
  }

  dfs(0, targetCents);

  return { combinations: results, degraded, truncated, totalFound: results.length };
}

function findNearestCombinations(
  items: { id: string; amount: number }[],
  targetCents: number,
): { below: { ids: string[]; sum: number } | null; above: { ids: string[]; sum: number } | null } {
  const n = items.length;
  if (n === 0) return { below: null, above: null };

  const amounts = items.map((it) => it.amount);

  // 1D DP to find best "at most" and "at least"
  // dp[s] = whether sum s achievable
  const dp = new Uint8Array(targetCents + 1);
  dp[0] = 1;

  let maxAchievable = 0;
  for (let i = 0; i < n; i++) {
    const amt = amounts[i];
    for (let s = targetCents; s >= amt; s--) {
      if (dp[s - amt]) {
        dp[s] = 1;
        if (s > maxAchievable) maxAchievable = s;
      }
    }
  }

  // Find "nearest below"
  let belowSum = 0;
  for (let s = targetCents; s >= 0; s--) {
    if (dp[s]) {
      belowSum = s;
      break;
    }
  }

  // Find "nearest above" - extend DP past target
  const totalSum = amounts.reduce((a, b) => a + b, 0);
  const extendedTarget = Math.min(totalSum, targetCents * 2);
  const edp = new Uint8Array(extendedTarget + 1);
  edp[0] = 1;
  for (let i = 0; i < n; i++) {
    const amt = amounts[i];
    for (let s = extendedTarget; s >= amt; s--) {
      if (edp[s - amt]) edp[s] = 1;
    }
  }

  let aboveSum = -1;
  for (let s = targetCents; s <= extendedTarget; s++) {
    if (edp[s]) {
      aboveSum = s;
      break;
    }
  }

  return {
    below: belowSum > 0 ? extractOneCombination(items, belowSum) : null,
    above: aboveSum > 0 ? extractOneCombination(items, aboveSum) : null,
  };
}

/**
 * Extract ONE combination that sums to `target` using proper DP backtracking.
 * Uses a parent-link array during DP to guarantee reconstruction always succeeds
 * for any reachable sum. Avoids the greedy-approximation bug where valid sums
 * like [4,3,3] → 6 would fail to extract.
 */
function extractOneCombination(
  items: { id: string; amount: number }[],
  target: number,
): { ids: string[]; sum: number } | null {
  if (target <= 0) return null;
  const n = items.length;
  // parent[s] = index i of the item that was last added to reach sum s, or -1
  const parent = new Int32Array(target + 1).fill(-1);
  const dp = new Uint8Array(target + 1);
  dp[0] = 1;

  for (let i = 0; i < n; i++) {
    const amt = items[i].amount;
    for (let s = target; s >= amt; s--) {
      if (dp[s - amt] && !dp[s]) {
        dp[s] = 1;
        parent[s] = i;
      }
    }
    if (dp[target]) break; // early exit once reachable
  }

  if (!dp[target]) return null;

  // Reconstruct
  const ids: string[] = [];
  let s = target;
  while (s > 0) {
    const i = parent[s];
    if (i < 0) break; // shouldn't happen for reachable sums
    ids.push(items[i].id);
    s -= items[i].amount;
  }
  return { ids, sum: target };
}

function buildOrderBreakdown(
  invoiceIds: string[],
  amounts: number[],
  invoiceMap: Map<string, CandidateInvoice>,
): Array<{ orderId: string; sum: number }> {
  const orderSums = new Map<string, number>();
  for (let i = 0; i < invoiceIds.length; i++) {
    const inv = invoiceMap.get(invoiceIds[i]);
    const oid = inv?.orderId || "__unknown__";
    orderSums.set(oid, (orderSums.get(oid) || 0) + amounts[i]);
  }
  return Array.from(orderSums.entries()).map(([orderId, sum]) => ({ orderId, sum }));
}

// ─── GET / POST handler ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canReadFinance(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { organizationId?: string; amount?: number; receivedAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { organizationId, amount } = body;

  if (!organizationId || typeof organizationId !== "string") {
    return NextResponse.json({ error: "organizationId 必填" }, { status: 400 });
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "凭证金额必须大于 0" }, { status: 400 });
  }

  // Validate organization exists
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, canonicalName: true },
  });
  if (!org) {
    return NextResponse.json({ error: "机构不存在" }, { status: 404 });
  }

  const targetCents = Math.round(amount * 100);

  // 1. Get customer scope
  const customerScope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);
  const scopedCustomerIds: string[] | null = customerScope?.id?.in ?? null;

  // 2. Count orphan invoices — invoices in user's scope that lack buyerOrganizationId.
  //    Use the same customer scope as the candidate query so the count is actionable.
  const orphanInvoiceCount = await prisma.externalOrderInvoiceRequest.count({
    where: {
      AND: [
        { buyerOrganizationId: null },
        { status: "ISSUED" },
        { adjustmentsAsOriginal: { none: { kind: "RED" } } },
        { totalAmount: { gt: 0 } },
        scopedCustomerIds
          ? {
              OR: [
                { order: { customerId: { in: scopedCustomerIds } } },
                { externalOrder: { customerId: { in: scopedCustomerIds } } },
              ],
            }
          : {},
      ],
    },
  });

  // 3. Count excluded covered invoices (any orderCoverage means multi-order
  //    coverage, which Phase 1 explicitly excludes per §1.1 S5 / §3.1).
  const excludedCoveredInvoiceCount = await prisma.externalOrderInvoiceRequest.count({
    where: {
      AND: [
        { buyerOrganizationId: organizationId },
        { status: "ISSUED" },
        { adjustmentsAsOriginal: { none: { kind: "RED" } } },
        { totalAmount: { gt: 0 } },
        { orderCoverage: { some: {} } },
        scopedCustomerIds
          ? {
              OR: [
                { order: { customerId: { in: scopedCustomerIds } } },
                { externalOrder: { customerId: { in: scopedCustomerIds } } },
              ],
            }
          : {},
      ],
    },
  });

  // 3b. Count non-ISSUED invoices for this org (DRAFT, REQUESTED, CANCELLED)
  const excludedNonIssuedInvoiceCount = await prisma.externalOrderInvoiceRequest.count({
    where: {
      AND: [
        { buyerOrganizationId: organizationId },
        { status: { not: "ISSUED" } },
        { totalAmount: { gt: 0 } },
        scopedCustomerIds
          ? {
              OR: [
                { order: { customerId: { in: scopedCustomerIds } } },
                { externalOrder: { customerId: { in: scopedCustomerIds } } },
              ],
            }
          : {},
      ],
    },
  });

  // 4. Query candidate invoices.
  //    Phase 1 only supports direct-order invoices with no orderCoverage.
  const candidateInvoicesRaw = await prisma.externalOrderInvoiceRequest.findMany({
    where: {
      AND: [
        { buyerOrganizationId: organizationId },
        { status: "ISSUED" },
        { adjustmentsAsOriginal: { none: { kind: "RED" } } },
        { totalAmount: { gt: 0 } },
        { orderId: { not: null } },
        { orderCoverage: { none: {} } },
        scopedCustomerIds
          ? {
              OR: [
                { order: { customerId: { in: scopedCustomerIds } } },
                { externalOrder: { customerId: { in: scopedCustomerIds } } },
              ],
            }
          : {},
      ],
    },
    select: {
      id: true,
      actualInvoiceNo: true,
      totalAmount: true,
      actualIssuedAt: true,
      orderId: true,
      buyerOrganizationName: true,
    },
    orderBy: { actualIssuedAt: { sort: "asc", nulls: "last" } },
  });

  // 5. Compute outstanding amounts
  const candidateIds = candidateInvoicesRaw.map((inv) => inv.id);

  // New allocation-based
  const allocationsAgg = candidateIds.length > 0
    ? await collectByChunks(candidateIds, (chunk) =>
        prisma.financeReceiptAllocation.groupBy({
          by: ["invoiceId"],
          where: {
            invoiceId: { in: chunk },
            receipt: { deleted: false },
          },
          _sum: { amount: true },
        })
      )
    : [];

  // Legacy 1-to-1
  const legacyReceiptsAgg = candidateIds.length > 0
    ? await collectByChunks(candidateIds, (chunk) =>
        prisma.financeReceipt.groupBy({
          by: ["externalOrderInvoiceRequestId"],
          where: {
            externalOrderInvoiceRequestId: { in: chunk },
            deleted: false,
          },
          _sum: { amount: true },
        })
      )
    : [];

  const allocatedMap = new Map<string, number>();
  for (const a of allocationsAgg) {
    allocatedMap.set(a.invoiceId, (allocatedMap.get(a.invoiceId) || 0) + (a._sum.amount || 0));
  }
  for (const l of legacyReceiptsAgg) {
    if (l.externalOrderInvoiceRequestId) {
      allocatedMap.set(
        l.externalOrderInvoiceRequestId,
        (allocatedMap.get(l.externalOrderInvoiceRequestId) || 0) + (l._sum.amount || 0),
      );
    }
  }

  let excludedFullyAllocatedInvoiceCount = 0;
  const candidateInvoices: CandidateInvoice[] = [];
  for (const inv of candidateInvoicesRaw) {
    const allocated = allocatedMap.get(inv.id) || 0;
    const outstanding = Math.max(inv.totalAmount - allocated, 0);
    if (outstanding > 0) {
      candidateInvoices.push({
        id: inv.id,
        invoiceNo: inv.actualInvoiceNo,
        totalAmount: inv.totalAmount,
        outstanding: Math.round(outstanding * 100) / 100,
        issuedAt: inv.actualIssuedAt?.toISOString() ?? null,
        orderId: inv.orderId,
        buyerOrganizationName: inv.buyerOrganizationName,
      });
    } else {
      excludedFullyAllocatedInvoiceCount++;
    }
  }

  const candidateTotal = candidateInvoices.reduce((s, inv) => s + inv.outstanding, 0);

  // 6. Quick SUM_SHORTFALL check
  const candidateTotalCents = Math.round(candidateTotal * 100);
  if (candidateTotalCents < targetCents) {
    return NextResponse.json({
      status: "NO_EXACT_MATCH",
      reason: "SUM_SHORTFALL",
      organization: { id: org.id, canonicalName: org.canonicalName },
      candidateInvoices,
      orphanInvoiceCount,
      excludedCoveredInvoiceCount,
      excludedNonIssuedInvoiceCount,
      excludedFullyAllocatedInvoiceCount,
      candidateTotal: Math.round(candidateTotal * 100) / 100,
      nearestBelow: {
        sum: Math.round(candidateTotal * 100) / 100,
        delta: Math.round((candidateTotal - amount) * 100) / 100,
        count: candidateInvoices.length,
      },
      degraded: false,
    } as MatchResult, { status: 200 });
  }

  // 7. Run combination algorithm
  // Sort by amount ascending (for better DP pruning)
  const items = candidateInvoices
    .map((inv) => ({ id: inv.id, amount: Math.round(inv.outstanding * 100) }))
    .sort((a, b) => a.amount - b.amount);

  const exactResult = findExactCombinations(items, targetCents);

  if (exactResult.combinations.length > 0) {
    // Build combinations output
    const invoiceMap = new Map(candidateInvoices.map((inv) => [inv.id, inv]));
    const combinations: Combination[] = exactResult.combinations.map((ids) => {
      const amounts = ids.map((id) => invoiceMap.get(id)!.outstanding);
      const sum = amounts.reduce((a, b) => a + b, 0);
      const orderIds = new Set(ids.map((id) => invoiceMap.get(id)!.orderId));
      const crossOrder = orderIds.size > 1;
      const orderBreakdown = buildOrderBreakdown(ids, amounts, invoiceMap);
      return {
        invoiceIds: ids,
        amounts: amounts.map((a) => Math.round(a * 100) / 100),
        sum: Math.round(sum * 100) / 100,
        count: ids.length,
        crossOrder,
        orderBreakdown: orderBreakdown.map((ob) => ({
          orderId: ob.orderId,
          sum: Math.round(ob.sum * 100) / 100,
        })),
      };
    });

    // Sort: fewer invoices first, then prefer older invoices (FIFO)
    combinations.sort((a, b) => {
      if (a.count !== b.count) return a.count - b.count;
      const minA = Math.min(
        ...a.invoiceIds.map((id) => invoiceMap.get(id)!.issuedAt ? new Date(invoiceMap.get(id)!.issuedAt!).getTime() : Infinity),
      );
      const minB = Math.min(
        ...b.invoiceIds.map((id) => invoiceMap.get(id)!.issuedAt ? new Date(invoiceMap.get(id)!.issuedAt!).getTime() : Infinity),
      );
      return minA - minB;
    });

    return NextResponse.json({
      status: "MATCHED",
      organization: { id: org.id, canonicalName: org.canonicalName },
      candidateInvoices,
      orphanInvoiceCount,
      excludedCoveredInvoiceCount,
      excludedNonIssuedInvoiceCount,
      excludedFullyAllocatedInvoiceCount,
      candidateTotal: Math.round(candidateTotal * 100) / 100,
      combinations,
      degraded: exactResult.degraded,
      truncated: exactResult.truncated,
      totalCombinations: exactResult.totalFound,
    } as MatchResult);
  }

  // 8. No exact match — compute nearest neighbors (only when DP is feasible)
  const result: MatchResult = {
    status: "NO_EXACT_MATCH",
    reason: "NO_SUBSET_EQUALS",
    organization: { id: org.id, canonicalName: org.canonicalName },
    candidateInvoices,
    orphanInvoiceCount,
    excludedCoveredInvoiceCount,
    excludedNonIssuedInvoiceCount,
    excludedFullyAllocatedInvoiceCount,
    candidateTotal: Math.round(candidateTotal * 100) / 100,
    degraded: exactResult.degraded,
  };

  const canComputeNearest =
    targetCents <= MAX_T_FOR_DP &&
    items.length <= MAX_N_FOR_EXACT &&
    (items.length + 1) * (targetCents + 1) <= 200_000_000;

  if (canComputeNearest) {
    const nearest = findNearestCombinations(items, targetCents);
    if (nearest.below) {
      result.nearestBelow = {
        sum: nearest.below.sum / 100,
        delta: (nearest.below.sum - targetCents) / 100,
        count: nearest.below.ids.length,
      };
    }
    if (nearest.above) {
      result.nearestAbove = {
        sum: nearest.above.sum / 100,
        delta: (nearest.above.sum - targetCents) / 100,
        count: nearest.above.ids.length,
      };
    }
  } else {
    result.degraded = true;
  }

  return NextResponse.json(result);
}
