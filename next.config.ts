import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native libSQL driver out of the server bundle; it is loaded at runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
