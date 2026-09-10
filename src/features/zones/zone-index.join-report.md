# Informe de la unión DPA ⋈ OSM (F-041)

R6 y R8 de `.agent/specs/F-041/spec.md`: la unión **es** el artefacto, y este
informe deja a la vista cada código sin relación y cada relación sin código —
ninguno se descarta en silencio.

## Resultado

- 184 filas del Codificador de la DPA, las 184 emparejadas con una relación de
  OSM. **Cero códigos sin relación.**
- 183 relaciones de OSM (16 de `admin_level=4`, 167 de `admin_level=6`), las
  183 usadas por al menos una fila. **Cero relaciones sin código.**
- La relación `1854614` (Isla de la Juventud, `admin_level=4`) es la **única**
  usada por dos filas (`40` y `40.01`) — ver R7/I9.

## La errata de Santiago de Cuba, citada

El PDF del Codificador imprime los nueve municipios del bloque **«PROVINCIA:
34 SANTIAGO DE CUBA»** con el prefijo `32.xx`, que en la misma página ya
identifica a Holguín (`32.01`–`32.14`). Se siembran como `34.01`–`34.09`
(decisión del humano, 2026-09-08). Correspondencia exacta, código impreso →
código sembrado → nombre → relación de OSM usada:

| Impreso en el PDF | Sembrado | Nombre           | Relación OSM | QID      |
| ----------------- | -------- | ---------------- | ------------ | -------- |
| `32.01`           | `34.01`  | Contramaestre    | 5919047      | Q1129122 |
| `32.02`           | `34.02`  | Mella            | 5919050      | Q658207  |
| `32.03`           | `34.03`  | San Luis         | 5919052      | Q555956  |
| `32.04`           | `34.04`  | Segundo Frente   | 5919054      | Q1193189 |
| `32.05`           | `34.05`  | Songo - La Maya  | 5919055      | Q1193899 |
| `32.06`           | `34.06`  | Santiago de Cuba | 5919053      | Q117040  |
| `32.07`           | `34.07`  | Palma Soriano    | 5919051      | Q742835  |
| `32.08`           | `34.08`  | Tercer Frente    | 5919056      | Q1193882 |
| `32.09`           | `34.09`  | Guamá            | 5919049      | Q1193164 |

## Las cuatro filas que necesitaron emparejamiento manual

El emparejamiento automático es por nombre normalizado (sin acentos, sin
mayúsculas). Cuatro de las 184 filas fallaron ese cruce y se resolvieron a
mano, leyendo las etiquetas `wikipedia`/`name` de OSM:

| `code` DPA | Nombre DPA (verbatim del PDF) | Nombre en OSM   | Relación OSM | Motivo de la divergencia                                                                  |
| ---------- | ----------------------------- | --------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `21.09`    | San Luis                      | San Luis        | 2575074      | Nombre repetido con `34.03` — desambiguado por `wikipedia: es:San Luis (Pinar del Río)`   |
| `23.06`    | La Habana del Este            | Habana del Este | 5489823      | El DPA lleva el artículo, OSM no                                                          |
| `30.01`    | Carlos Manuel de Céspedes     | Céspedes        | 5892221      | OSM usa la forma corta del nombre                                                         |
| `34.03`    | San Luis (errata `32.03`)     | San Luis        | 5919052      | Nombre repetido con `21.09` — desambiguado por `wikipedia: en:San Luis, Santiago de Cuba` |

Las 180 filas restantes emparejaron por coincidencia exacta de nombre
normalizado, sin intervención manual.
