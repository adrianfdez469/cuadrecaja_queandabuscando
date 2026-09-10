---
feature: F-042
actualizado: 2026-09-09T20:30:42.705Z
---

# Procedencia del artefacto de geometría

Generado por `scripts/build-zone-geometry.ts` (`npm run geometry:zones`),
el segundo artefacto de la ADR 0032 (e). El primero es el índice
(`src/features/zones/zone-index.provenance.md`, F-041); este es
estrictamente geometría y se versiona por separado (R16).

## Volcado de OSM

- **Fuente**: Overpass API (`https://overpass-api.de/api/interpreter`), por `osmRelationId` — 183
  relaciones distintas para las 184 filas del índice (R17: `40` y `40.01`
  comparten la relación 1854614, y solo cuenta una vez).
- **`timestamp_osm_base`** del volcado: 2026-09-09T20:21:20Z.
- **Generado el**: 2026-09-09T20:30:42.705Z.
- **`indexVersion`** con la que se cortó: 1.0.0 (procedencia, no un aserto — R16).

## Proyección, snap, simplificación y precisión

- **Proyección**: EPSG:4326 (WGS84), sin reproyectar.
- **Snap de importación**: 0.0015° (≈166 m) — une vértices
  casi coincidentes de relaciones vecinas antes de construir el grafo de
  arcos (AD1(d)). DESVIACIÓN medida de architecture.md, que estimaba
  0.00001° (≈1 m): con ese valor, la comprobación 2 encontró huecos
  reales de 30-150 m entre pares concretos de relaciones vecinas que no
  comparten ni una vía en OSM — dos relaciones de OSM no siempre
  comparten las mismas vías, y aquí ni siquiera comparten vértices
  cercanos. Subir el snap (nunca bajar la exigencia de la comprobación,
  riesgo 3 de architecture.md) hasta que las dos comprobaciones
  convergieran fue lo que fijó este valor.
- **Simplificación**: Visvalingam ponderada (`weighted`), `keep-shapes`,
  `interval=100` metros, **topológica**: mapshaper construye
  un grafo de arcos compartidos entre polígonos vecinos y simplifica sobre
  los arcos, no sobre cada anillo — la frontera entre dos municipios se
  simplifica UNA vez y las dos vecinas heredan la misma línea (R15).
- **Precisión de salida**: 0.0001° (≈11 m) — una SEGUNDA pérdida,
  un orden de magnitud más fina que la tolerancia de simplificación.
- **Herramienta**: mapshaper@0.7.61, `osmtogeojson@2.2.12` para la
  conversión de la respuesta de Overpass.

## Las dos comprobaciones

**Corren DESPUÉS del redondeo**, sobre los bytes tal como se commitean —
comprobar un intermedio sería comprobar un fichero que nadie usa.

**Comprobación 1 — DESVIACIÓN documentada de architecture.md § AD1(d)
(ver `.agent/specs/F-042/impl.md` § Desviaciones, IP1 para el humano).**
El diseño firmado comparaba `dissolve2(municipios, provinceCode)` contra
el polígono de PRIMER NIVEL de OSM con un `erase` bidireccional. Medido
al generar, ese polígono no es comparable: las relaciones
`admin_level=4` de Cuba en OSM incluyen aguas territoriales que las de
`admin_level=6` (los municipios) no incluyen. Las áreas de las 16
relaciones de primer nivel, descargadas igualmente (183 relaciones en
total, como fija el paso 2 del plan) y medidas aquí SOLO como dato
informativo — no deciden nada de lo de abajo:

| Código | Nombre              | Área (km², informativa) |
| ------ | ------------------- | ----------------------- |
| 21     | Pinar del Río       | 25889.8                 |
| 22     | Artemisa            | 8403.9                  |
| 23     | La Habana           | 1955.9                  |
| 24     | Mayabeque           | 6804.7                  |
| 25     | Matanzas            | 23274.2                 |
| 26     | Villa Clara         | 16732.0                 |
| 27     | Cienfuegos          | 7285.1                  |
| 28     | Sancti Spíritus     | 12330.7                 |
| 29     | Ciego de Ávila      | 16303.5                 |
| 30     | Camagüey            | 29378.8                 |
| 31     | Las Tunas           | 9916.7                  |
| 32     | Holguín             | 15539.8                 |
| 33     | Granma              | 15884.7                 |
| 34     | Santiago de Cuba    | 10347.7                 |
| 35     | Guantánamo          | 12512.4                 |
| 40     | Isla de la Juventud | 21215.7                 |

En su lugar, la comprobación 1 verifica SOLAPES por provincia:
`dissolve2(provinceCode)` sobre los municipios YA simplificados tiene
que dar la MISMA área que la suma de sus áreas individuales — un solape
la reduciría. `40` es una tautología (su única municipalidad es 40.01,
dissolve2 de un elemento es ese elemento).

| Provincia | Suma (km²) | Disuelta (km²) | Diferencia relativa |
| --------- | ---------- | -------------- | ------------------- |
| 21        | 8921.073   | 8922.826       | 0.0197%             |
| 22        | 4021.468   | 4020.238       | 0.0306%             |
| 23        | 733.257    | 733.240        | 0.0024%             |
| 24        | 3712.583   | 3711.667       | 0.0247%             |
| 25        | 11705.315  | 11706.230      | 0.0078%             |
| 26        | 8499.730   | 8497.618       | 0.0249%             |
| 27        | 4200.708   | 4201.782       | 0.0256%             |
| 28        | 6796.714   | 6794.803       | 0.0281%             |
| 29        | 7061.413   | 7058.391       | 0.0428%             |
| 30        | 15540.990  | 15525.717      | 0.0983%             |
| 31        | 6633.069   | 6629.206       | 0.0583%             |
| 32        | 9259.876   | 9261.481       | 0.0173%             |
| 33        | 8403.645   | 8408.764       | 0.0609%             |
| 34        | 6264.700   | 6266.843       | 0.0342%             |
| 35        | 6217.463   | 6218.502       | 0.0167%             |
| 40        | 21215.398  | 21215.398      | 0.0000%             |

Umbral: 0.10% de diferencia relativa. Las 16 pasaron.

**Comprobación 2 — cobertura punto a punto**, tal como fija R15: una
rejilla determinista de 0.01° sobre el bbox de cada provincia
(227021 puntos en total) más dos sondas a
0.00015° a cada lado del punto medio de cada
segmento de frontera compartido entre dos municipios vecinos
(22964 sondas). Cero puntos de la rejilla en dos
o más zonas, cero sondas de frontera sin ninguna zona. Las dos pasaron.

## El artefacto

- **168 ficheros** `<code>.json` (uno por municipio) más
  `manifest.json`, con sus hashes y recuentos.
- **Peso total medido**: 0.85 MB (D9/PP1: se
  aceptan hasta 3 MB con esta tolerancia; por encima, se aprieta antes de
  plantear otra cosa).

## Regenerar

```bash
npm run geometry:zones
```

Necesita red (Overpass API) y tarda minutos, no segundos — se hace una
vez, no en cada despliegue (docs/despliegue.md).
