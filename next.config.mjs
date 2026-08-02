/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "sharp", "@electric-sql/pglite"],
  experimental: {
    // Upload route streams multipart bodies straight to the storage driver.
    serverActions: { bodySizeLimit: "512mb" },
  },
};

export default nextConfig;
