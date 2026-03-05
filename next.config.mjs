/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["@supabase/supabase-js", "sharp"],
};

export default nextConfig;
