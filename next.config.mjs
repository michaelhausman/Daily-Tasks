/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "sharp", "@electric-sql/pglite"],
  // No serverActions.bodySizeLimit here on purpose: uploads go to the
  // /api/uploads route handler, which that setting does not govern. Setting it
  // did nothing except print an "experimental features" warning at startup.
  // The real upload ceiling is MAX_BYTES in app/api/uploads/route.ts.
};

export default nextConfig;
