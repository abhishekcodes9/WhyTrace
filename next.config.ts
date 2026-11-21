import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Flow 13 reuses a ResizeObserver instance whose StrictMode
  // mount/cleanup cycle disconnects it before nodes are measured. Keep the
  // development harness stable so graph nodes and red-thread edges render.
  reactStrictMode: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
