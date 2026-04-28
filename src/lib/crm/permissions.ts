import { prisma } from "@/lib/prisma";

export function isRepresentativeRole(role: string) {
  return role === "REPRESENTATIVE";
}

export async function assertCrmProfileAccess(
  profileId: string,
  userId: string,
  role: string
) {
  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile) {
    throw new Error("NOT_FOUND");
  }
  if (role === "ADMIN" || role === "USER") {
    return profile;
  }
  if (profile.ownerUserId !== userId) {
    throw new Error("FORBIDDEN");
  }
  return profile;
}

export async function assertCrmProfileAccessByCustomerId(
  sourceCustomerId: string,
  userId: string,
  role: string
) {
  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { sourceCustomerId },
  });
  if (!profile) {
    throw new Error("NOT_FOUND");
  }
  if (role === "ADMIN" || role === "USER") {
    return profile;
  }
  if (profile.ownerUserId !== userId) {
    throw new Error("FORBIDDEN");
  }
  return profile;
}

export function buildCrmWhereForRole(userId: string, role: string) {
  if (role === "ADMIN" || role === "USER") {
    return {};
  }
  return { ownerUserId: userId };
}
