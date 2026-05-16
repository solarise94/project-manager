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
    select: { id: true, name: true, archived: true, createdAt: true },
  });
  if (!rep || rep.archived) return [];

  // Primary: projects linked by representativeId
  const byId = await prisma.project.findMany({
    where: { representativeId: rep.id, deleted: false },
    select: { id: true },
  });

  // Fallback: projects where representativeId is null but representative text matches rep name.
  // Only apply when the rep name is unique among active representatives, and only for
  // projects created after this representative record exists, to reduce stale same-name reuse.
  const nameCount = await prisma.representative.count({
    where: { name: rep.name, archived: false },
  });
  if (nameCount > 1) return byId.map((p) => p.id);

  const alreadyCovered = new Set(byId.map((p) => p.id));
  const byName = await prisma.project.findMany({
    where: {
      representativeId: null,
      representative: rep.name,
      deleted: false,
      createdAt: { gte: rep.createdAt },
    },
    select: { id: true },
  });

  const all = [...byId, ...byName.filter((p) => !alreadyCovered.has(p.id))];
  return all.map((p) => p.id);
}

/**
 * Returns all project IDs the user can read.
 * - ADMIN: null (meaning all projects)
 * - Sales roles (REPRESENTATIVE, REGIONAL_MANAGER): projects linked via representativeId or representative name
 * - USER: projects where user is a ProjectMember + any representative-linked projects
 */
export async function getReadableProjectIds(userId: string, role: string): Promise<string[] | null> {
  if (role === "ADMIN") return null;

  const ids = new Set<string>();

  // Always check membership (covers OWNER, MEMBER, COLLABORATOR)
  const memberIds = await getUserProjectIds(userId);
  for (const id of memberIds) ids.add(id);

  // Check representative linkage (for REPRESENTATIVE, REGIONAL_MANAGER, and USER who may also be reps)
  const repIds = await getRepresentativeProjectIds(userId);
  for (const id of repIds) ids.add(id);

  return [...ids];
}

/**
 * Check if a user can read a specific project.
 * - Deleted projects: only ADMIN or project OWNER
 * - Active projects: must be in readable project set (unless ADMIN)
 */
export async function canReadProject(projectId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, deleted: true },
  });
  if (!project) return false;

  if (project.deleted) {
    return isProjectOwner(projectId, userId);
  }

  const ids = await getReadableProjectIds(userId, role);
  if (ids === null) return true; // ADMIN (already handled above)
  return ids.includes(projectId);
}

/**
 * Check if a user can contribute to a project (create tickets, comments, replies).
 * Same as canReadProject but additionally requires the project not be deleted.
 */
export async function canContributeProject(projectId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, deleted: true },
  });
  if (!project || project.deleted) return false;

  return canReadProject(projectId, userId, role);
}

/**
 * Check if a user can manage a project (edit, delete, archive).
 * Only ADMIN or project OWNER can manage.
 */
export async function canManageProject(projectId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  return isProjectOwner(projectId, userId);
}

/**
 * Check if a user can manage tickets (change status, delete).
 * ADMIN can manage any project's tickets.
 * USER / REGIONAL_MANAGER can manage tickets only when they are explicit ProjectMember.
 * Project OWNER (any role) can always manage tickets on their project.
 * Representative linkage only grants read/contribute, not ticket management.
 */
export async function canManageTicket(projectId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "USER" || role === "REGIONAL_MANAGER") return isProjectMember(projectId, userId);
  return isProjectOwner(projectId, userId);
}

/**
 * Build a permissions object for API responses.
 */
export async function buildProjectPermissions(projectId: string, userId: string, role: string) {
  const [canRead, canContribute, canManage] = await Promise.all([
    canReadProject(projectId, userId, role),
    canContributeProject(projectId, userId, role),
    canManageProject(projectId, userId, role),
  ]);
  return {
    canRead,
    canContribute,
    canManage,
    canViewInvoices: canRead,
  };
}

/**
 * Assert that a user can read full project context (including tickets, comments, timeline).
 * Rules aligned with project detail / timeline API:
 * - Project not found → throws "NOT_FOUND"
 * - Deleted project → only ADMIN or project OWNER allowed, otherwise "FORBIDDEN"
 * - Active project → must be a project member, otherwise "FORBIDDEN"
 * - REPRESENTATIVE should NOT use this — they get a separate, scoped view.
 *   The function enforces that restriction directly to avoid route-level drift.
 */
export async function assertProjectContextReadable(
  projectId: string,
  userId: string,
  role: string,
) {
  if (role === "REPRESENTATIVE") {
    throw new Error("FORBIDDEN");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, deleted: true },
  });

  if (!project) {
    throw new Error("NOT_FOUND");
  }

  if (project.deleted) {
    const owner = await isProjectOwner(projectId, userId);
    if (!owner && role !== "ADMIN") {
      throw new Error("FORBIDDEN");
    }
    return project;
  }

  if (role !== "ADMIN") {
    await assertProjectMember(projectId, userId);
  }
  return project;
}
