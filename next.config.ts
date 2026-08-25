import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    // Modern formats first. On the connections this app targets, the difference
    // between AVIF and JPEG is the difference between a usable page and a blank one.
    formats: ["image/avif", "image/webp"],
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // Type errors fail the build. ESLint no longer runs during `next build` in
  // Next 16 — the `eslint` config key was removed — so `npm run lint` is a
  // separate step, in CI and in the pre-commit hook.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
