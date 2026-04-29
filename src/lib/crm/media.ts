import path from "path";
import { existsSync } from "fs";

const AUDIO_EXTS = new Set([".webm", ".ogg", ".mp3", ".m4a", ".wav", ".aac"]);

export function getCheckinDir(checkinId: string): string {
  return path.join(process.cwd(), "public", "uploads", "crm", checkinId);
}

export function validateCheckinVoiceUrl(voiceUrl: string, checkinId: string): boolean {
  // Must be a relative path under /uploads/crm/{checkinId}/
  if (!voiceUrl.startsWith("/")) return false;
  const expectedPrefix = `/uploads/crm/${checkinId}/`;
  if (!voiceUrl.startsWith(expectedPrefix)) return false;

  const filename = voiceUrl.slice(expectedPrefix.length);
  if (!filename || filename.includes("/") || filename.includes("..")) return false;

  const ext = path.extname(filename).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) return false;

  const filePath = path.join(process.cwd(), "public", voiceUrl.slice(1));
  return existsSync(filePath);
}

export function resolveCheckinFilePath(voiceUrl: string, checkinId: string): string | null {
  if (!validateCheckinVoiceUrl(voiceUrl, checkinId)) return null;
  return path.join(process.cwd(), "public", voiceUrl.slice(1));
}
