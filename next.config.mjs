/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  experimental: {
    // Upload route streams multipart bodies straight to the storage driver.
    serverActions: { bodySizeLimit: "512mb" },
  },
};

export default nextConfig;
