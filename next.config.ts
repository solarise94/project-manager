import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "prisma"],
  images: {
    unoptimized: true,
  },
  outputFileTracingExcludes: {
    "*": [
      "CLAUDE.md", "AGENTS.md", "README.md",
      "docs/**", "scripts/**", "prisma/**",
      "dev.db", "components.json", "eslint.config.mjs",
      ".draft-media/**",
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
