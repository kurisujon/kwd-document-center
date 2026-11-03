import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/admin/drive-setup/authorize",
        destination: "/api/admin/drive-setup/authorize",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
