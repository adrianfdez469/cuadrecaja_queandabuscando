# Procedencia del índice de zonas (F-041)

Este documento existe para que, dentro de un año, alguien pueda regenerar
`src/features/zones/zone-index.json` byte por byte y entender por qué dice lo
que dice. R5 (`.agent/specs/F-041/spec.md`) fija su contenido mínimo; esto lo
cumple.

**Este artefacto no lleva geometría.** El índice es `code → nombre, nivel,
provincia, id y nombre de OSM, retirado` — nada de polígonos, proyección ni
simplificación topológica. La geometría, si llega, es de F-042 y tendrá su
propia versión.

## La fuente de los códigos y los nombres

**«Codificador de la División Político-Administrativa», República de Cuba,
Edición Enero 2011**, ONEI, 9 páginas, recuperado del Internet Archive:

```
http://web.archive.org/web/20110125204824id_/http://www.one.cu/publicaciones/08informacion/mapasdecuba/DPA.pdf
```

`sha256` del PDF descargado el 2026-09-08:
`c2cab904627235a1d03fbf2dde9cb1f4e94fc691f25bc78d65a2cde499dae4d9`.

No hay `pdftotext` ni poppler en esta máquina. El texto se extrajo inflando
con `zlib` (Node) cada `stream…endstream` del PDF y reconstruyendo las líneas a
partir de los operadores `Tm`/`Td`/`TD`/`T*` de cada bloque de texto —el mismo
procedimiento que ya funcionó antes en este proyecto. Un glyph de un tipo de
letra de símbolos (`/G1`, código hex `00b1`) se verificó a mano contra el
propio flujo del PDF y corresponde al guion de «Songo - La Maya» (`34.05`).

**Los 16 códigos de primer nivel**: `21` Pinar del Río, `22` Artemisa, `23` La
Habana, `24` Mayabeque, `25` Matanzas, `26` Villa Clara, `27` Cienfuegos, `28`
Sancti Spíritus, `29` Ciego de Ávila, `30` Camagüey, `31` Las Tunas, `32`
Holguín, `33` Granma, `34` Santiago de Cuba, `35` Guantánamo y `40` Isla de la
Juventud —municipio especial, su único municipio es `40.01`—.

**Recuento esperado y comprobado**: 16 divisiones de primer nivel y 168
municipios (184 filas en total), contando la Isla de la Juventud como
municipio especial. Tres fuentes independientes coinciden en esta cifra: el
propio Codificador, el capítulo «Territorio» del Anuario Estadístico de Cuba
2012 («15 provincias, 168 municipios», sin contar la Isla como provincia
ordinaria) y la consulta a Overpass de más abajo (16 relaciones de
`admin_level=4` y 167 de `admin_level=6`, que son las 15 provincias más la
Isla, y sus 167 municipios más la Isla contada una segunda vez al nivel de
municipio).

**La Isla de la Juventud no es estable entre ediciones de la DPA**: en la lista
pre-reforma de 2006 era `9901`; en esta edición de 2011 es `40.01`. Por eso la
edición usada queda congelada aquí, y por eso el id de relación de OSM —y no el
`code`— es lo que une una regeneración con la anterior.

## La errata de Santiago de Cuba (R6, citada y no corregida en silencio)

El bloque encabezado **«PROVINCIA: 34 SANTIAGO DE CUBA»** imprime sus nueve
municipios como `32.01 Contramaestre` … `32.09 Guamá`, repitiendo el prefijo de
Holguín, que en la misma página ya gasta `32.01`–`32.14`. Es una errata del
propio PDF de ONEI, no de esta extracción. Decisión del humano (2026-09-08):
se siembran como **`34.01`–`34.09`**, y la errata se deja citada aquí y en
`zone-index.join-report.md` — no se corrige en silencio, porque nueve códigos
sin fuente que los respalde serían indistinguibles de haberlos inventado.

## La geometría y la identidad de OSM

Consulta a la API de Overpass (`overpass-api.de`), ejecutada el **2026-09-09**
(`timestamp_osm_base: 2026-09-09T01:08:26Z`), sin instalar nada:

```overpassql
[out:json][timeout:180];
area["ISO3166-1"="CU"]["admin_level"="2"]->.cuba;
(
  relation(area.cuba)["admin_level"="4"]["boundary"="administrative"];
  relation(area.cuba)["admin_level"="6"]["boundary"="administrative"];
);
out tags;
```

Devolvió **183 relaciones: 16 de `admin_level=4` y 167 de `admin_level=6`**,
todas con `name` y con `wikidata` (QID), sin ninguna relación repetida como
elemento. El QID sirve para unir sin depender del nombre —y hace falta: entre
las 183 hay **12 nombres repetidos**: once provincias con su municipio capital
homónimo (Matanzas, Pinar del Río, Camagüey, Ciego de Ávila, Cienfuegos,
Guantánamo, Holguín, Las Tunas, Santiago de Cuba, Sancti Spíritus, Artemisa) y
`San Luis`, que son dos municipios en provincias distintas (Pinar del Río y
Santiago de Cuba). En los once primeros el `admin_level` (4 contra 6) ya
distingue el par; en `San Luis` la unión usó la etiqueta `wikipedia`
(`es:San Luis (Pinar del Río)` contra `en:San Luis, Santiago de Cuba`) — ver
`zone-index.join-report.md`.

**184 filas se unen contra 183 relaciones, y no es un error**: la Isla de la
Juventud aparece en OSM en `admin_level=4` (relación `1854614`) y no en 6, así
que sus dos filas del índice (`40` y `40.01`) apuntan a la **misma** relación.
`osmRelationId` no lleva `@unique` por esto (I9 de `architecture.md`).

## El recuento del artefacto

| Qué                                | Valor                                                |
| ---------------------------------- | ---------------------------------------------------- |
| Filas totales                      | 184                                                  |
| Primer nivel                       | 16                                                   |
| Municipios                         | 168                                                  |
| Relaciones de OSM usadas           | 183 (la Isla comparte relación entre `40` y `40.01`) |
| Filas que necesitaron unión manual | 4 (ver `zone-index.join-report.md`)                  |
| Filas retiradas                    | 0                                                    |

## El artefacto en sí

| Campo         | Fecha de generación        | `sha256`                                                           |
| ------------- | -------------------------- | ------------------------------------------------------------------ |
| `version`     | `1.0.0`                    | —                                                                  |
| `generatedAt` | `2026-09-09T01:08:26.000Z` | —                                                                  |
| Fichero       | —                          | `9bb89dd3564b0b202f975160f98be449efdc3c2b3d8594df6a7ec8009853b019` |

Regla de movimiento de versión: cualquier cambio de cualquier fila mueve la
**menor** (`1.0.0` → `1.1.0`); una edición distinta del Codificador —los
códigos no son estables entre ediciones, como demuestra la Isla de la
Juventud— mueve la **mayor**.
