function normalizeText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, "").toLowerCase();
}

function normalizePhone(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/[^\d]/g, "");
}

function extractPhones(principal: unknown): string[] {
  if (typeof principal !== "string" || !principal) return [];
  return [normalizePhone(principal)];
}

export interface MatchInput {
  buyerName?: string | null;
  buyerPhone?: string | null;
  buyerWechat?: string | null;
  buyerOrgName?: string | null;
  buyerAddress?: string | null;
}

export interface MatchCandidate {
  id: string;
  name: string;
  wechat: string | null;
  principal: string | null;
  organization: string | null;
  address: string | null;
  orgCanonicalName?: string | null;
  orgNormalizedName?: string | null;
  orgAliases?: string[];
}

export interface MatchResult {
  customerId: string;
  score: number;
  reason: string;
}

export function matchImportRow(
  input: MatchInput,
  candidates: MatchCandidate[],
): MatchResult | null {
  let best: MatchResult | null = null;

  for (const cust of candidates) {
    let score = 0;
    let reason = "";

    // Layer 1: Wechat exact match (highest confidence)
    const inputWechat = normalizeText(input.buyerWechat);
    const custWechat = normalizeText(cust.wechat);
    if (inputWechat && custWechat && inputWechat === custWechat) {
      score = 100;
      reason = "wechat_exact_match";
    }

    // Layer 2: Phone match in principal
    if (score === 0 && input.buyerPhone) {
      const inputPhone = normalizePhone(input.buyerPhone);
      const principalPhones = extractPhones(cust.principal);
      if (inputPhone && principalPhones.some((p) => normalizePhone(p) === inputPhone)) {
        score = 95;
        reason = "phone_match_in_principal";
      }
    }

    // Layer 3: Name + Organization match
    if (score === 0) {
      const inputName = normalizeText(input.buyerName);
      const custName = normalizeText(cust.name);
      if (inputName && custName && inputName === custName) {
        const inputOrg = normalizeText(input.buyerOrgName || input.buyerAddress);
        const custOrgVariants = [
          normalizeText(cust.organization),
          normalizeText(cust.orgCanonicalName),
          normalizeText(cust.orgNormalizedName),
          ...(cust.orgAliases || []).map((a) => normalizeText(a)),
        ].filter(Boolean);

        if (inputOrg && custOrgVariants.some((v) => v === inputOrg)) {
          score = 80;
          reason = "name_org_exact";
        } else if (inputOrg && custOrgVariants.some((v) => inputOrg.includes(v) || v.includes(inputOrg))) {
          score = 70;
          reason = "name_org_partial";
        }
      }
    }

    // Layer 4: Name + Address match
    if (score === 0) {
      const inputName = normalizeText(input.buyerName);
      const custName = normalizeText(cust.name);
      const inputAddr = normalizeText(input.buyerAddress);
      const custAddr = normalizeText(cust.address);

      const nameExact = inputName && custName && inputName === custName;
      const addrOverlap = inputAddr && custAddr && (inputAddr.includes(custAddr.substring(0, Math.max(4, Math.floor(custAddr.length * 0.5)))) || custAddr.includes(inputAddr.substring(0, Math.max(4, Math.floor(inputAddr.length * 0.5)))));

      if (nameExact && addrOverlap) {
        score = 70;
        reason = "name_exact_address_overlap";
      } else if (nameExact) {
        score = 60;
        reason = "name_exact_only";
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { customerId: cust.id, score, reason };
    }
  }

  return best;
}
