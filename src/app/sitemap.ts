import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { getPublishedStoreSlugs } from "@/features/catalog/server/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getPublishedStoreSlugs();

  return [
    { url: publicEnv.siteUrl, changeFrequency: "weekly", priority: 1 },
    ...slugs.map((slug) => ({
      url: `${publicEnv.siteUrl}/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
