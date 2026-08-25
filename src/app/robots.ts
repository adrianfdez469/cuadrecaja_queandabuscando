import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /api/internal/* is machine-to-machine and must never be crawled;
      // /admin is authenticated and has nothing to index.
      disallow: ["/api/", "/admin"],
    },
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
  };
}
