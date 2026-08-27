import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { getCanonicalStoreSlugs } from "@/features/catalog/server/queries";

/** R22: one URL per branch, the CANONICAL one — never a live alias, which
 *  would compete with its own canonical in a search index. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getCanonicalStoreSlugs();

  return [
    { url: publicEnv.siteUrl, changeFrequency: "weekly", priority: 1 },
    ...slugs.map((slug) => ({
      url: `${publicEnv.siteUrl}/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
