import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getStoreCategories, getStoreRates, requireStore } from "@/features/catalog/server/queries";
import { requireResolution } from "@/features/storefront/server/resolve";
import { branchTrailStore, searchTrail } from "@/features/storefront/trail";
import { searchStoreProducts, type StoreSearchResult } from "@/features/catalog/server/search";
import { recordStoreSearchQuery } from "@/features/catalog/server/searchLog";
import {
  applyCatalogFilters,
  catalogFilterHref,
  hasAnyCatalogFilter,
  parseCatalogFilters,
  type CatalogFilterContext,
  type CatalogFilterResult,
} from "@/features/catalog/catalogFilters";
import { clampSearchPage, normalizeSearchTerm } from "@/lib/searchTerm";
import { publicEnv } from "@/lib/env";
import { SEARCH_TERM_MAX_LENGTH } from "@/constants/search";
import { Container } from "@/components/ui/Container";
import { Alert } from "@/components/ui/Alert";
import { StoreSearchBox } from "@/components/store/StoreSearchBox";
import { StoreSearchResults } from "@/components/store/StoreSearchResults";
import { StoreCatalogSort } from "@/components/store/StoreCatalogSort";
import { StoreFilterChips } from "@/components/store/StoreFilterChips";
import { StoreCatalogResults } from "@/components/store/StoreCatalogResults";
import { StoreClosedNotice } from "@/components/store/StoreClosedNotice";
import { StoreTrail } from "@/components/store/StoreTrail";
import { BranchBar } from "@/components/store/BranchBar";

/**
 * F-021: the results page. Server-rendered, no `"use client"` anywhere in
 * this tree (R14) — the HTML has to be enough (E18). Dynamic because it
 * reads `searchParams` (R15): never enters `src/lib/cache.ts`, and
 * `src/proxy.ts`'s `matcher` still does not touch `/[slug]` (AGENTS.md §
 * Cosas que muerden). Both segment configs are LITERALS — Next analyses
 * them statically.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Whether `raw` would be truncated by `normalizeSearchTerm` — the same
 *  trim+collapse it does internally, compared against the same ceiling
 *  (E11). Kept here rather than exported from `searchTerm.ts`: it is a
 *  presentation fact ("tell the shopper we cut it"), not a normalization
 *  rule. */
function wasTruncated(raw: string): boolean {
  return raw.trim().replace(/\s+/g, " ").length > SEARCH_TERM_MAX_LENGTH;
}

/**
 * De-duplicates Q1 within ONE request: `generateMetadata` and the page body
 * both need the result (the title repeats `totalCount`), and this is the
 * one read in this feature that is deliberately NOT behind
 * `src/lib/cache.ts` (R15) — without this, the shopper's request would run
 * the three-layer query twice.
 */
const loadSearch = cache(
  (storeId: string, term: string, page: number): Promise<StoreSearchResult> =>
    searchStoreProducts({ storeId, term, page }),
);

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[slug]/buscar">): Promise<Metadata> {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // E13

  const store = await requireStore(resolution);
  if (store.status !== "PUBLISHED") {
    return { title: `${store.name} · No disponible ahora`, robots: { index: false } };
  }

  const query = await searchParams;
  const term = normalizeSearchTerm(firstParam(query.q) ?? "");
  if (term === null) {
    return { title: "Buscar en la tienda", robots: { index: false } };
  }

  const page = clampSearchPage(Number(firstParam(query.p)) || undefined);
  const result = await loadSearch(resolution.storeId, term, page);

  // F-027 (architecture.md § Decisión punto 9): canónica a /[slug] SOLO
  // cuando la URL lleva filtro u orden — el HTML que F-021 ya verificó no
  // cambia cuando no los lleva.
  const state = parseCatalogFilters(query);
  const canonical = hasAnyCatalogFilter(state)
    ? new URL(`/${store.canonicalSlug}`, publicEnv.siteUrl).toString()
    : undefined;

  if (result.totalCount === 0) {
    return {
      title: `Sin resultados para «${result.term}»`,
      robots: { index: false },
      alternates: canonical ? { canonical } : undefined,
    };
  }
  const plural = result.totalCount === 1 ? "resultado" : "resultados";
  return {
    title: `${result.term} · ${result.totalCount} ${plural}`,
    robots: { index: false },
    alternates: canonical ? { canonical } : undefined,
  };
}

/** Same visual weight as `Button`'s `secondary` variant, on an `<a>` —
 *  `Button` renders a `<button>` and has no anchor mode (same technique
 *  `StoreClosedNotice`'s WhatsApp link and `StoreSearchResults`'s
 *  pagination links already use). */
const SECONDARY_LINK_CLASSES =
  "bg-surface-muted text-fg border-border focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

