const DEFAULT_APP_BASE_URL = "http://localhost:3000";

export function getAppBaseUrl(): string {
  const rawBaseUrl =
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    DEFAULT_APP_BASE_URL;

  return rawBaseUrl.replace(/\/+$/, "");
}

export function getAppUrl(
  path: string,
  searchParams?: Record<string, string | null | undefined>
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, getAppBaseUrl());

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

export function getMagicLinkUrl(token: string, redirect?: string): string {
  return getAppUrl("/magic-link", { token, redirect });
}
