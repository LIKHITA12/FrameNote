import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep dev output separate from build output to avoid chunk mismatches.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
