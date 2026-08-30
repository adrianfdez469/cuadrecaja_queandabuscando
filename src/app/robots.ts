import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /api/internal/* is machine-to-machine and must never be crawled;
      // /admin is authenticated and has nothing to index. F-012:
      // /cuenta and /auth are the shopper's own account pages — a stranger's
      // sign-in screen has nothing worth indexing either.
      disallow: ["/api/", "/admin", "/cuenta", "/auth"],
    },
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
  };
}
