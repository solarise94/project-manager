import { prisma } from "@/lib/prisma";
import type { MatchResult, MatchScanResult } from "./types";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D/g, "");
}

function extractPhones(s: string | null | undefined): string[] {
  if (!s) return [];
  const phoneRegex = /1[3-9]\d{9}/g;
  return s.match(phoneRegex) || [];
}

// ─── Data Loading ──────────────────────────────────────────────────────────────

async function loadMatchCustomers() {
  return prisma.customer.findMany({
    where: { deleted: false },
    select: {
      id: true,
      name: true,
      wechat: true,
      principal: true,
      organization: true,
      address: true,
      organizationId: true,
      org: { select: { canonicalName: true, normalizedName: true, aliases: { select: { alias: true } } } },
    },
  });
}

async function loadMatchOrganizations() {
  return prisma.organization.findMany({
    select: {
      id: true,
      canonicalName: true,
      normalizedName: true,
      aliases: { select: { alias: true } },
    },
  });
}

type MatchCustomer = Awaited<ReturnType<typeof loadMatchCustomers>>[number];
type MatchOrganization = Awaited<ReturnType<typeof loadMatchOrganizations>>[number];

// ─── MatchContext ──────────────────────────────────────────────────────────────

export interface MatchContext {
  customers: MatchCustomer[];
  organizations: MatchOrganization[];
  wechatIndex: Map<string, string[]>;
  phoneIndex: Map<string, string[]>;
}

function pushIndex(map: Map<string, string[]>, key: string, customerId: string) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(customerId)) list.push(customerId);
  } else {
    map.set(key, [customerId]);
  }
}

export async function createMatchContext(): Promise<MatchContext> {
  const [customers, organizations] = await Promise.all([
    loadMatchCustomers(),
    loadMatchOrganizations(),
  ]);

  const wechatIndex = new Map<string, string[]>();
  const phoneIndex = new Map<string, string[]>();

  for (const customer of customers) {
    const wechat = normalizeText(customer.wechat);
    if (wechat) {
      pushIndex(wechatIndex, wechat, customer.id);
    }

    for (const rawPhone of extractPhones(customer.principal)) {
      const phone = normalizePhone(rawPhone);
      if (phone) {
        pushIndex(phoneIndex, phone, customer.id);
      }
    }
  }

  return { customers, organizations, wechatIndex, phoneIndex };
}

// ─── Pure Matching Helpers ─────────────────────────────────────────────────────

function matchOrgAgainstOrderAddress(
  organizations: MatchOrganization[],
  orderAddress: string | null,
  storeName: string | null,
): string | null {
  const addrNorm = normalizeText(orderAddress);
  const storeNorm = normalizeText(storeName);

  // Priority 1: Check if any Organization canonicalName or alias appears in the address
  for (const org of organizations) {
    const names = [org.canonicalName, org.normalizedName, ...(org.aliases || []).map((a) => a.alias)]
      .filter(Boolean)
      .map((n) => normalizeText(n!));
    for (const name of names) {
      if (name && name.length >= 4 && addrNorm.includes(name)) {
        return org.canonicalName;
      }
    }
  }

  // Priority 2: Extract university/company name patterns from address
  const uniMatch = addrNorm.match(/([一-龥]+大学)/);
  if (uniMatch) return uniMatch[1];

  const instMatch = addrNorm.match(/([一-龥]+研究所)/);
  if (instMatch) return instMatch[1];

  const hospitalMatch = addrNorm.match(/([一-龥]+医院)/);
  if (hospitalMatch) return hospitalMatch[1];

  const companyMatch = addrNorm.match(/([一-龥]+公司)/);
  if (companyMatch) return companyMatch[1];

  // Priority 3 (weak): storeName as fallback
  if (storeNorm && storeNorm.length >= 4) return storeNorm;

  return null;
}

