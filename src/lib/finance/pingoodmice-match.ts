import { prisma } from "@/lib/prisma";
import type { MatchResult, MatchScanResult } from "./types";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";

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

  const allCustomers = await prisma.customer.findMany({
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

  const allOrganizations = await prisma.organization.findMany({
    select: {
      id: true,
      canonicalName: true,
      normalizedName: true,
      aliases: { select: { alias: true } },
    },
  });

  function matchOrgAgainstOrderAddress(orderAddress: string | null, storeName: string | null): string | null {
    const addrNorm = normalizeText(orderAddress);
    const storeNorm = normalizeText(storeName);

    // Priority 1: Check if any Organization canonicalName or alias appears in the address
    for (const org of allOrganizations) {
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
    // Combine all org name sources: customer.organization + org.canonicalName + org.normalizedName
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

  let matched = 0;
  let conflicted = 0;
  let unmatched = 0;
  const details: MatchResult[] = [];

  for (const order of orders) {
    if (order.customerId) continue;

    const orderOrgFromAddress = matchOrgAgainstOrderAddress(order.buyerAddressSnapshot, order.buyerOrgNameSnapshot);

    const candidates: Array<{ customerId: string; name: string; score: number; reason: string }> = [];

    for (const cust of allCustomers) {
      let score = 0;
      let reason = "";

      // Layer 1: Wechat match
      const orderUserNorm = normalizeText(order.buyerWechatSnapshot);
      const wechatNorm = normalizeText(cust.wechat);
      if (orderUserNorm && wechatNorm && orderUserNorm === wechatNorm) {
        score = 100;
        reason = "wechat_exact_match";
      }

      // Layer 2: Phone match
      if (score === 0 && order.buyerPhoneSnapshot) {
        const orderPhone = normalizePhone(order.buyerPhoneSnapshot);
        const principalPhones = extractPhones(cust.principal);
        if (orderPhone && principalPhones.some((p) => normalizePhone(p) === orderPhone)) {
          score = 95;
          reason = "phone_match_in_principal";
        }
      }

      // Layer 3: Name + Organization match (org from address, not storeName)
      if (score === 0 && orderOrgFromAddress) {
        const orderName = normalizeText(order.buyerNameSnapshot);
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
        const orderName = normalizeText(order.buyerNameSnapshot);
        const custName = normalizeText(cust.name);
        const orderAddr = normalizeText(order.buyerAddressSnapshot);
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

    if (candidates.length === 0) {
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
    } else if (
      candidates.length === 1 ||
      candidates[0].score - candidates[1].score >= 10
    ) {
      const best = candidates[0];
      await prisma.$transaction(async (tx) => {
        const resolvedRep = await resolveCustomerRepresentative(best.customerId, tx);
        await tx.order.update({
          where: { id: order.id },
          data: {
            customerId: best.customerId,
            representativeId: resolvedRep.representativeId,
            customerMatchStatus: "AUTO_MATCHED",
            customerMatchScore: best.score,
            customerMatchReason: best.reason,
          },
        });
      });
      matched++;
      details.push({
        orderId: order.id,
        externalOrderNo: order.externalOrderNo ?? "",
        status: "MATCHED",
        score: best.score,
        matchedCustomerId: best.customerId,
        matchedCustomerName: best.name,
        reason: best.reason,
      });
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          representativeId: null,
          customerMatchStatus: "CONFLICT",
          customerMatchScore: candidates[0].score,
          customerMatchReason: JSON.stringify(
            candidates.slice(0, 3).map((c) => ({
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
        score: candidates[0].score,
        matchedCustomerId: null,
        matchedCustomerName: null,
        reason: "multiple_candidates",
        candidates: candidates.slice(0, 3).map((c) => ({
          customerId: c.customerId,
          name: c.name,
          score: c.score,
        })),
      });
    }
  }

  return { scanned: orders.length, matched, conflicted, unmatched, details };
}
