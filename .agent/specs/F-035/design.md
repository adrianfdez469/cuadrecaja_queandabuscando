---
feature: F-035
agente: orquestador
actualizado: 2026-09-06T00:00:00Z
estado: no aplica
---

## No aplica

F-035 no construye ni retoca ninguna pantalla. Lo que hace es devolver, desde
dos manejadores del sync, la lista de sucursales que un evento tocó, para que el
bucle de `src/features/sync/server/processBatch.ts` la drene en la invalidación
que **ya dispara** al final de cada lote. Todo el feature vive entre
`src/features/sync/server/handlers/misc.ts` y `src/lib/cache.ts`: no hay ruta
nueva, ni componente, ni estado de cliente, ni token de tema que decidir.

**Que las páginas del catálogo cambien de contenido no lo convierte en diseño.**
Lo que este feature altera es _cuándo_ se vuelve a renderizar `/[slug]`,
`/[slug]/catalogo`, `/[slug]/c/[categorySlug]`, `/[slug]/p/[productSlug]` y
`/[slug]/buscar`, no _qué_ pintan: el importe convertido, su tipografía, su
posición y su comportamiento sin JavaScript ya los fijaron F-004, F-021, F-026 y
F-027, y ninguno se toca aquí. Invalidar es expirar la marca de caché, no
re-renderizar ni rediseñar — está escrito como «FUERA» en las notas de F-035 de
`.agent/features.json`.

Consecuencias que quedan anotadas para que nadie las busque en un documento de
diseño que no existe:

- **El presupuesto de JavaScript no se mueve.** No hay un byte de cliente nuevo,
  así que `npm run check:bundle` no cambia de número y no hay nada que subir en
  `scripts/check-bundle-budget.mjs`.
- **Ningún `"use client"` nuevo**, y en particular ninguno en algo que renderice
  catálogo: la prohibición de `AGENTS.md` no se roza porque no se añade
  componente alguno.
- **Sin verificación visual propia.** Lo que hay que mirar es de comportamiento,
  no de aspecto: que la primera visita posterior al evento sirva el importe
  nuevo. Eso es un criterio ejecutable de `spec.md` y lo verifica `sdd-tester`
  con el sensor, no una captura en tres breakpoints.

Si alguna vez se quisiera **avisar al comprador** de que el precio cambió
mientras miraba —un aviso en la vitrina, un badge de «tasa actualizada»—, eso sí
sería una pantalla, y no es este feature: sería uno nuevo que escribe el humano
en `.agent/features.json`.
