"use client";

import { STAGE_LABELS, STAGE_COLORS, IMPORTANCE_LABELS, IMPORTANCE_COLORS, FOLLOW_UP_STATUS_LABELS, FOLLOW_UP_STATUS_COLORS, RELATION_TYPE_LABELS, RELATION_TYPE_COLORS, ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_STATUS_COLORS, PERSON_CATEGORY_LABELS, PERSON_CATEGORY_COLORS, GRADUATION_STATUS_LABELS, GRADUATION_STATUS_COLORS } from "@/lib/crm/constants";

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] || "bg-gray-100 text-gray-600"}`}>
      {STAGE_LABELS[stage] || stage}
    </span>
  );
}

export function ImportanceBadge({ importance }: { importance: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${IMPORTANCE_COLORS[importance] || "bg-gray-100 text-gray-600"}`}>
      {IMPORTANCE_LABELS[importance] || importance}
    </span>
  );
}

export function FollowUpStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${FOLLOW_UP_STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
      {FOLLOW_UP_STATUS_LABELS[status] || status}
    </span>
  );
}

export function RelationTypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${RELATION_TYPE_COLORS[type] || "bg-gray-100 text-gray-600"}`}>
      {RELATION_TYPE_LABELS[type] || type}
    </span>
  );
}

export function AssignmentStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ASSIGNMENT_STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
      {ASSIGNMENT_STATUS_LABELS[status] || status}
    </span>
  );
}

export function PersonCategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PERSON_CATEGORY_COLORS[category] || "bg-gray-100 text-gray-600"}`}>
      {PERSON_CATEGORY_LABELS[category] || category}
    </span>
  );
}

export function GraduationStatusBadge({ status }: { status: string | null }) {
  if (!status || status === "NOT_APPLICABLE") return null;
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${GRADUATION_STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
      {GRADUATION_STATUS_LABELS[status] || status}
    </span>
  );
}
