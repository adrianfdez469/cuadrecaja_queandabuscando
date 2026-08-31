/**
 * Serializes a JSON-LD value for a `<script type="application/ld+json">`
 * without opening an injection hole. Domain-agnostic — the next structured
 * data this repo adds (`Product`, `LocalBusiness`) wants this too
 * (architecture.md § El JSON-LD de `BreadcrumbList`).
 *
 * The labels this feeds come from the POS: a category or product name is a
 * merchant's text, and `</script>` inside a `<script>` closes the block
 * early. `<` is `<` inside a JSON string, so escaping every `<` keeps the
 * JSON semantically identical while making `</script`, `<!--` and `<script`
 * impossible to form in the output — the recipe this Next version documents
 * (`node_modules/next/dist/docs/01-app/02-guides/json-ld.md`, line 34).
 */
export function jsonLdScriptContent(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
