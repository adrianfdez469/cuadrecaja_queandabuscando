/**
 * F-042 R6 — plegado de texto sin tildes ni mayúsculas, compartido por todo
 * lo que busca o compara nombres sin que la ortografía decida. Extraído de
 * `src/lib/slug.ts` (el truco `normalize("NFD")` de `slugify`), para no
 * escribirlo dos veces (architecture.md § Componentes, fila "Plegado de
 * texto").
 *
 * Deliberadamente NO es `slugify`: un slug también cambia espacios por
 * guiones y recorta a `MAX_LENGTH`, así que buscar "san jose" dejaría de
 * encontrar "San José de las Lajas" en cuanto la búsqueda y el candidato
 * divergieran en puntuación o longitud (design.md § Componentes de UI,
 * punto 5). Este módulo no toca nada salvo tildes y mayúsculas.
 */

/** "Café" -> "Cafe", "Holguín" -> "Holguin". ñ se descompone en n + tilde,
 *  así que no hace falta un caso especial para ella. */
export function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** R6: "holguin" encuentra "Holguín" y "CIENFUEGOS" encuentra "Cienfuegos".
 *  Minúsculas DESPUÉS de quitar las marcas, para que dé igual en qué orden
 *  el texto de entrada mezcle mayúsculas y acentos. */
export function foldForSearch(input: string): string {
  return stripDiacritics(input).toLowerCase();
}
