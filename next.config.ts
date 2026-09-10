import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // F-023 R1: no image optimization in this product, ever. The variants a
    // product image needs (two widths × AVIF/WebP) are generated ONCE, at
    // upload time (`src/lib/imageEncoder.ts`), and served straight from
    // Supabase Storage's own CDN by `src/components/ui/ResponsiveImage.tsx`.
    // The three keys the optimizer needed (allowed formats, the allowed
    // upstream host pattern, and a local-IP escape hatch for the emulator)
    // all existed ONLY to feed it — with it off, there is no upstream host
    // left to allow, so they go with it. Re-introducing a `next/image` by
    // accident now produces a raw, unoptimized `<img>` — annoying, but it
    // can never re-light the metered, per-request optimizer again. The
    // second half of that guard is `src/lib/boundaries.test.ts`, which fails
    // if any module under `src/` imports `next/image` at all (criterio 2).
    unoptimized: true,
  },
  // Type errors fail the build. ESLint no longer runs during `next build` in
  // Next 16 — the `eslint` config key was removed — so `npm run lint` is a
  // separate step, in CI and in the pre-commit hook.
  typescript: { ignoreBuildErrors: false },
  // F-042 (architecture.md § AD1(e), riesgo 5): la ruta de geometría lee
  // `src/features/zones/geometry/<code>.json` con un nombre de fichero
  // DINÁMICO (`${code}.json`), y el trazado de Next no descubre solo un
  // `readFileSync` cuyo argumento no es un literal — sin esto, la ruta
  // respondería 500 en producción y verde en local, la peor forma de
  // fallar (docs/despliegue.md § 7).
  outputFileTracingIncludes: {
    "/api/zones/geometry/\\[slug\\]": ["./src/features/zones/geometry/**/*"],
  },
};

export default nextConfig;
