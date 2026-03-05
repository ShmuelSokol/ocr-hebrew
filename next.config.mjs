/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@supabase/supabase-js", "sharp"],
  },
};

export default nextConfig;
