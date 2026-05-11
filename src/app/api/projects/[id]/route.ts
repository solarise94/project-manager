import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadProject, canManageProject, buildProjectPermissions } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";
import { normalizeProjectType } from "@/lib/project-type";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      rep: {
        select: { id: true, name: true, email: true },
      },
      cust: {
        select: { id: true, name: true, customerCode: true, organization: true, organizationId: true, org: { select: { canonicalName: true } } },
      },
      orderLinks: {
        include: {
          order: {
            select: {
              id: true, orderNo: true, title: true, category: true, status: true,
              deliveryStatus: true, totalAmount: true, financeAmountOverride: true,
              financeTreatment: true, source: true, externalOrderNo: true,
              customer: { select: { id: true, name: true } },
              _count: { select: { projectLinks: true, invoiceRequests: true, financeCosts: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { tickets: true, comments: true, attachments: true },
      },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resolve customer organization name from relation
  const resolvedCust = project.cust
    ? (() => { const { org, ...custRest } = project.cust; return { ...custRest, organization: getCustomerOrganizationName({ organization: custRest.organization, org }) }; })()
    : null;
  const resolvedProject = { ...project, cust: resolvedCust };

  // Unified capability-based access check
  const canRead = await canReadProject(id, session.user.id, session.user.role);
  if (!canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const permissions = await buildProjectPermissions(id, session.user.id, session.user.role);

  return NextResponse.json({ project: resolvedProject, permissions });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const canManage = await canManageProject(id, session.user.id, session.user.role);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden: only ADMIN or project owner can modify projects" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, description, orderNumber, organization, client, representativeId, customerId, projectNo, status, progress, startDate, endDate, archived, projectType, projectContent, quantity, procurementSource, brand, techSupport, budgetAmount, budgetCost } = body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (projectNo !== undefined) data.projectNo = (projectNo as string)?.trim() || null;
    if (orderNumber !== undefined) data.orderNumber = orderNumber;
    if (organization !== undefined) data.organization = organization;
    if (client !== undefined) data.client = client;
    if (status !== undefined) data.status = status;
    if (progress !== undefined) data.progress = progress;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (archived !== undefined) data.archived = archived;
    if (projectType !== undefined) data.projectType = normalizeProjectType(projectType as string) || null;
    if (projectContent !== undefined) data.projectContent = projectContent || null;
    if (quantity !== undefined) data.quantity = quantity != null && quantity !== "" ? Number(quantity) : null;
    if (procurementSource !== undefined) data.procurementSource = procurementSource || null;
    if (brand !== undefined) data.brand = brand || null;
    if (techSupport !== undefined) data.techSupport = techSupport || null;
    if (budgetAmount !== undefined) data.budgetAmount = budgetAmount != null && budgetAmount !== "" ? Number(budgetAmount) : null;
    if (budgetCost !== undefined) data.budgetCost = budgetCost != null && budgetCost !== "" ? Number(budgetCost) : null;

    // customerId drives client snapshot; organization only overridden if customer has one
    if (customerId !== undefined) {
      if (customerId) {
        const cust = await prisma.customer.findUnique({
          where: { id: customerId },
          include: { org: { select: { canonicalName: true } } },
        });
        if (!cust) {
          return NextResponse.json({ error: "指定的客户不存在" }, { status: 400 });
        }
        data.customerId = customerId;
        data.client = cust.name;
        // Only override organization if customer has one; prefer canonical name from relation
        const custOrg = getCustomerOrganizationName(cust);
        if (custOrg) {
          data.organization = custOrg;
        }
      } else {
        data.customerId = null;
        data.client = null;
      }
    }

    // ── Resolve representative ──────────────────────────────────────────
    const customerTouched = customerId !== undefined;
    const normalizedCustomerId = customerTouched ? ((customerId as string) || null) : null;
    const effectiveCustomerId = customerTouched ? normalizedCustomerId : existing.customerId;

    if (effectiveCustomerId) {
      // Customer exists — force CRM owner, ignore any passed representativeId
      const resolved = await resolveCustomerRepresentative(effectiveCustomerId);
      data.representativeId = resolved.representativeId;
      data.representative = resolved.representativeName;
    } else if (customerTouched) {
      // Customer explicitly cleared — clear representative too
      data.representativeId = null;
      data.representative = null;
    } else if (representativeId !== undefined) {
      // No customer and customer not being changed — allow manual rep
      if (representativeId) {
        const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
        if (!rep || rep.archived) {
          return NextResponse.json({ error: "指定的代表不存在" }, { status: 400 });
        }
        data.representativeId = representativeId;
        data.representative = rep.name;
      } else {
        data.representativeId = null;
        data.representative = null;
      }
    }

    // Compute whether representative actually changed (for activity log / notification)
    const representativeChanged =
      data.representativeId !== undefined &&
      data.representativeId !== existing.representativeId;

    // Pre-compute order sync data for COMPLETED transition
    const isCompleting = status === "COMPLETED" && existing.status !== "COMPLETED";
    let orderSyncOrders: Array<{ id: string; oldDeliveryStatus: string }> = [];

    if (isCompleting) {
      const links = await prisma.orderProjectLink.findMany({
        where: { projectId: id, treatment: "PROJECT_INCLUDED" },
        select: { orderId: true },
      });
      if (links.length > 0) {
        const orders = await prisma.order.findMany({
          where: { id: { in: links.map((l) => l.orderId) }, deliveryStatus: { not: "DELIVERED" } },
          select: { id: true, deliveryStatus: true },
        });
        orderSyncOrders = orders.map((o) => ({ id: o.id, oldDeliveryStatus: o.deliveryStatus }));
      }
    }

    // Atomic: project update + status history + activity logs + order delivery sync
    let updated: typeof existing;
    await prisma.$transaction(async (tx) => {
      updated = await tx.project.update({ where: { id }, data });

      // Log archive toggle
      if (archived !== undefined && archived !== existing.archived) {
        await tx.activityLog.create({
          data: {
            type: archived ? "PROJECT_ARCHIVED" : "PROJECT_UNARCHIVED",
            content: archived ? `归档了项目 "${existing.name}"` : `取消了项目 "${existing.name}" 的归档`,
            projectId: id,
            userId: session.user.id,
          },
        });
      }

      // Log status change
      if (status !== undefined && status !== existing.status) {
        await tx.statusHistory.create({
          data: {
            projectId: id,
            oldStatus: existing.status,
            newStatus: status,
            createdBy: session.user.id,
          },
        });
        await tx.activityLog.create({
          data: {
            type: "STATUS_CHANGED",
            content: `项目状态从 "${existing.status}" 变更为 "${status}"`,
            metadata: JSON.stringify({ oldStatus: existing.status, newStatus: status }),
            projectId: id,
            userId: session.user.id,
          },
        });
      }

      // Order delivery sync (inside same transaction as project update)
      if (orderSyncOrders.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: orderSyncOrders.map((o) => o.id) } },
          data: { deliveryStatus: "DELIVERED", deliveredAt: new Date() },
        });
        for (const o of orderSyncOrders) {
          await tx.orderStatusHistory.create({
            data: {
              orderId: o.id,
              oldDeliveryStatus: o.oldDeliveryStatus,
              newDeliveryStatus: "DELIVERED",
              note: `项目 "${existing.name}" 已完成，联动交付`,
              createdById: session.user.id,
            },
          });
        }
      }

      // Log financial field overrides for audit trail (normalize before compare)
      const nextBudgetAmount = budgetAmount != null && budgetAmount !== "" ? Number(budgetAmount) : null;
      const prevBudgetAmount = existing.budgetAmount != null ? Number(existing.budgetAmount) : null;
      if (budgetAmount !== undefined && nextBudgetAmount !== prevBudgetAmount) {
        await tx.activityLog.create({
          data: {
            type: "PROJECT_UPDATED",
            content: `项目金额从 ${prevBudgetAmount != null ? prevBudgetAmount : "空"} 更新为 ${nextBudgetAmount != null ? nextBudgetAmount : "空"}（admin_override_project_finance）`,
            projectId: id,
            userId: session.user.id,
          },
        });
      }
      const nextBudgetCost = budgetCost != null && budgetCost !== "" ? Number(budgetCost) : null;
      const prevBudgetCost = existing.budgetCost != null ? Number(existing.budgetCost) : null;
      if (budgetCost !== undefined && nextBudgetCost !== prevBudgetCost) {
        await tx.activityLog.create({
          data: {
            type: "PROJECT_UPDATED",
            content: `项目成本从 ${prevBudgetCost != null ? prevBudgetCost : "空"} 更新为 ${nextBudgetCost != null ? nextBudgetCost : "空"}（admin_override_project_finance）`,
            projectId: id,
            userId: session.user.id,
          },
        });
      }

      // Sync budgetCost into FinanceCost for unified cost tracking (inside transaction)
      if (budgetCost !== undefined) {
        const bc = budgetCost != null && budgetCost !== "" ? Number(budgetCost) : null;
        const { syncProjectBudgetCost: syncCost } = await import("@/lib/finance/ledger");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await syncCost(id, bc, session.user.id, tx as any);
      }
    });

    // ── Side effects (outside transaction): notifications, mail ──
    const updatedProject = updated!;

    // Pre-fetch representative for batched notification
    const repForNotify = updatedProject.representativeId
      ? await prisma.representative.findUnique({
          where: { id: updatedProject.representativeId, archived: false },
        })
      : null;
    const repNotifications: Array<{ subject: string; text: string; html: string }> = [];

    if (status !== undefined && status !== existing.status) {
      const owner = await prisma.projectMember.findFirst({
        where: { projectId: id, role: "OWNER" },
        include: { user: { select: { id: true, email: true, name: true, emailOnStatusChange: true, role: true } } },
      });

      if (owner) {
        const shouldEmail = !!(owner.user.email && owner.user.emailOnStatusChange && owner.user.role !== "REPRESENTATIVE");
        const notification = await prisma.notification.create({
          data: {
            userId: owner.user.id,
            title: "项目状态变更",
            content: `项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"`,
            type: "STATUS",
            link: `/projects/${id}`,
            emailStatus: shouldEmail ? "pending" : null,
          },
        });
        if (shouldEmail) {
          const { sendMailInBackground } = await import("@/lib/mail");
          sendMailInBackground({
            to: owner.user.email!,
            subject: `【SciManage】项目状态变更: ${existing.name}`,
            text: `您好 ${owner.user.name || ""}，\n\n项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"。\n\n---\nSciManage`,
            html: `<p>您好 <strong>${owner.user.name || ""}</strong>，</p>
<p>项目 <strong>"${existing.name}"</strong> 状态已从 <strong>"${existing.status}"</strong> 变更为 <strong>"${status}"</strong>。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
          }, notification.id);
        }
      }

      // Queue representative notification
      if (repForNotify?.email) {
        repNotifications.push({
          subject: `【SciManage】项目状态变更: ${existing.name}`,
          text: `您好 ${repForNotify.name || ""}，\n\n项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"。\n\n---\nSciManage`,
          html: `<p>您好 <strong>${repForNotify.name || ""}</strong>，</p>
<p>项目 <strong>"${existing.name}"</strong> 状态已从 <strong>"${existing.status}"</strong> 变更为 <strong>"${status}"</strong>。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
        });
      }
    }

    // Log progress update
    if (progress !== undefined && progress !== existing.progress) {
      await prisma.activityLog.create({
        data: {
          type: "PROGRESS_UPDATED",
          content: `项目进度更新为 ${progress}%`,
          metadata: JSON.stringify({ oldProgress: existing.progress, newProgress: progress }),
          projectId: id,
          userId: session.user.id,
        },
      });

      // Create notification for project owner (not self, no email)
      const progressOwner = await prisma.projectMember.findFirst({
        where: { projectId: id, role: "OWNER" },
        include: { user: { select: { id: true, name: true } } },
      });
      if (progressOwner && progressOwner.user.id !== session.user.id) {
        await prisma.notification.create({
          data: {
            userId: progressOwner.user.id,
            title: "项目进度更新",
            content: `项目 "${existing.name}" 进度从 ${existing.progress}% 更新为 ${progress}%`,
            type: "PROGRESS",
            link: `/projects/${id}`,
            emailStatus: null,
          },
        });
      }
    }

    // Log representative change
    if (representativeChanged) {
      const nextRepId = data.representativeId as string | null;
      const newRep = nextRepId
        ? await prisma.representative.findUnique({ where: { id: nextRepId } })
        : null;
      const oldRep = existing.representativeId
        ? await prisma.representative.findUnique({ where: { id: existing.representativeId } })
        : null;
      await prisma.activityLog.create({
        data: {
          type: "REPRESENTATIVE_CHANGED",
          content: oldRep
            ? `将项目代表从 "${oldRep.name}" 变更为 "${newRep?.name || "无"}"`
            : `为项目设置了代表 "${newRep?.name || ""}"`,
          metadata: JSON.stringify({
            oldRepresentativeId: existing.representativeId,
            newRepresentativeId: nextRepId,
            oldRepresentativeName: oldRep?.name || null,
            newRepresentativeName: newRep?.name || null,
          }),
          projectId: id,
          userId: session.user.id,
        },
      });

      // Queue new representative notification
      if (repForNotify?.email) {
        repNotifications.push({
          subject: `【SciManage】您已被指定为项目代表: ${existing.name}`,
          text: `您好 ${repForNotify.name || ""}，\n\n您已被指定为项目 "${existing.name}" 的代表。\n\n---\nSciManage`,
          html: `<p>您好 <strong>${repForNotify.name || ""}</strong>，</p>
<p>您已被指定为项目 <strong>"${existing.name}"</strong> 的代表。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
        });
      }
    }

    // Batch-send all representative notifications with a single token
    if (repNotifications.length > 0 && repForNotify?.email) {
      const { notifyRepresentative } = await import("@/lib/representative-link");
      const result = await notifyRepresentative(repForNotify.email, `/projects/${id}`, repNotifications);
      if (!result.ok) {
        console.error("Failed to notify representative");
      }
    }

    // Log general update (only if no specific change was logged)
    const hasSpecificChange =
      status !== undefined && status !== existing.status ||
      progress !== undefined && progress !== existing.progress ||
      archived !== undefined && archived !== existing.archived ||
      representativeChanged;
    if (!hasSpecificChange) {
      await prisma.activityLog.create({
        data: {
          type: "PROJECT_UPDATED",
          content: `更新了项目信息`,
          projectId: id,
          userId: session.user.id,
        },
      });
    }

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    console.error(error);
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "项目号已被使用" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const canManage = await canManageProject(id, session.user.id, session.user.role);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden: only ADMIN or project owner can delete projects" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { reason } = body;

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: "删除原因不能为空" }, { status: 400 });
    }

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.project.update({
      where: { id },
      data: {
        deleted: true,
        deletedAt: new Date(),
        deletedReason: reason.trim(),
      },
    });

    await prisma.activityLog.create({
      data: {
        type: "PROJECT_DELETED",
        content: `删除了项目 "${existing.name}"，原因：${reason.trim()}`,
        metadata: JSON.stringify({ reason: reason.trim() }),
        projectId: id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
