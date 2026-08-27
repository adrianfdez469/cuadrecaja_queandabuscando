import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;

const nextConfig: NextConfig = {
  images: {
    // Modern formats first. On the connections this app targets, the difference
    // between AVIF and JPEG is the difference between a usable page and a blank one.
    formats: ["image/avif", "image/webp"],
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
            hostname: supabaseUrl.hostname,
            // Without this, the local Storage emulator (http://localhost:54321)
            // gets a 400 from the optimizer: an absent `port` means "only the
            // protocol's default port", and 54321 isn't it. In production
            // `NEXT_PUBLIC_SUPABASE_URL` has no port, so `supabaseUrl.port` is
            // "" and this key is omitted — the production pattern is unchanged.
            ...(supabaseUrl.port ? { port: supabaseUrl.port } : {}),
            // Restricted to public objects, same as before this change.
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
    // Next 16 refuses to optimize an upstream host that resolves to a
    // private/local IP (SSRF hardening) — the emulator's `localhost:54321`
    // trips it, and the optimizer answers a bare 400 with no body, no
    // `reason`, nothing that says why (found by running this, not by
    // reading the changelog). Safe here specifically because `remotePatterns`
    // above already restricts requests to our OWN configured host, port and
    // `/storage/v1/object/public/**` — this flag does not open the
    // optimizer to an attacker-chosen host, only lets it fetch this same,
    // already-whitelisted one when it happens to resolve locally. It also
    // has no effect on the real, public `https://<ref>.supabase.co` of
    // production.
    dangerouslyAllowLocalIP: true,
  },
  // Type errors fail the build. ESLint no longer runs during `next build` in
  // Next 16 — the `eslint` config key was removed — so `npm run lint` is a
  // separate step, in CI and in the pre-commit hook.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
