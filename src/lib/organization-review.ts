import { prisma } from "@/lib/prisma";
import type { ResolveResult } from "@/lib/organization-resolver";

interface CreateReviewTaskParams {
  rawInput: string;
  resolveResult: ResolveResult;
  sourceType: "CUSTOMER_CREATE" | "CUSTOMER_EDIT" | "SMART_FILL";
  sourceId: string;
  createdBy?: string;
}

/**
 * Create or update an OrganizationReviewTask based on resolve result.
 * - If reviewRequired is false (exact match), cancels any existing PENDING tasks for this sourceId.
 * - Deduplicates: same sourceId only keeps one PENDING task (regardless of sourceType).
 */
export async function createOrganizationReviewTask(params: CreateReviewTaskParams): Promise<{ created: boolean; taskId?: string }> {
  const { rawInput, resolveResult, sourceType, sourceId, createdBy } = params;

  if (!resolveResult.reviewRequired) {
    // Exact match — cancel all stale PENDING tasks for this source entity
    await prisma.organizationReviewTask.updateMany({
      where: { sourceId, status: "PENDING" },
      data: { status: "REJECTED", reviewNote: "自动取消：已精确匹配机构" },
    });
    return { created: false };
  }

  const best = resolveResult.bestSuggestion;
  const resolutionSource = resolveResult.source === "none"
    ? null
    : resolveResult.source === "db"
      ? "DB_CANDIDATE"
      : "LLM_DB_CANDIDATE";

  const data = {
    rawInput,
    normalizedInput: resolveResult.normalizedInput,
    suggestedOrganizationId: best?.organizationId || null,
    suggestedSiteId: best?.organizationSiteId || null,
    suggestedCanonicalName: best?.canonicalName || null,
    suggestedAddress: best?.address || null,
    confidence: best?.confidence || null,
    sourceType,
    sourceId,
    createdById: createdBy || null,
    resolutionSource,
    status: "PENDING",
  };

  // Deduplicate: any PENDING task for same sourceId (regardless of sourceType)
  const existing = await prisma.organizationReviewTask.findFirst({
    where: { sourceId, status: "PENDING" },
  });

  if (existing) {
    await prisma.organizationReviewTask.update({
      where: { id: existing.id },
      data,
    });
    return { created: true, taskId: existing.id };
  }

  const task = await prisma.organizationReviewTask.create({ data });
  return { created: true, taskId: task.id };
}