function matchOrgName(
  orderOrg: string,
  custOrg: string | null,
  custOrgCanonical: string | null | undefined,
  custOrgNormalized: string | null | undefined,
  custOrgAliases: string[],
): { score: number; reason: string } | null {
  const orderOrgNorm = normalizeText(orderOrg);
  const allCustOrgNorms = [
    normalizeText(custOrg),
    normalizeText(custOrgCanonical),
    normalizeText(custOrgNormalized),
    ...custOrgAliases.map((a) => normalizeText(a)),
  ].filter(Boolean);

  if (!orderOrgNorm) return null;

  const exactMatch = allCustOrgNorms.some((n) => n === orderOrgNorm);
  const partialMatch = allCustOrgNorms.some(
    (n) => orderOrgNorm.includes(n) || n.includes(orderOrgNorm),
  );

  if (exactMatch) return { score: 80, reason: "name_org_exact_via_address" };
  if (partialMatch) return { score: 70, reason: "name_org_partial_via_address" };
  return null;
}

// ─── Core Matcher ──────────────────────────────────────────────────────────────

export interface ResolvedCandidate {
  customerId: string;
  name: string;
  score: number;
  reason: string;
}

export interface MatchResolution {
  candidates: ResolvedCandidate[];
  best: ResolvedCandidate | null;
  status: "MATCHED" | "CONFLICT" | "UNMATCHED";
}

