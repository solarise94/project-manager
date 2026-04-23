import { prisma } from "./prisma";

export function validateUserInput({
  name,
  email,
}: {
  name?: string;
  email?: string;
}): { valid: true } | { valid: false; error: string; status: number } {
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) {
      return { valid: false, error: "昵称不能为空", status: 400 };
    }
    if (trimmed.length > 100) {
      return { valid: false, error: "昵称过长", status: 400 };
    }
  }

  if (email !== undefined) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      return { valid: false, error: "邮箱不能为空", status: 400 };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return { valid: false, error: "邮箱格式不正确", status: 400 };
    }
  }

  return { valid: true };
}

export async function checkEmailConflict(
  email: string,
  excludeId?: string
): Promise<{ conflict: true; error: string; status: number } | { conflict: false }> {
  const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (existing && existing.id !== excludeId) {
    return { conflict: true, error: "该邮箱已被使用", status: 409 };
  }
  return { conflict: false };
}
