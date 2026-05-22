import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { resolveRepresentativeForOwnerUserId } from "@/lib/crm/customer-owner-representative";

/** Roles that are allowed to receive customer assignments (销售/地区经理). */
const SALES_ROLES = new Set(["REPRESENTATIVE", "REGIONAL_MANAGER"]);

/**
 * Ensure a User record exists for a Representative.
 * The linked User may be REPRESENTATIVE or REGIONAL_MANAGER — both are valid
 * sales roles that can own CRM profiles.
 *
 * - User doesn't exist → create with role REPRESENTATIVE
 * - User exists with REPRESENTATIVE or REGIONAL_MANAGER → allow, sync name
 * - User exists with ADMIN or USER → reject
 */
export async function ensureSalesUserForRepresentative(rep: {
  email: string;
  name: string;
}): Promise<{ userId: string; created: boolean }> {
  const email = rep.email.trim().toLowerCase();
  const name = rep.name.trim();

  let user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    if (!SALES_ROLES.has(user.role)) {
      throw new Error("该邮箱不是销售/地区经理账号，不能作为客户负责人。请联系管理员处理。");
    }
    if (user.name !== name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name } });
    }
    return { userId: user.id, created: false };
  }

  user = await prisma.user.create({
    data: {
      email,
      name,
      password: await bcrypt.hash(crypto.randomUUID(), 10),
      role: "REPRESENTATIVE",
    },
  });

  return { userId: user.id, created: true };
}

export async function assertRepresentativeBackedSalesUser(
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user || !SALES_ROLES.has(user.role)) {
    throw new Error("负责人必须是销售/地区经理账号");
  }

  const resolved = await resolveRepresentativeForOwnerUserId(userId);
  if (!resolved.representativeId) {
    throw new Error("负责人必须绑定有效代表后才能用于 CRM 负责人与统计");
  }
}
