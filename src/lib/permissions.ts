import { prisma } from "./prisma";

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId },
  });
  return !!member;
}

export async function assertProjectMember(projectId: string, userId: string): Promise<void> {
  const isMember = await isProjectMember(projectId, userId);
  if (!isMember) {
    throw new Error("Forbidden: not a project member");
  }
}

export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId, role: "OWNER" },
  });
  return !!member;
}

export async function assertProjectOwner(projectId: string, userId: string): Promise<void> {
  const isOwner = await isProjectOwner(projectId, userId);
  if (!isOwner) {
    throw new Error("Forbidden: not project owner");
  }
}

export async function getUserProjectIds(userId: string): Promise<string[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}

export function isRepresentative(role?: string | null): boolean {
  return role === "REPRESENTATIVE";
}

export async function getRepresentativeProjectIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) return [];

  const rep = await prisma.representative.findUnique({
    where: { email: user.email },
    select: { id: true, archived: true },
  });
  if (!rep || rep.archived) return [];

  const projects = await prisma.project.findMany({
    where: { representativeId: rep.id, deleted: false },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}