export default async function StoreSearchPage({
  params,
  searchParams,
}: PageProps<"/[slug]/buscar">) {
  const { slug } = await params;
  const resolution = await requireResolution(slug);
  if (resolution.kind === "selector") notFound(); // E13

  const store = await requireStore(resolution);

  // E14: no catalog/search query at all for a closed store.
  if (store.status !== "PUBLISHED") {
    const trail = searchTrail(branchTrailStore(resolution, store), null);
    return (
      <>
        <Container className="pt-4 pb-8">
          <StoreTrail trail={trail} />
          <StoreClosedNotice
            storeName={store.name}
            disabledReasonCode={store.disabledReasonCode}
            disabledMessage={store.disabledMessage}
            disabledAt={store.disabledAt}
            whatsapp={store.whatsapp}
            phone={store.phone}
            address={store.address}
            extraNote="No se puede buscar mientras la tienda esté cerrada."
          />
        </Container>
        <BranchBar
          branchName={store.name}
          canonicalSlug={store.canonicalSlug}
          branchCount={resolution.branchCount}
          isOpen={false}
        />
      </>
    );
  }

  const query = await searchParams;
  const rawQ = firstParam(query.q);
  // Present in the URL, even if it normalizes to nothing — what tells E10's
  // "invalid" aviso apart from a plain, never-searched empty box.
  const queryWasProvided = rawQ !== undefined;
  const raw = rawQ ?? "";
  const term = normalizeSearchTerm(raw);

  // E10: no query, no search, no registered row.
  if (term === null) {
    const trail = searchTrail(branchTrailStore(resolution, store), null);
    return (
      <>
        <BranchBar
          branchName={store.name}
          canonicalSlug={store.canonicalSlug}
          branchCount={resolution.branchCount}
          isOpen
        />
        <Container className="pt-4 pb-8">
          <StoreTrail trail={trail} />
          <StoreSearchBox
            storeSlug={store.canonicalSlug}
            storeName={store.name}
            term={raw}
            autoFocus
            showHelp
          />
          <h1 className="mt-8 text-2xl font-semibold">Buscar en la tienda</h1>
          <p className="text-fg-muted mt-2 max-w-2xl">
            Escribe el nombre de un producto para buscarlo en {store.name}.
          </p>
          {queryWasProvided && (
            <p className="text-fg-muted mt-2 text-sm">
              Escribe al menos una letra o un número para buscar.
            </p>
          )}
          <Link href={`/${store.canonicalSlug}`} className={`${SECONDARY_LINK_CLASSES} mt-6`}>
            Ver todo el catálogo
          </Link>
        </Container>
      </>
    );
  }

  // F-027 (architecture.md § La petición de /[slug]/buscar, punto 8): a
  // filter or an explicit `sort` switches to the FULL-candidate-set path —
  // `applyCatalogFilters` filters, sorts end-to-end and paginates in
  // memory. Neither: today's three-layer SQL, byte-for-byte (criterio 9).
  const state = parseCatalogFilters(query);
  const filtered = hasAnyCatalogFilter(state);
  const basePath = `/${store.canonicalSlug}/buscar`;

  const rates = await getStoreRates(resolution);

  let view:
    | { kind: "plain"; result: StoreSearchResult }
    | { kind: "filtered"; result: CatalogFilterResult; context: CatalogFilterContext };
  let searchTotal: number;

  if (filtered) {
    const [rawSearch, categories] = await Promise.all([
      searchStoreProducts({ storeId: resolution.storeId, term, mode: "all" }),
      getStoreCategories(resolution),
    ]);
    searchTotal = rawSearch.totalCount;
    const context: CatalogFilterContext = {
      displayCurrency: store.baseCurrencyCode,
      rates,
      categories,
      basePath,
    };
    view = {
      kind: "filtered",
      result: applyCatalogFilters(rawSearch.items, state, context),
      context,
    };
  } else {
    const result = await loadSearch(resolution.storeId, term, state.page);
    searchTotal = result.totalCount;
    view = { kind: "plain", result };
  }

  // R13/E16: scheduled AFTER the response leaves, and never throws — a
  // failure here must not become the shopper's problem. Logs the term's OWN
  // match count, never the post-filter one: filters are not part of what
  // F-021's registry measures.
  after(() =>
    recordStoreSearchQuery({ storeId: resolution.storeId, term, resultCount: searchTotal }),
  );

  const searchEmpty = searchTotal === 0;
  const totalCount = view.result.totalCount;
  const itemsLength = view.result.items.length;
  // A page beyond the last one: `items` is empty but `totalCount` is not —
  // never the same screen as "no results" (design.md § Inventario).
  const outOfRange = !searchEmpty && totalCount > 0 && itemsLength === 0;
  // E16's twin for a search: the term matched something, but the filters
  // applied on top left nothing (only reachable when `filtered`).
  const filtersEmptied = !searchEmpty && filtered && totalCount === 0;
  const trail = searchTrail(branchTrailStore(resolution, store), term);

  return (
    <>
      <BranchBar
        branchName={store.name}
        canonicalSlug={store.canonicalSlug}
        branchCount={resolution.branchCount}
        isOpen
      />
      <Container className="pt-4 pb-8">
        <StoreTrail trail={trail} />
        <StoreSearchBox storeSlug={store.canonicalSlug} storeName={store.name} term={term} />

        {searchEmpty ? (
          <>
            <h1 className="mt-8 text-2xl font-semibold break-words">
              Sin resultados para «{term}»
            </h1>
            <p className="text-fg-muted mt-2 max-w-2xl break-words">
              No encontramos ningún producto para «{term}» en {store.name}.
            </p>
            {wasTruncated(raw) && (
              <p className="text-fg-muted mt-2 text-sm">
                Tu búsqueda era muy larga. Buscamos con las primeras {SEARCH_TERM_MAX_LENGTH}{" "}
                letras.
              </p>
            )}
            <p className="mt-6">Puedes probar así:</p>
            <ul className="text-fg-muted mt-2 list-disc space-y-1 pl-5">
              <li>Revisa si falta o sobra alguna letra.</li>
              <li>Prueba con una palabra sola: «refresco» en vez de «refresco de cola 1.5 L».</li>
              <li>Prueba con otra manera de llamarlo.</li>
            </ul>
            <Link href={`/${store.canonicalSlug}`} className={`${SECONDARY_LINK_CLASSES} mt-6`}>
              Ver todo el catálogo
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-2xl font-semibold break-words">Resultados para «{term}»</h1>
            <p className="text-fg mt-2">
              {searchTotal} {searchTotal === 1 ? "resultado" : "resultados"} en {store.name}.
            </p>
            {wasTruncated(raw) && (
              <p className="text-fg-muted mt-1 text-sm">
                Tu búsqueda era muy larga. Buscamos con las primeras {SEARCH_TERM_MAX_LENGTH}{" "}
                letras.
              </p>
            )}

            {/* F-027, Inventario 3: el selector de orden SIEMPRE se ofrece
                aquí, con "Más relevantes" marcada por defecto. Su propio
                <form> y botón "Ordenar" — no hay panel de facetas (SP5). */}
            <div className="mt-4 max-w-xs">
              <StoreCatalogSort state={state} basePath={basePath} variant="buscar" />
            </div>

            {/* R17/R18: los chips solo aparecen si la URL trae filtro u
                orden — un filtro compartido por enlace nunca actúa en
                silencio, aunque esta pantalla no tenga panel donde ponerlo. */}
            {view.kind === "filtered" && (
              <StoreFilterChips
                applied={view.result.applied}
                context={view.context}
                removeAllHref={catalogFilterHref(basePath, view.result.applied, {
                  categorySlugs: [],
                  inStockOnly: false,
                  promotedOnly: false,
                  featuredOnly: false,
                  priceMin: null,
                  priceMax: null,
                  sort: null,
                })}
              />
            )}

            {filtersEmptied ? (
              <div className="mt-10">
                <h2 className="text-xl font-semibold">
                  Con estos filtros no queda ningún producto.
                </h2>
                <p className="text-fg-muted mt-2">Quita alguno para ver más productos.</p>
                <Link
                  href={`${basePath}?q=${encodeURIComponent(term)}`}
                  className={`${SECONDARY_LINK_CLASSES} mt-4`}
                >
                  Ver todos los resultados de la búsqueda
                </Link>
              </div>
            ) : outOfRange ? (
              <Alert tone="muted" className="mt-6">
                <p>Esta página ya no tiene resultados.</p>
                <Link
                  href={
                    view.kind === "filtered"
                      ? catalogFilterHref(basePath, view.result.applied, { page: 1 })
                      : `${basePath}?q=${encodeURIComponent(term)}`
                  }
                  className="mt-2 inline-block underline underline-offset-4"
                >
                  Volver a la primera página
                </Link>
              </Alert>
            ) : view.kind === "filtered" ? (
              <StoreCatalogResults
                result={view.result}
                storeSlug={store.canonicalSlug}
                storeName={store.name}
                displayCurrency={store.baseCurrencyCode}
                rates={rates}
                basePath={basePath}
              />
            ) : (
              <StoreSearchResults
                result={view.result}
                storeSlug={store.canonicalSlug}
                displayCurrency={store.baseCurrencyCode}
                rates={rates}
              />
            )}
          </>
        )}
      </Container>
    </>
  );
}
