import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E builds go to their own folder so they never mix with the dev/prod build (scripts/e2e-server.mjs).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ['unsight-jaxson-unfastidiously.ngrok-free.dev'],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Pin the workspace root: a stray package-lock.json in the parent folder
    // otherwise makes Next guess the wrong root.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