export function resolveMatch(
  ctx: MatchContext,
  params: {
    buyerPhone?: string | null;
    buyerWechat?: string | null;
    buyerName?: string | null;
    buyerAddress?: string | null;
    buyerOrgName?: string | null;
  },
): MatchResolution {
  // Pre-compute order-side normalized values once
  const wechatNorm = normalizeText(params.buyerWechat);
  const phoneNorm = params.buyerPhone ? normalizePhone(params.buyerPhone) : "";
  const orderName = normalizeText(params.buyerName);
  const orderAddr = normalizeText(params.buyerAddress);
  const orderOrgFromAddress = matchOrgAgainstOrderAddress(
    ctx.organizations,
    params.buyerAddress ?? null,
    params.buyerOrgName ?? null,
  );

  // Iterate ALL customers, per-customer layer priority (identical to old logic).
  // Each customer gets at most one entry at their highest-scoring layer.
  const candidates: ResolvedCandidate[] = [];

  for (const cust of ctx.customers) {
    let score = 0;
    let reason = "";

    // Layer 1: Wechat match — fast check via index
    if (wechatNorm) {
      const hitIds = ctx.wechatIndex.get(wechatNorm);
      if (hitIds?.includes(cust.id)) {
        score = 100;
        reason = "wechat_exact_match";
      }
    }

    // Layer 2: Phone match (only if Layer 1 didn't match this customer)
    if (score === 0 && phoneNorm) {
      const hitIds = ctx.phoneIndex.get(phoneNorm);
      if (hitIds?.includes(cust.id)) {
        score = 95;
        reason = "phone_match_in_principal";
      }
    }

    // Layer 3: Name + Organization match
    if (score === 0 && orderOrgFromAddress) {
      const custName = normalizeText(cust.name);
      const custAliases = (cust.org?.aliases || []).map((a) => a.alias).filter(Boolean) as string[];

      if (orderName && custName && orderName === custName) {
        const orgMatch = matchOrgName(
          orderOrgFromAddress,
          cust.organization,
          cust.org?.canonicalName,
          cust.org?.normalizedName,
          custAliases,
        );
        if (orgMatch) {
          score = orgMatch.score;
          reason = orgMatch.reason;
        }
      }
    }

    // Layer 4: Name + Address match
    if (score === 0) {
      const custName = normalizeText(cust.name);
      const custAddr = normalizeText(cust.address);

      const nameExact = orderName && custName && orderName === custName;
      const addrOverlap = orderAddr && custAddr && (
        orderAddr.includes(custAddr.substring(0, Math.max(4, Math.floor(custAddr.length * 0.5)))) ||
        custAddr.includes(orderAddr.substring(0, Math.max(4, Math.floor(orderAddr.length * 0.5))))
      );

      if (nameExact && addrOverlap) {
        score = 70;
        reason = "name_exact_address_overlap";
      } else if (nameExact) {
        score = 60;
        reason = "name_exact_only";
      }
    }

    if (score >= 60) {
      candidates.push({ customerId: cust.id, name: cust.name, score, reason });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  const secondBest = candidates[1];
  const status =
    !best ? "UNMATCHED"
    : !secondBest || best.score - secondBest.score >= 10 ? "MATCHED"
    : "CONFLICT";

  return { candidates, best, status };
}

// ─── Adapter: scanPingoodmiceMatch ─────────────────────────────────────────────

export async function scanPingoodmiceMatch(params: {
  buyerPhone?: string | null;
  buyerWechat?: string | null;
  buyerName?: string | null;
  buyerAddress?: string | null;
  buyerOrgName?: string | null;
}): Promise<{ customerId: string; matchMethod: string } | null> {
  const ctx = await createMatchContext();
  const result = resolveMatch(ctx, params);
  if (result.status !== "MATCHED" || !result.best) return null;
  return { customerId: result.best.customerId, matchMethod: result.best.reason };
}

// ─── Adapter: matchSourceOrders ────────────────────────────────────────────────

export async function matchSourceOrders(source: string, orderIds?: string[]): Promise<MatchScanResult> {
  const baseWhere: Record<string, unknown> = orderIds?.length
    ? { id: { in: orderIds }, deleted: false }
    : { source, customerMatchStatus: "UNMATCHED", deleted: false, mergeSources: { none: {} } };

  const orders = await prisma.order.findMany({
    where: baseWhere,
    select: {
      id: true,
      externalOrderNo: true,
      buyerNameSnapshot: true,
      buyerPhoneSnapshot: true,
      buyerAddressSnapshot: true,
      buyerWechatSnapshot: true,
      buyerOrgNameSnapshot: true,
      customerId: true,
    },
  });

  const ctx = await createMatchContext();

  let matched = 0;
  let conflicted = 0;
  let unmatched = 0;
  const details: MatchResult[] = [];

  for (const order of orders) {
    if (order.customerId) continue;

    const result = resolveMatch(ctx, {
      buyerPhone: order.buyerPhoneSnapshot,
      buyerWechat: order.buyerWechatSnapshot,
      buyerName: order.buyerNameSnapshot,
      buyerAddress: order.buyerAddressSnapshot,
      buyerOrgName: order.buyerOrgNameSnapshot,
    });

    if (result.status === "UNMATCHED") {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          representativeId: null,
          customerMatchStatus: "UNMATCHED",
          customerMatchScore: null,
          customerMatchReason: null,
        },
      });
      unmatched++;
      details.push({
        orderId: order.id,
        externalOrderNo: order.externalOrderNo ?? "",
        status: "UNMATCHED",
        score: null,
        matchedCustomerId: null,
        matchedCustomerName: null,
        reason: null,
      });
    } else if (result.status === "MATCHED" && result.best) {
      await prisma.$transaction(async (tx) => {
        const resolvedRep = await resolveCustomerRepresentative(result.best!.customerId, tx);
        await tx.order.update({
          where: { id: order.id },
          data: {
            customerId: result.best!.customerId,
            representativeId: resolvedRep.representativeId,
            customerMatchStatus: "AUTO_MATCHED",
            customerMatchScore: result.best!.score,
            customerMatchReason: result.best!.reason,
          },
        });
      });
      matched++;
      details.push({
        orderId: order.id,
        externalOrderNo: order.externalOrderNo ?? "",
        status: "MATCHED",
        score: result.best.score,
        matchedCustomerId: result.best.customerId,
        matchedCustomerName: result.best.name,
        reason: result.best.reason,
      });
    } else {
      // CONFLICT
      await prisma.order.update({
        where: { id: order.id },
        data: {
          representativeId: null,
          customerMatchStatus: "CONFLICT",
          customerMatchScore: result.candidates[0].score,
          customerMatchReason: JSON.stringify(
            result.candidates.slice(0, 3).map((c) => ({
              id: c.customerId,
              name: c.name,
              score: c.score,
            }))
          ),
        },
      });
      conflicted++;
      details.push({
        orderId: order.id,
        externalOrderNo: order.externalOrderNo ?? "",
        status: "CONFLICT",
        score: result.candidates[0].score,
        matchedCustomerId: null,
        matchedCustomerName: null,
        reason: "multiple_candidates",
        candidates: result.candidates.slice(0, 3).map((c) => ({
          customerId: c.customerId,
          name: c.name,
          score: c.score,
        })),
      });
    }
  }

  return { scanned: orders.length, matched, conflicted, unmatched, details };
}
