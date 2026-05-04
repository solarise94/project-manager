import path from "node:path";
import { getAppBaseUrl } from "./app-url";

export type RuntimeInfo = {
  runtimeName: "DEV" | "DEMO" | "PROD" | "CUSTOM";
  databaseLabel: string;
  databasePath: string;
  baseUrl: string;
  hostname: string;
  port: string;
  nodeEnv: string;
};

function normalizeSqlitePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const sqlitePath = databaseUrl.slice("file:".length);

  if (!sqlitePath || sqlitePath === ":memory:") {
    return sqlitePath;
  }

  if (sqlitePath.startsWith("/")) {
    return sqlitePath;
  }

  // Prisma resolves relative SQLite paths from the schema directory.
  return path.resolve(process.cwd(), "prisma", sqlitePath);
}

function shortenHomePath(filePath: string) {
  const homeDir = process.env.HOME;

  if (!homeDir || !filePath.startsWith(homeDir)) {
    return filePath;
  }

  return `~${filePath.slice(homeDir.length)}`;
}

function detectRuntimeName(databasePath: string, baseUrl: string): RuntimeInfo["runtimeName"] {
  if (databasePath.includes("/task-manager-data/demo/") || baseUrl.includes("127.0.0.1:31081")) {
    return "DEMO";
  }

  if (
    databasePath.includes("/task-manager-data/prod/") ||
    baseUrl.includes(":39090") ||
    baseUrl.includes("101.34.158.217:31080")
  ) {
    return "PROD";
  }

  if (databasePath.includes("/project-manage/prisma/dev.db")) {
    return "DEV";
  }

  return "CUSTOM";
}

export function getRuntimeInfo(): RuntimeInfo {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const databasePath = normalizeSqlitePath(databaseUrl);
  const baseUrl = getAppBaseUrl();
  const hostname = process.env.HOSTNAME ?? "";
  const port = process.env.PORT ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "";

  return {
    runtimeName: detectRuntimeName(databasePath, baseUrl),
    databaseLabel: shortenHomePath(databasePath),
    databasePath,
    baseUrl,
    hostname,
    port,
    nodeEnv,
  };
}
